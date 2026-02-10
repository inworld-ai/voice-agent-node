import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import type { RemoteStreamingSTTConfig } from '@inworld/runtime/primitives/speech';
import { StreamingSTT } from '@inworld/runtime/primitives/speech';
import { v4 as uuidv4 } from 'uuid';

import { STREAMING_STT_TIMEOUT_MS } from '../../../config';
import { formatSession } from '../../../log-helpers';
import logger from '../../../logger';
import { Connection } from '../../../types';
import { getAssemblyAISettingsForEagerness } from '../../../types/settings';

/**
 * Configuration interface for InworldStreamingSTTNode
 */
export interface InworldStreamingSTTNodeConfig {
  /** Connections map to access session state */
  connections: { [sessionId: string]: Connection };
  /** Sample rate of the audio stream in Hz */
  sampleRate?: number;
  /** Silence threshold in milliseconds for turn detection */
  silenceThresholdMs?: number;
  /** Model ID for the STT service */
  modelId?: string;
  /** Activity detection configuration */
  activityDetection?: {
    endOfTurnConfidenceThreshold?: number;
    minEndOfTurnSilenceWhenConfidentMs?: number;
    maxTurnSilenceMs?: number;
  };
}

/**
 * Default configuration values
 */
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_SILENCE_THRESHOLD_MS = 3000;
const DEFAULT_MODEL_ID = 'assemblyai/universal-streaming-multilingual';
const DEFAULT_ACTIVITY_DETECTION = {
  endOfTurnConfidenceThreshold: 0.5,
  minEndOfTurnSilenceWhenConfidentMs: 500,
  maxTurnSilenceMs: 2000,
};

/**
 * Manages a StreamingSTT session for a single connection.
 * Encapsulates session lifecycle and inactivity timeouts.
 */
class InworldStreamingSTTSession {
  private sttClient: StreamingSTT | null = null;
  private clientPromise: Promise<StreamingSTT> | null = null;

  shouldStopProcessing: boolean = false;

  private inactivityTimeout: NodeJS.Timeout | null = null;
  private lastActivityTime: number = Date.now();
  private readonly INACTIVITY_TIMEOUT_MS = 60000; // 60 seconds

  constructor(
    readonly sessionId: string,
    private config: RemoteStreamingSTTConfig,
    private onCleanup: (sessionId: string) => void,
  ) {}

  /**
   * Ensure STT client is ready, creating if needed
   */
  async ensureClient(): Promise<StreamingSTT> {
    if (!this.sttClient) {
      if (!this.clientPromise) {
        logger.info({ sessionId: this.sessionId }, 'InworldStreamingSTT creating STT client');
        this.clientPromise = StreamingSTT.create(this.config);
      }
      this.sttClient = await this.clientPromise;
      logger.info({ sessionId: this.sessionId }, `InworldStreamingSTT client created ${formatSession(this.sessionId)}`);
    }

    // Reset flags
    this.shouldStopProcessing = false;
    this.resetInactivityTimer();

    return this.sttClient;
  }

  /**
   * Reset the inactivity timer
   */
  resetInactivityTimer(): void {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }

    this.lastActivityTime = Date.now();
    this.inactivityTimeout = setTimeout(() => {
      this.closeDueToInactivity();
    }, this.INACTIVITY_TIMEOUT_MS);
  }

  /**
   * Close session due to inactivity
   */
  private closeDueToInactivity(): void {
    const inactiveFor = Date.now() - this.lastActivityTime;
    logger.info(
      { sessionId: this.sessionId, inactiveFor },
      `InworldStreamingSTT closing due to inactivity ${formatSession(this.sessionId)} [inactive:${inactiveFor}ms]`,
    );

    this.shouldStopProcessing = true;
    this.close();
    this.onCleanup(this.sessionId);
  }

  /**
   * Gracefully close the session
   */
  async close(): Promise<void> {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    this.sttClient = null;
    this.clientPromise = null;
  }
}

