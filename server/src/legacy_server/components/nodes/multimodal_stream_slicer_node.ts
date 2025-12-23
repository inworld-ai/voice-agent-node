import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import { VAD } from '@inworld/runtime/primitives/vad';

import { Connection } from '../../types';

/**
 * Configuration interface for MultimodalStreamSlicerNode
 */
export interface MultimodalStreamSlicerNodeConfig {
  /** Pre-initialized VAD instance from the app (required for audio processing) */
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
 * MultimodalStreamSlicerNode processes continuous streams of multimodal content
 * (both audio and text) and handles them appropriately based on their type.
 *
 * For audio content:
 * - Uses Voice Activity Detection to detect speech
 * - Emits complete audio interactions when a pause threshold is exceeded
 * - Routes to STT nodes for speech-to-text conversion
 *
 * For text content:
 * - Generates interaction ID
 * - Sets a flag (is_text_input) to route directly to InteractionInfoNode
 * - Bypasses STT nodes entirely
 *
 * Silence handling (audio only):
 * - Leading silence (before first speech) is skipped to reduce bandwidth and API costs
 * - Trailing silence (after last speech) is skipped to avoid sending unnecessary data to STT
 * - Only speech segments are accumulated and sent
 */
export class MultimodalStreamSlicerNode extends CustomNode {
  private vad: VAD;
  private connections: { [sessionId: string]: Connection };
  private speechThreshold: number;
  private pauseDurationMs: number;
  private sampleRate: number;

  constructor(props: {
    id?: string;
    config: MultimodalStreamSlicerNodeConfig;
  }) {
    const { config, ...nodeProps } = props;

    if (!config.vadClient) {
      throw new Error(
        'MultimodalStreamSlicerNode requires a VAD client. Pass the shared VAD instance from InworldApp.',
      );
    }

    if (!config.connections) {
      throw new Error(
        'MultimodalStreamSlicerNode requires a connections object.',
      );
    }

    super({
      id: nodeProps.id || 'multimodal-stream-slicer-node',
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
   * Process multimodal stream and detect interaction boundaries
   */
  async process(
    context: ProcessContext,
    input0: AsyncIterableIterator<GraphTypes.MultimodalContent>,
    input: DataStreamWithMetadata,
  ): Promise<DataStreamWithMetadata> {
    // Extract multimodal stream from either input type
    const multimodalStream =
      input !== undefined &&
      input !== null &&
      input instanceof DataStreamWithMetadata
        ? (input.toStream() as any as AsyncIterableIterator<GraphTypes.MultimodalContent>)
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

    console.log(
      `[Iteration ${iteration}] Starting multimodal stream processing`,
    );

    // State for tracking speech and endpointing (audio only)
    let speechDetected = false;
    let endpointingLatency = 0;
    const accumulatedAudio: number[] = [];
    let sampleRate = this.sampleRate;
    let isStreamExhausted = false;
    let isTextInput = false;
    let textContent: string | undefined;

    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId:${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId:${sessionId}`);
    }

    // Process chunks until we detect a complete interaction or stream ends
    while (!isStreamExhausted) {
      const result = await multimodalStream.next();

      if (result.done) {
        console.log(`Stream exhausted after processing multimodal content`);
        isStreamExhausted = true;
        // Finish processing the current interaction
        break;
      }

      const content = result.value as GraphTypes.MultimodalContent;

      // Check if this is text content
      if (content.text !== undefined && content.text !== null) {
        console.log(
          `[${new Date().toISOString()}] Text content detected: "${content.text}"`,
        );
        isTextInput = true;
        textContent = content.text;
        // For text input, we immediately complete the interaction
        break;
      }

      // Otherwise, this is audio content - process it with VAD
      if (content.audio !== undefined && content.audio !== null) {
        const audioData = content.audio.data;
        const audioSampleRate = content.audio.sampleRate;

        // Update sample rate from chunk
        sampleRate = audioSampleRate;

        // Convert to Float32Array if needed
        const float32Data = Array.isArray(audioData)
          ? new Float32Array(audioData)
          : audioData;

        // Detect voice activity in this chunk
        const isSpeech = await this.detectSpeech({
          data: float32Data,
          sampleRate: audioSampleRate,
        });

        const chunkDurationMs = (float32Data.length / audioSampleRate) * 1000;

        if (isSpeech) {
          console.log(`[${new Date().toISOString()}] Speech detected...`);
          // Speech detected - accumulate this chunk
          accumulatedAudio.push(...Array.from(float32Data));

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
    }

    // Create the completed interaction audio or text
    const completedAudio =
      speechDetected && accumulatedAudio.length > 0
        ? new GraphTypes.Audio({
            data: accumulatedAudio,
            sampleRate: sampleRate,
          })
        : null;

    // Return DataStreamWithMetadata with the remaining stream and interaction data
    console.log(
      `[Iteration ${iteration}] Returning DataStreamWithMetadata (is_running: ${!isStreamExhausted}, is_text_input: ${isTextInput}, is_interruption: false)`,
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
            type: 'MultimodalContent',
            abort: () => {
              // No-op for exhausted stream
            },
          },
        )
      : Object.assign(multimodalStream, {
          type: 'MultimodalContent',
          abort: () => {
            // No-op abort handler
          },
        });

    return new DataStreamWithMetadata(streamToReturn as any, {
      elementType: 'MultimodalContent',
      iteration: iteration,
      interactionId: nextInteractionId,
      total_samples: accumulatedAudio.length,
      sample_rate: sampleRate,
      speech_detected: speechDetected,
      endpointing_latency_ms: endpointingLatency,
      stream_exhausted: isStreamExhausted,
      interaction_complete:
        isTextInput || (speechDetected && accumulatedAudio.length > 0),
      // Store the completed interaction audio (for audio) or text (for text)
      completed_audio: completedAudio,
      text_content: textContent,
      // Flags to match native graph structure
      is_running: !isStreamExhausted,
      is_text_input: isTextInput,
      is_interruption: false, // Not currently handling interruptions in this node
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
      // Convert to Float32Array if needed
      const dataFloat32 = (
        audioChunk.data instanceof Float32Array
          ? audioChunk.data
          : new Float32Array(audioChunk.data)
      ) as Float32Array<ArrayBuffer>;

      const vadResult = await this.vad.detectVoiceActivity(
        {
          data: dataFloat32,
          sampleRate: audioChunk.sampleRate,
        },
        { speechThreshold: this.speechThreshold },
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
