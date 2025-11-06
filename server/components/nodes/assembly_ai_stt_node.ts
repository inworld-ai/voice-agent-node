import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import { VAD } from '@inworld/runtime/primitives/vad';
import { AssemblyAI } from 'assemblyai';
import { v4 } from 'uuid';

import { Connection } from '../../types';
import { EventFactory } from '../event_factory';

/**
 * Configuration interface for AssemblyAISTTNode
 */
export interface AssemblyAISTTNodeConfig {
  /** Assembly.AI API key */
  apiKey: string;
  /** Connections map to access session state */
  connections: { [sessionId: string]: Connection };
  /** Pre-initialized VAD instance from the app (required for silence detection) */
  vadClient: VAD;
  /** Sample rate of the audio stream in Hz */
  sampleRate?: number;
  /** Enable turn formatting from Assembly.AI */
  formatTurns?: boolean;
  /** End of turn confidence threshold (0-1) */
  endOfTurnConfidenceThreshold?: number;
  /** Minimum silence duration when confident (in milliseconds) */
  minEndOfTurnSilenceWhenConfident?: number;
  /** Maximum turn silence (in milliseconds) */
  maxTurnSilence?: number;
  /** Language code (e.g., 'en', 'es') */
  language?: string;
  /** Keywords/keyterms to boost recognition */
  keytermsPrompt?: string[];
  /** Speech detection threshold (0.0 - 1.0, higher values increase sensitivity) */
  speechThreshold?: number;
}

/**
 * AssemblyAISTTNode processes continuous audio streams using Assembly.AI's
 * streaming Speech-to-Text service.
 *
 * This node:
 * - Feeds audio chunks to Assembly.AI streaming transcriber
 * - Detects turn endings automatically using Assembly.AI's turn detection
 * - Uses VAD to track silence duration throughout the audio stream
 * - Returns InteractionInfo with transcribed text and silence metrics when a turn completes
 */
export class AssemblyAISTTNode extends CustomNode {
  private client: AssemblyAI;
  private connections: { [sessionId: string]: Connection };
  private vad: VAD;
  private speechThreshold: number;
  private sampleRate: number;
  private formatTurns: boolean;
  private endOfTurnConfidenceThreshold: number;
  private minEndOfTurnSilenceWhenConfident: number;
  private maxTurnSilence: number;
  private language: string;
  private keytermsPrompt: string[];

  // Per-session transcriber connections
  private readonly INACTIVITY_TIMEOUT_MS = 60000; // 60 seconds
  private sessions: Map<
    string,
    {
      transcriber: any;
      transcriberReady: boolean;
      transcriberConnectionPromise: Promise<void> | null;
      assemblySessionId: string;
      sessionExpiresAt: number;
      inactivityTimeout: NodeJS.Timeout | null;
      lastActivityTime: number;
    }
  > = new Map();

  constructor(props: { id?: string; config: AssemblyAISTTNodeConfig }) {
    const { config, ...nodeProps } = props;

    if (!config.apiKey) {
      throw new Error('AssemblyAISTTNode requires an API key.');
    }

    if (!config.connections) {
      throw new Error('AssemblyAISTTNode requires a connections object.');
    }

    if (!config.vadClient) {
      throw new Error(
        'AssemblyAISTTNode requires a VAD client. Pass the shared VAD instance from InworldApp.',
      );
    }

    super({
      id: nodeProps.id || 'assembly-ai-stt-node',
      executionConfig: {
        sampleRate: config.sampleRate || 16000,
        formatTurns: config.formatTurns !== false,
        endOfTurnConfidenceThreshold:
          config.endOfTurnConfidenceThreshold || 0.4,
        minEndOfTurnSilenceWhenConfident:
          config.minEndOfTurnSilenceWhenConfident || 400,
        maxTurnSilence: config.maxTurnSilence || 1280,
        language: config.language || 'en',
        speechThreshold: config.speechThreshold || 0.5,
      },
    });

    this.client = new AssemblyAI({ apiKey: config.apiKey });
    this.connections = config.connections;
    this.vad = config.vadClient;
    this.speechThreshold = config.speechThreshold || 0.5;
    this.sampleRate = config.sampleRate || 16000;
    this.formatTurns = config.formatTurns !== false;
    this.endOfTurnConfidenceThreshold =
      config.endOfTurnConfidenceThreshold || 0.4;
    this.minEndOfTurnSilenceWhenConfident =
      config.minEndOfTurnSilenceWhenConfident || 400;
    this.maxTurnSilence = config.maxTurnSilence || 1280;
    this.language = config.language || 'en';
    this.keytermsPrompt = config.keytermsPrompt || [];
  }