/**
 * InworldStreamingSTTNode processes continuous multimodal streams (audio and/or text) using the
 * StreamingSTT primitive from @inworld/runtime/primitives/speech.
 *
 * This node:
 * - Receives MultimodalContent stream (audio and/or text)
 * - For audio: extracts audio from MultimodalContent and feeds to StreamingSTT primitive
 * - For text: skips processing (text input should bypass STT)
 * - Uses the Inworld Runtime's StreamingSTT for speech-to-text
 * - Detects turn endings automatically using activity detection configuration
 * - Returns DataStreamWithMetadata with transcribed text when a turn completes
 *
 * This is an alternative to AssemblyAISTTWebSocketNode that uses the higher-level
 * StreamingSTT primitive instead of direct WebSocket connection.
 */
export class InworldStreamingSTTNode extends CustomNode {
  private connections: { [sessionId: string]: Connection };
  private sampleRate: number;
  private silenceThresholdMs: number;
  private modelId: string;
  private activityDetection: {
    endOfTurnConfidenceThreshold: number;
    minEndOfTurnSilenceWhenConfidentMs: number;
    maxTurnSilenceMs: number;
  };

  private sessions: Map<string, InworldStreamingSTTSession> = new Map();
  private readonly MAX_TRANSCRIPTION_DURATION_MS = STREAMING_STT_TIMEOUT_MS;

  constructor(props: { id?: string; config: InworldStreamingSTTNodeConfig }) {
    const { config, ...nodeProps } = props;

    if (!config.connections) {
      throw new Error('InworldStreamingSTTNode requires a connections object.');
    }

    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
      throw new Error('InworldStreamingSTTNode requires INWORLD_API_KEY environment variable.');
    }

    super({
      id: nodeProps.id || 'primitive-stt-node',
      executionConfig: {
        sampleRate: config.sampleRate || DEFAULT_SAMPLE_RATE,
        silenceThresholdMs: config.silenceThresholdMs || DEFAULT_SILENCE_THRESHOLD_MS,
        modelId: config.modelId || DEFAULT_MODEL_ID,
      },
    });

    this.connections = config.connections;
    this.sampleRate = config.sampleRate || DEFAULT_SAMPLE_RATE;
    this.silenceThresholdMs = config.silenceThresholdMs || DEFAULT_SILENCE_THRESHOLD_MS;
    this.modelId = config.modelId || DEFAULT_MODEL_ID;
    this.activityDetection = {
      endOfTurnConfidenceThreshold:
        config.activityDetection?.endOfTurnConfidenceThreshold ||
        DEFAULT_ACTIVITY_DETECTION.endOfTurnConfidenceThreshold,
      minEndOfTurnSilenceWhenConfidentMs:
        config.activityDetection?.minEndOfTurnSilenceWhenConfidentMs ||
        DEFAULT_ACTIVITY_DETECTION.minEndOfTurnSilenceWhenConfidentMs,
      maxTurnSilenceMs: config.activityDetection?.maxTurnSilenceMs || DEFAULT_ACTIVITY_DETECTION.maxTurnSilenceMs,
    };

