import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import { VAD } from '@inworld/runtime/primitives/vad';

import { Connection } from '../../types';

/**
 * Configuration interface for AudioStreamSlicerNode
 */
export interface AudioStreamSlicerNodeConfig {
  /** Pre-initialized VAD instance from the app (required) */
  vadClient: VAD;
  /** Connections map to access session state and TTS stream */
  connections: { [sessionId: string]: Connection };
  /** Speech detection threshold (0.0 - 1.0, higher values increase sensitivity) */
  speechThreshold?: number;
  /** Duration of silence (in milliseconds) that marks the end of an interaction */
  pauseDurationMs?: number;
  /** Sample rate of the audio stream in Hz */
  sampleRate?: number;
}

/**
 * AudioStreamSlicerNode processes continuous audio streams and detects
 * interaction boundaries using Voice Activity Detection.
 *
 * This node continuously reads audio chunks from a stream, uses VAD to detect
 * speech, and emits complete audio interactions when a pause threshold is exceeded.
 *
 * Silence handling:
 * - Leading silence (before first speech) is skipped to reduce bandwidth and API costs
 * - Trailing silence (after last speech) is skipped to avoid sending unnecessary data to STT
 * - Only speech segments are accumulated and sent
 */
export class AudioStreamSlicerNode extends CustomNode {
  private vad: VAD;
  private connections: { [sessionId: string]: Connection };
  private speechThreshold: number;
  private pauseDurationMs: number;
  private sampleRate: number;

  constructor(props: { id?: string; config: AudioStreamSlicerNodeConfig }) {
    const { config, ...nodeProps } = props;

    if (!config.vadClient) {
      throw new Error(
        'AudioStreamSlicerNode requires a VAD client. Pass the shared VAD instance from InworldApp.',
      );
    }

    if (!config.connections) {
      throw new Error('AudioStreamSlicerNode requires a connections object.');
    }

    super({
      id: nodeProps.id || 'audio-stream-slicer-node',
      executionConfig: {
        pauseDurationMs: config.pauseDurationMs || 1000,
        sampleRate: config.sampleRate || 16000,
        speechThreshold: config.speechThreshold || 0.5,
      },
    });

    // Use the shared VAD client from the app
    this.vad = config.vadClient;
    this.connections = config.connections;
    this.speechThreshold = config.speechThreshold || 0.5;
    this.pauseDurationMs = config.pauseDurationMs || 1000;
    this.sampleRate = config.sampleRate || 16000;
  }