  /**
   * Initialize persistent transcriber connection for a session
   */
  private initializeTranscriber(sessionId: string): void {
    console.log(
      `[AssemblyAI STT] Initializing persistent transcriber connection for session: ${sessionId}`,
    );

    const session = {
      transcriber: null as any,
      transcriberReady: false,
      transcriberConnectionPromise: null as Promise<void> | null,
      assemblySessionId: '',
      sessionExpiresAt: 0,
      inactivityTimeout: null as NodeJS.Timeout | null,
      lastActivityTime: Date.now(),
    };

    session.transcriberConnectionPromise = new Promise<void>(
      (resolve, reject) => {
        console.log(
          `[AssemblyAI STT] Creating transcriber for session ${sessionId} with config: sampleRate=${this.sampleRate}, formatTurns=${this.formatTurns}, endOfTurnConfidenceThreshold=${this.endOfTurnConfidenceThreshold}, minEndOfTurnSilenceWhenConfident=${this.minEndOfTurnSilenceWhenConfident}ms, maxTurnSilence=${this.maxTurnSilence}ms, language=${this.language}`,
        );

        // Create transcriber with configuration
        // Note: AssemblyAI SDK expects silence durations in milliseconds
        session.transcriber = this.client.streaming.transcriber({
          sampleRate: this.sampleRate,
          formatTurns: this.formatTurns,
          endOfTurnConfidenceThreshold: this.endOfTurnConfidenceThreshold,
          minEndOfTurnSilenceWhenConfident:
            this.minEndOfTurnSilenceWhenConfident,
          maxTurnSilence: this.maxTurnSilence,
          ...(this.language && { language: this.language }),
          ...(this.keytermsPrompt.length > 0 && {
            keytermsPrompt: this.keytermsPrompt,
          }),
        });

        // Set up event listeners
        session.transcriber.on('open', (event: any) => {
          console.log(
            `[AssemblyAI STT] Session ${sessionId} opened with Assembly ID: ${event.sessionId || event.session_id || 'unknown'}`,
          );
          session.assemblySessionId = event.sessionId || event.session_id || '';
          session.sessionExpiresAt = event.expires_at || 0;
          console.log(
            `[AssemblyAI STT] Session ${sessionId} began: Assembly ID=${session.assemblySessionId}, ExpiresAt=${session.sessionExpiresAt ? new Date(session.sessionExpiresAt * 1000).toISOString() : 'unknown'}`,
          );
          session.transcriberReady = true;
          resolve();
        });

        session.transcriber.on('error', (error: any) => {
          console.error(
            `[AssemblyAI STT] Session ${sessionId} Transcriber Error:`,
            error,
          );
          session.transcriberReady = false;
          reject(error);
        });

        session.transcriber.on('close', (code: any, reason: any) => {
          console.log(
            `[AssemblyAI STT] Session ${sessionId} Transcriber closed: Status=${code}, Reason=${reason}`,
          );
          session.transcriberReady = false;
        });

        // Connect to Assembly.AI
        console.log(
          `[AssemblyAI STT] Connecting session ${sessionId} to Assembly.AI...`,
        );
        session.transcriber.connect().catch((error: any) => {
          console.error(
            `[AssemblyAI STT] Session ${sessionId} Connection error:`,
            error,
          );
          reject(error);
        });
      },
    );

    this.sessions.set(sessionId, session);
  }

  /**
   * Reset the inactivity timer for a session
   */
  private resetInactivityTimer(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clear existing timeout
    if (session.inactivityTimeout) {
      clearTimeout(session.inactivityTimeout);
    }

    // Update last activity time
    session.lastActivityTime = Date.now();

    // Set new timeout
    session.inactivityTimeout = setTimeout(() => {
      this.closeConnectionDueToInactivity(sessionId);
    }, this.INACTIVITY_TIMEOUT_MS);
  }

  /**
   * Close connection due to inactivity for a session
   */
  private async closeConnectionDueToInactivity(
    sessionId: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const inactiveFor = Date.now() - session.lastActivityTime;
    console.log(
      `[AssemblyAI STT] Closing connection for session ${sessionId} due to inactivity (inactive for ${inactiveFor}ms)`,
    );

    if (session.transcriber && session.transcriberReady) {
      try {
        await session.transcriber.close();
        session.transcriberReady = false;
        console.log(
          `[AssemblyAI STT] Session ${sessionId} connection closed due to inactivity`,
        );
        this.sessions.delete(sessionId);
      } catch (error) {
        console.error(
          `[AssemblyAI STT] Error closing session ${sessionId} connection due to inactivity:`,
          error,
        );
      }
    }
  }