    logger.info(
      {
        sampleRate: this.sampleRate,
        silenceThresholdMs: this.silenceThresholdMs,
        modelId: this.modelId,
        activityDetection: this.activityDetection,
      },
      `InworldStreamingSTT configured [model:${this.modelId}] [silence:${this.silenceThresholdMs}ms]`,
    );
  }

  /**
   * Build RemoteStreamingSTTConfig for the STT client
   * Dynamically uses connection.state.eagerness if available
   */
  private buildSTTConfig(sessionId?: string): RemoteStreamingSTTConfig {
    const apiKey = process.env.INWORLD_API_KEY!;

    let activityConfig = { ...this.activityDetection };

    if (sessionId) {
      const connection = this.connections[sessionId];
      const eagerness = connection?.state?.eagerness;

      if (eagerness) {
        const settings = getAssemblyAISettingsForEagerness(eagerness);
        activityConfig = {
          endOfTurnConfidenceThreshold: settings.endOfTurnConfidenceThreshold,
          minEndOfTurnSilenceWhenConfidentMs: settings.minEndOfTurnSilenceWhenConfident,
          maxTurnSilenceMs: settings.maxTurnSilence,
        };

        logger.info({ sessionId, eagerness }, `InworldStreamingSTT using eagerness settings: ${eagerness}`);
      }
    }

    logger.info(
      {
        sessionId,
        modelId: this.modelId,
        silenceThresholdMs: this.silenceThresholdMs,
        activityDetection: activityConfig,
      },
      `InworldStreamingSTT config ${formatSession(sessionId)} [model:${this.modelId}] [silence:${this.silenceThresholdMs}ms]`,
    );

    return {
      apiKey,
      modelId: this.modelId,
      defaultTimeout: STREAMING_STT_TIMEOUT_MS,
      defaultConfig: {
        silenceThresholdMs: this.silenceThresholdMs,
        speechConfig: {
          activityDetectionConfig: activityConfig,
        },
      },
    };
  }

  /**
   * Process multimodal stream (audio and/or text) and transcribe using StreamingSTT primitive
   * For audio: extracts audio from MultimodalContent and sends to StreamingSTT
   * For text: force a turn ending event with transcript being the input
   */
  async process(
    context: ProcessContext,
    input0: AsyncIterableIterator<GraphTypes.MultimodalContent>,
    input: DataStreamWithMetadata,
  ): Promise<DataStreamWithMetadata> {
    const multimodalStream =
      input !== undefined && input !== null && input instanceof DataStreamWithMetadata
        ? (input.toStream() as any as AsyncIterableIterator<GraphTypes.MultimodalContent>)
        : input0;

    const sessionId = context.getDatastore().get('sessionId') as string;
    const connection = this.connections[sessionId];

    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId: ${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId: ${sessionId}`);
    }

    const metadata = input?.getMetadata?.() || {};
    let previousIteration = (metadata.iteration as number) || 0;

    if (!connection.state.interactionId || connection.state.interactionId === '') {
      connection.state.interactionId = uuidv4();
      logger.info(
        { sessionId, interactionId: connection.state.interactionId },
        'InworldStreamingSTT assigned new UUID for empty interactionId',
      );
    }

    const currentId = connection.state.interactionId;
    const delimiterIndex = currentId.indexOf('#');

    if (previousIteration === 0 && delimiterIndex !== -1) {
      const iterationStr = currentId.substring(delimiterIndex + 1);
      const parsedIteration = parseInt(iterationStr, 10);
      if (!isNaN(parsedIteration) && /^\d+$/.test(iterationStr)) {
        previousIteration = parsedIteration;
      }
    }

    const iteration = previousIteration + 1;
    const baseId = delimiterIndex !== -1 ? currentId.substring(0, delimiterIndex) : currentId;
    const nextInteractionId = `${baseId}#${iteration}`;

    logger.info({ sessionId, iteration }, `InworldStreamingSTT starting transcription [iteration:${iteration}]`);

    let transcriptText = '';
    let turnDetected = false;
    let speechDetected = false;
    let audioChunkCount = 0;
    let totalAudioSamples = 0;
    let isStreamExhausted = false;
    let errorOccurred = false;
    let errorMessage = '';
    let maxDurationReached = false;
    let isTextInput = false;
    let textContent: string | undefined;
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new InworldStreamingSTTSession(sessionId, this.buildSTTConfig(sessionId), (id) =>
        this.sessions.delete(id),
      );
      this.sessions.set(sessionId, session);
    }

    try {
      const sttClient = await session.ensureClient();

      const audioQueue: Array<{ data: Buffer; sampleRate: number } | null> = [];
      let audioResolve: (() => void) | null = null;
      let audioStreamEnded = false;

      // Audio stream generator that yields converted audio chunks
      async function* createAudioStream(): AsyncIterable<{ data: Buffer; sampleRate: number }> {
        while (true) {
          if (audioQueue.length > 0) {
            const chunk = audioQueue.shift();
            if (chunk === null) {
              // End of stream signal
              return;
            }
            yield chunk;
          } else if (audioStreamEnded) {
            return;
          } else {
            // Wait for more data
            await new Promise<void>((resolve) => {
              audioResolve = resolve;
            });
          }
        }
      }

      // Function to push audio chunk to queue
      const pushAudio = (chunk: { data: Buffer; sampleRate: number } | null) => {
        audioQueue.push(chunk);
        if (audioResolve) {
          audioResolve();
          audioResolve = null;
        }
      };

      const recognitionSession = await sttClient.startRecognizeSpeechSession(createAudioStream());

      const resultProcessingPromise = (async () => {
        try {
          for await (const result of recognitionSession) {
            if (session?.shouldStopProcessing) {
              break;
            }

            if (result.text) {
              if (result.isFinal) {
                logger.info(
                  { sessionId, iteration, transcript: result.text },
                  `InworldStreamingSTT turn detected ${formatSession(sessionId)} [iteration:${iteration}]: "${result.text.substring(0, 50)}..."`,
                );

                transcriptText = result.text;
                turnDetected = true;
                if (session) session.shouldStopProcessing = true;
                break;
              } else {
                this.sendPartialTranscript(sessionId, nextInteractionId, result.text);

                if (connection?.onSpeechDetected && !speechDetected) {
                  logger.info(
                    { sessionId, iteration, interactionId: nextInteractionId },
                    `InworldStreamingSTT speech detected [iteration:${iteration}]`,
                  );
                  speechDetected = true;
                  connection.onSpeechDetected(nextInteractionId);
                }
              }
            }
          }
        } catch (error) {
          logger.error(
            { err: error, sessionId, iteration },
            `InworldStreamingSTT error processing results [iteration:${iteration}]`,
          );
          throw error;
        }
      })();

      const audioProcessingPromise = (async () => {
        let maxDurationTimeout: NodeJS.Timeout | null = null;
        try {
          logger.debug({ sessionId, iteration }, 'InworldStreamingSTT - Starting multimodal processing loop');

          // Safety timer: prevent infinite loops if no turn is detected
          maxDurationTimeout = setTimeout(() => {
            maxDurationReached = true;
          }, this.MAX_TRANSCRIPTION_DURATION_MS);

          while (true) {
            if (session?.shouldStopProcessing) {
              break;
            }

            if (maxDurationReached) {
              if (!transcriptText) {
                logger.warn(
                  { sessionId, iteration },
                  `InworldStreamingSTT max transcription duration reached [limit:${this.MAX_TRANSCRIPTION_DURATION_MS}ms]`,
                );
                break;
              }
            }

            const result = await multimodalStream.next();

            if (result.done) {
              logger.info(
                { sessionId, iteration, audioChunkCount },
                `InworldStreamingSTT multimodal stream exhausted [iteration:${iteration}] [chunks:${audioChunkCount}]`,
              );
              isStreamExhausted = true;

              connection.multimodalStreamManager?.end();
              break;
            }

            if (session?.shouldStopProcessing) break;

            const content = result.value as GraphTypes.MultimodalContent;

            if (content.text !== undefined && content.text !== null) {
              logger.info(
                { sessionId, iteration, text: content.text },
                `InworldStreamingSTT text input detected [iteration:${iteration}]: "${content.text.substring(0, 50)}..."`,
              );
              isTextInput = true;
              textContent = content.text;
              transcriptText = content.text;
              turnDetected = true;
              if (session) session.shouldStopProcessing = true;
              break;
            }

            if (content.audio === undefined || content.audio === null) {
              continue;
            }

            const audioData = content.audio.data;
            if (!audioData || audioData.length === 0) {
              continue;
            }

            audioChunkCount++;
            totalAudioSamples += audioData.byteLength;

            pushAudio({
              data: audioData,
              sampleRate: this.sampleRate,
            });

            session?.resetInactivityTimer();

            if (audioChunkCount % 20 === 0) {
              // Heartbeat log
            }
          }
        } catch (error) {
          logger.error(
            { err: error, sessionId, iteration },
            `InworldStreamingSTT error processing audio [iteration:${iteration}]`,
          );
          errorOccurred = true;
          errorMessage = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          if (maxDurationTimeout) {
            clearTimeout(maxDurationTimeout);
          }
          // Signal end of audio stream
          audioStreamEnded = true;
          pushAudio(null);
        }
      })();

      // Wait for both audio processing and result processing to complete
      await Promise.all([audioProcessingPromise.catch(() => {}), resultProcessingPromise.catch(() => {})]);

      logger.info(
        { sessionId, iteration, transcript: transcriptText },
        `InworldStreamingSTT transcription complete [iteration:${iteration}]: "${transcriptText?.substring(0, 50)}..."`,
      );

      // Clear interactionId on turn completion
      if (turnDetected) {
        logger.info(
          { sessionId, iteration, interactionId: nextInteractionId },
          'InworldStreamingSTT clearing interactionId after turn completion',
        );
        connection.state.interactionId = '';
      }

      // Tag the stream with type for runtime
      const taggedStream = Object.assign(multimodalStream, {
        type: 'MultimodalContent',
        abort: () => {
          // No-op abort handler
        },
      });

      return new DataStreamWithMetadata(taggedStream as any, {
        elementType: 'MultimodalContent',
        iteration: iteration,
        interactionId: nextInteractionId,
        session_id: sessionId,
        transcript: transcriptText,
        turn_detected: turnDetected,
        audio_chunk_count: audioChunkCount,
        total_audio_samples: totalAudioSamples,
        sample_rate: this.sampleRate,
        stream_exhausted: isStreamExhausted,
        interaction_complete: turnDetected && transcriptText.length > 0,
        error_occurred: errorOccurred,
        error_message: errorMessage,
        endpointing_latency_ms: 0,
        // Flags to match native graph structure
        is_running: !isStreamExhausted,
        is_text_input: isTextInput,
        is_interruption: false, // Not currently handling interruptions in this node
        text_content: textContent,
      });
    } catch (error) {
      logger.error(
        { err: error, sessionId, iteration },
        `InworldStreamingSTT transcription failed [iteration:${iteration}]`,
      );

      // Tag the stream with type for runtime
      const taggedStream = Object.assign(multimodalStream, {
        type: 'MultimodalContent',
        abort: () => {
          // No-op abort handler
        },
      });

      return new DataStreamWithMetadata(taggedStream as any, {
        elementType: 'MultimodalContent',
        iteration: iteration,
        interactionId: nextInteractionId,
        session_id: sessionId,
        transcript: '',
        turn_detected: false,
        audio_chunk_count: audioChunkCount,
        total_audio_samples: totalAudioSamples,
        sample_rate: this.sampleRate,
        stream_exhausted: isStreamExhausted,
        interaction_complete: false,
        error_occurred: true,
        error_message: error instanceof Error ? error.message : String(error),
        endpointing_latency_ms: 0,
        // Flags to match native graph structure
        is_running: !isStreamExhausted,
        is_text_input: isTextInput,
        is_interruption: false, // Not currently handling interruptions in this node
        text_content: textContent,
      });
    }
  }

  /**
   * Send partial transcript update to the client for real-time feedback
   */
  private sendPartialTranscript(sessionId: string, interactionId: string, text: string): void {
    const connection = this.connections[sessionId];
    if (!connection || !connection.ws) {
      return;
    }

    try {
      if (connection.onPartialTranscript) {
        connection.onPartialTranscript(text, interactionId);
      }
    } catch (error) {
      logger.error({ err: error, sessionId }, 'InworldStreamingSTT error sending partial transcript');
    }
  }

  /**
   * Update turn detection configuration for a specific session.
   * Note: For InworldStreamingSTTNode, this updates the node's stored settings for future sessions.
   * Active sessions cannot be updated in real-time as the StreamingSTT primitive
   * doesn't support mid-session configuration updates.
   */
  updateTurnDetectionSettings(
    sessionId: string,
    settings: {
      endOfTurnConfidenceThreshold: number;
      minEndOfTurnSilenceWhenConfident: number;
      maxTurnSilence: number;
    },
  ): void {
    // Update the node's stored settings for future sessions
    this.activityDetection = {
      endOfTurnConfidenceThreshold: settings.endOfTurnConfidenceThreshold,
      minEndOfTurnSilenceWhenConfidentMs: settings.minEndOfTurnSilenceWhenConfident,
      maxTurnSilenceMs: settings.maxTurnSilence,
    };

    logger.info(
      { sessionId, settings },
      'InworldStreamingSTT turn detection settings updated (will apply to future sessions)',
    );
  }

  /**
   * Close a specific session by sessionId
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      logger.info(`[InworldStreamingSTT] Closing session: ${sessionId}`);
      await session.close();
      this.sessions.delete(sessionId);
      logger.info(`[InworldStreamingSTT] Session ${sessionId} closed and removed`);
    }
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    logger.info(
      { sessionCount: this.sessions.size },
      `InworldStreamingSTT destroying node: closing ${this.sessions.size} sessions`,
    );

    const promises: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      promises.push(session.close());
    }

    await Promise.all(promises);
    this.sessions.clear();
    logger.info('InworldStreamingSTT all sessions cleaned up');
  }
}