  /**
   * Process audio stream and detect interaction boundaries
   */
  async process(
    context: ProcessContext,
    input0: GraphTypes.AudioChunkStream,
    input: DataStreamWithMetadata,
  ): Promise<DataStreamWithMetadata> {
    // Extract AudioChunkStream from either input type
    const audioStream =
      input !== undefined &&
      input !== null &&
      input instanceof DataStreamWithMetadata
        ? (input.toStream() as GraphTypes.AudioChunkStream)
        : input0;

    const sessionId = context.getDatastore().get('sessionId') as string;
    const connection = this.connections[sessionId];

    // Get iteration number from metadata, or parse from interactionId, or default to 1
    // Note: We only READ connection.state.interactionId, never WRITE it (TextInputNode does that)
    const metadata = input?.getMetadata?.() || {};
    let previousIteration = (metadata.iteration as number) || 0;

    // If no iteration in metadata, try parsing from interactionId
    const currentId = connection.state.interactionId;
    const delimiterIndex = currentId.indexOf('#');

    if (previousIteration === 0 && delimiterIndex !== -1) {
      // Try to extract iteration from interactionId (e.g., "abc123#2" -> 2)
      const iterationStr = currentId.substring(delimiterIndex + 1);
      const parsedIteration = parseInt(iterationStr, 10);
      if (!isNaN(parsedIteration) && /^\d+$/.test(iterationStr)) {
        previousIteration = parsedIteration;
      }
    }

    const iteration = previousIteration + 1;

    // Get base interactionId (without iteration suffix)
    const baseId =
      delimiterIndex !== -1
        ? currentId.substring(0, delimiterIndex)
        : currentId;

    // Compute next interactionId (don't write to connection.state yet - TextInputNode will do that)
    const nextInteractionId = `${baseId}#${iteration}`;

    console.log(`[Iteration ${iteration}] Starting audio stream processing`);

    // State for tracking speech and endpointing
    let speechDetected = false;
    let endpointingLatency = 0;
    const accumulatedAudio: number[] = [];
    let sampleRate = this.sampleRate;
    let isStreamExhausted = false;
    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId:${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId:${sessionId}`);
    }

    // Process chunks until we detect a complete interaction or stream ends
    while (!isStreamExhausted) {
      const result: { data: Float32Array; sampleRate: number; done: boolean } =
        await audioStream.next();

      if (result.done) {
        console.log(
          `Stream exhausted after ${accumulatedAudio.length} samples`,
        );
        isStreamExhausted = true;
        // Finish processing the current interaction
      }

      // Update sample rate from chunk
      sampleRate = result.sampleRate;

      // Detect voice activity in this chunk
      const isSpeech = await this.detectSpeech({
        data: result.data,
        sampleRate: result.sampleRate,
      });

      const chunkDurationMs = (result.data.length / result.sampleRate) * 1000;

      if (isSpeech) {
        console.log(`[${new Date().toISOString()}] Speech detected...`);
        // Speech detected - accumulate this chunk
        accumulatedAudio.push(...Array.from(result.data));

        // Reset endpointing latency counter and mark speech as detected
        speechDetected = true;
        endpointingLatency = 0;
      } else if (speechDetected) {
        // No speech in this chunk, but we've previously detected speech
        // Don't accumulate silence - just track endpointing latency
        endpointingLatency += chunkDurationMs;

        // Check if we've exceeded the pause threshold
        if (endpointingLatency >= this.pauseDurationMs) {
          // Complete the interaction - we have speech without trailing silence
          console.log(
            `[Iteration ${iteration}] Interaction complete: ${accumulatedAudio.length} samples, ` +
              `${endpointingLatency.toFixed(0)}ms endpointing latency (not included)`,
          );
          break;
        }
      }
      // If no speech detected and we haven't detected speech yet, skip this chunk (leading silence)
    }

    // Create the completed interaction audio (if we have data)
    const completedAudio =
      speechDetected && accumulatedAudio.length > 0
        ? new GraphTypes.Audio({
            data: accumulatedAudio,
            sampleRate: sampleRate,
          })
        : null;

    // Return DataStreamWithMetadata with the remaining stream and interaction data
    console.log(
      `[Iteration ${iteration}] Returning DataStreamWithMetadata (stream_exhausted: ${isStreamExhausted})`,
    );

    // If stream is exhausted, create an empty/completed generator instead of passing the exhausted stream
    // This prevents the C++ runtime from trying to iterate over an already-ended stream
    const streamToReturn = isStreamExhausted
      ? Object.assign(
          (async function* () {
            // Empty generator that immediately completes
            return;
          })(),
          {
            _iw_type: 'Audio',
            abort: () => {
              // No-op for exhausted stream
            },
          },
        )
      : audioStream;

    return new DataStreamWithMetadata(streamToReturn, {
      elementType: 'Audio',
      iteration: iteration,
      interactionId: nextInteractionId,
      total_samples: accumulatedAudio.length,
      sample_rate: sampleRate,
      speech_detected: speechDetected,
      endpointing_latency_ms: endpointingLatency,
      stream_exhausted: isStreamExhausted,
      interaction_complete: speechDetected && accumulatedAudio.length > 0,
      // Store the completed interaction audio
      completed_audio: completedAudio,
    });
  }

  /**
   * Detect speech in an audio chunk using VAD
   * @returns true if speech is detected, false otherwise
   */
  private async detectSpeech(audioChunk: {
    data: Float32Array | number[];
    sampleRate: number;
  }): Promise<boolean> {
    if (!this.vad) {
      throw new Error('VAD not initialized');
    }

    try {
      // Convert to array if needed
      const dataArray = Array.isArray(audioChunk.data)
        ? audioChunk.data
        : Array.from(audioChunk.data);

      const vadResult = await this.vad.detectVoiceActivity(
        {
          data: dataArray,
          sampleRate: audioChunk.sampleRate,
        },
        this.speechThreshold,
      );

      // Result is the sample index where speech is detected, or -1 if no speech
      return vadResult !== -1;
    } catch (error) {
      console.error('VAD detection failed:', error);
      return false; // Assume no speech on error
    }
  }

  /**
   * Clean up resources
   * Note: VAD instance is owned by the app and will be destroyed by the app
   */
  async destroy(): Promise<void> {
    // No cleanup needed - VAD is managed by InworldApp
  }
}