  /**
   * Ensure transcriber connection is ready for a session, reconnect if needed
   */
  private async ensureConnection(sessionId: string): Promise<void> {
    let session = this.sessions.get(sessionId);

    // Check if connection is expired
    const now = Math.floor(Date.now() / 1000);
    const isExpired =
      session &&
      session.sessionExpiresAt > 0 &&
      now >= session.sessionExpiresAt;

    if (
      !session ||
      !session.transcriber ||
      !session.transcriberReady ||
      isExpired
    ) {
      if (isExpired) {
        console.log(
          `[AssemblyAI STT] Session ${sessionId} expired, reconnecting...`,
        );
      } else {
        console.log(
          `[AssemblyAI STT] Session ${sessionId} connection not ready, connecting...`,
        );
      }

      // Close existing connection if any
      if (session?.transcriber) {
        try {
          await session.transcriber.close();
        } catch (e) {
          console.warn(
            `[AssemblyAI STT] Error closing old connection for session ${sessionId}:`,
            e,
          );
        }
      }

      this.initializeTranscriber(sessionId);
      session = this.sessions.get(sessionId)!;
    }

    await session.transcriberConnectionPromise;

    // Reset inactivity timer on successful connection
    this.resetInactivityTimer(sessionId);
  }

  /**
   * Process audio stream and transcribe using Assembly.AI
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

    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId: ${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId: ${sessionId}`);
    }

    console.log(
      `[AssemblyAI STT - Iteration ${iteration}] Starting transcription for session: ${sessionId}`,
    );

    // State tracking
    let transcriptText = '';
    let turnDetected = false;
    let audioChunkCount = 0;
    let totalAudioSamples = 0;
    let isStreamExhausted = false;
    let errorOccurred = false;
    let errorMessage = '';
    let shouldStopProcessing = false;
    let endpointingLatency = 0;

    // Promise to capture the turn result
    let turnResolve: (value: string) => void;
    let _turnReject: (error: any) => void;
    const turnPromise = new Promise<string>((resolve, reject) => {
      turnResolve = resolve;
      _turnReject = reject;
    });

    // Set up temporary turn event listener for this process call
    const turnHandler = (turn: any) => {
      // Ignore turn events if we've already decided to stop
      if (shouldStopProcessing) {
        console.log(
          `[${new Date().toISOString()}] [AssemblyAI STT - Iteration ${iteration}] Ignoring turn event (already stopping): ${turn.transcript}`,
        );
        return;
      }

      if (!turn.transcript) {
        return;
      }

      // Check if this is a final turn (end_of_turn = true means the turn is complete)
      const isFinal = turn.end_of_turn;
      const transcript = turn.transcript || '';
      const utterance = turn.utterance || '';

      // Send cancellation to stop any ongoing character response
      this.sendCancellation(sessionId, nextInteractionId);

      // Send partial transcript updates to the client for real-time feedback
      if (!isFinal) {
        // Send partial transcript to client
        const textToSend = utterance || transcript;
        if (textToSend) {
          this.sendPartialTranscript(sessionId, nextInteractionId, textToSend);
        }
        console.log(
          `[${new Date().toISOString()}] [AssemblyAI STT - Iteration ${iteration}] Partial turn: ${textToSend}`,
        );
        return;
      }

      console.log(
        `[${new Date().toISOString()}] [AssemblyAI STT - Iteration ${iteration}] Turn detected: ${transcript}, ${JSON.stringify(turn)}`,
      );
      transcriptText = transcript;
      turnDetected = true;
      shouldStopProcessing = true; // Signal to stop processing audio
      turnResolve(transcript);
    };

    try {
      // Ensure transcriber connection is ready (reuse existing or reconnect)
      await this.ensureConnection(sessionId);
      const session = this.sessions.get(sessionId)!;
      console.log(
        `[AssemblyAI STT - Iteration ${iteration}] Using established transcriber connection for session ${sessionId}`,
      );

      // Attach temporary turn event listener for this process call
      session.transcriber.on('turn', turnHandler);

      // Process audio chunks and send to Assembly.AI
      const audioProcessingPromise = (async () => {
        try {
          console.log(
            `[AssemblyAI STT - Iteration ${iteration}] Starting audio processing loop`,
          );

          while (true) {
            // Don't check shouldStopProcessing before await - we need to consume any pending chunk
            const result: {
              data: Float32Array;
              sampleRate: number;
              done: boolean;
            } = await audioStream.next();

            if (result.done) {
              console.log(
                `[AssemblyAI STT - Iteration ${iteration}] Audio stream exhausted after ${audioChunkCount} chunks`,
              );
              isStreamExhausted = true;
              break;
            }

            // Check if turn was detected while we were waiting for the chunk
            // We still need to process this chunk to keep the stream in a valid state
            if (shouldStopProcessing) {
              console.log(
                `[AssemblyAI STT - Iteration ${iteration}] Turn detected - processing final chunk before stopping`,
              );
            }

            // Check if we have valid audio data
            if (!result.data || result.data.length === 0) {
              // Even for empty chunks, check if we should stop after
              if (shouldStopProcessing) {
                console.log(
                  `[AssemblyAI STT - Iteration ${iteration}] Stopping after empty chunk`,
                );
                break;
              }
              continue;
            }

            audioChunkCount++;
            totalAudioSamples += result.data.length;

            // Convert Float32Array to Int16Array (PCM16)
            const pcm16Data = this.convertToPCM16(result.data);

            // Send audio data to Assembly.AI (send the buffer)
            try {
              session.transcriber.sendAudio(pcm16Data.buffer);
            } catch (sendError) {
              console.error(
                `[AssemblyAI STT - Iteration ${iteration}] Error sending audio chunk:`,
                sendError,
              );
              // Continue processing other chunks instead of failing completely
            }

            // Detect speech in this chunk using VAD (after sending to Assembly.AI)
            const isSpeech = await this.detectSpeech({
              data: result.data,
              sampleRate: result.sampleRate,
            });

            const chunkDurationMs =
              (result.data.length / result.sampleRate) * 1000;

            if (isSpeech) {
              // Speech detected - reset endpointing latency counter
              endpointingLatency = 0;
              console.log(`[${new Date().toISOString()}] Speech detected...`);
            } else {
              // No speech - accumulate endpointing latency
              endpointingLatency += chunkDurationMs;
            }

            if (audioChunkCount % 20 === 0) {
              console.log(
                `[AssemblyAI STT - Iteration ${iteration}] Processed ${audioChunkCount} chunks, ${totalAudioSamples} total samples, endpointing latency: ${endpointingLatency.toFixed(0)}ms`,
              );
            }

            // After processing the chunk, check if we should stop
            if (shouldStopProcessing) {
              console.log(
                `[AssemblyAI STT - Iteration ${iteration}] Stopping audio processing after processing chunk`,
              );
              break;
            }
          }
        } catch (error) {
          console.error(
            `[AssemblyAI STT - Iteration ${iteration}] Error processing audio:`,
            error,
          );
          errorOccurred = true;
          errorMessage = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          // Remove the temporary turn event listener
          console.log(
            `[AssemblyAI STT - Iteration ${iteration}] Cleaning up turn handler`,
          );
          try {
            // Try removeListener first (Node.js EventEmitter standard)
            if (typeof session.transcriber.removeListener === 'function') {
              session.transcriber.removeListener('turn', turnHandler);
            } else if (typeof session.transcriber.off === 'function') {
              session.transcriber.off('turn', turnHandler);
            } else {
              console.warn(
                `[AssemblyAI STT - Iteration ${iteration}] No method available to remove turn handler`,
              );
            }
          } catch (removeError) {
            console.error(
              `[AssemblyAI STT - Iteration ${iteration}] Error removing turn handler:`,
              removeError,
            );
          }
        }
      })();

      // Wait for either a turn to complete or audio processing to finish
      await Promise.race([
        turnPromise,
        audioProcessingPromise.then(() => ''), // Return empty string if stream ends without turn
      ]);

      // Ensure audio processing is stopped
      shouldStopProcessing = true;

      // Wait a bit for the audio processing to finish cleanup
      await audioProcessingPromise.catch(() => {
        // Ignore errors during cleanup
      });

      // Return DataStreamWithMetadata with transcript in metadata
      console.log(
        `[${new Date().toISOString()}] [AssemblyAI STT - Iteration ${iteration}] Returning DataStreamWithMetadata with transcript: "${transcriptText}", endpointing latency: ${endpointingLatency.toFixed(0)}ms`,
      );

      return new DataStreamWithMetadata(audioStream, {
        elementType: 'Audio',
        iteration: iteration,
        interactionId: nextInteractionId,
        session_id: sessionId,
        assembly_session_id: session.assemblySessionId,
        transcript: transcriptText,
        turn_detected: turnDetected,
        audio_chunk_count: audioChunkCount,
        total_audio_samples: totalAudioSamples,
        sample_rate: this.sampleRate,
        stream_exhausted: isStreamExhausted,
        interaction_complete: turnDetected && transcriptText.length > 0,
        error_occurred: errorOccurred,
        error_message: errorMessage,
        endpointing_latency_ms: endpointingLatency,
      });
    } catch (error) {
      console.error(
        `[AssemblyAI STT - Iteration ${iteration}] Transcription failed:`,
        error,
      );

      const session = this.sessions.get(sessionId);

      // Return DataStreamWithMetadata with error info
      return new DataStreamWithMetadata(audioStream, {
        elementType: 'Audio',
        iteration: iteration,
        interactionId: nextInteractionId,
        session_id: sessionId,
        assembly_session_id: session?.assemblySessionId || '',
        transcript: '',
        turn_detected: false,
        audio_chunk_count: audioChunkCount,
        total_audio_samples: totalAudioSamples,
        sample_rate: this.sampleRate,
        stream_exhausted: isStreamExhausted,
        interaction_complete: false,
        error_occurred: true,
        error_message: error instanceof Error ? error.message : String(error),
        endpointing_latency_ms: endpointingLatency,
      });
    }
  }

  /**
   * Convert Float32Array audio data to Int16Array PCM16 format
   * Assembly.AI expects PCM16 audio data
   */
  private convertToPCM16(float32Data: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      // Clamp values to [-1, 1] range
      const clamped = Math.max(-1, Math.min(1, float32Data[i]));
      // Convert to 16-bit PCM
      pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    return pcm16;
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
      console.error('[AssemblyAI STT] VAD detection failed:', error);
      return false; // Assume no speech on error
    }
  }

  /**
   * Send cancellation signal to client to stop current interaction
   */
  private sendCancellation(sessionId: string, interactionId?: string): void {
    const connection = this.connections[sessionId];
    if (!connection || !connection.ws) {
      console.warn(
        `[AssemblyAI STT] Cannot send cancellation - no connection for session: ${sessionId}`,
      );
      return;
    }

    const effectiveInteractionId =
      interactionId || connection.state?.interactionId || v4();
    console.log(
      `[AssemblyAI STT] Sending cancellation for interaction: ${effectiveInteractionId}`,
    );

    try {
      const cancelEvent = EventFactory.cancelResponse(effectiveInteractionId);
      connection.ws.send(JSON.stringify(cancelEvent));
    } catch (error) {
      console.error('[AssemblyAI STT] Error sending cancellation:', error);
    }
  }

  /**
   * Send partial transcript update to the client for real-time feedback
   */
  private sendPartialTranscript(
    sessionId: string,
    interactionId: string,
    text: string,
  ): void {
    const connection = this.connections[sessionId];
    if (!connection || !connection.ws) {
      console.warn(
        `[AssemblyAI STT] Cannot send partial transcript - no connection for session: ${sessionId}`,
      );
      return;
    }

    try {
      const textEvent = EventFactory.text(text, interactionId, {
        isUser: true,
      });
      // Mark as non-final for partial transcripts
      textEvent.text.final = false;
      connection.ws.send(JSON.stringify(textEvent));
    } catch (error) {
      console.error(
        '[AssemblyAI STT] Error sending partial transcript:',
        error,
      );
    }
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    console.log(
      `[AssemblyAI STT] Destroying node and closing ${this.sessions.size} transcriber connection(s)`,
    );

    // Clean up all sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      // Clear inactivity timeout
      if (session.inactivityTimeout) {
        clearTimeout(session.inactivityTimeout);
        console.log(
          `[AssemblyAI STT] Inactivity timeout cleared for session ${sessionId}`,
        );
      }

      if (session.transcriber && session.transcriberReady) {
        try {
          console.log(
            `[AssemblyAI STT] Closing transcriber connection for session ${sessionId}`,
          );
          await session.transcriber.close();
          session.transcriberReady = false;
          console.log(
            `[AssemblyAI STT] Session ${sessionId} transcriber connection closed`,
          );
        } catch (error) {
          console.error(
            `[AssemblyAI STT] Error closing transcriber for session ${sessionId}:`,
            error,
          );
        }
      }
    }

    this.sessions.clear();
    console.log('[AssemblyAI STT] All sessions cleaned up');
  }
}
