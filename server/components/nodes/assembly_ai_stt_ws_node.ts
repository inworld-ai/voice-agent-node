import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import { VAD } from '@inworld/runtime/primitives/vad';
import { v4 } from 'uuid';
import WebSocket from 'ws';

import { Connection } from '../../types';
import { EventFactory } from '../event_factory';

/**
 * Configuration interface for AssemblyAISTTWebSocketNode
 */
export interface AssemblyAISTTWebSocketNodeConfig {
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
 * AssemblyAISTTWebSocketNode processes continuous audio streams using Assembly.AI's
 * streaming Speech-to-Text service via direct WebSocket connection.
 *
 * This node:
 * - Connects directly to Assembly.AI WebSocket endpoint
 * - Feeds audio chunks to Assembly.AI streaming transcriber
 * - Detects turn endings automatically using Assembly.AI's turn detection
 * - Uses VAD to track silence duration throughout the audio stream
 * - Returns InteractionInfo with transcribed text and silence metrics when a turn completes
 */
export class AssemblyAISTTWebSocketNode extends CustomNode {
  private apiKey: string;
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
  private wsEndpointBaseUrl: string = 'wss://streaming.assemblyai.com/v3/ws';

  // Per-session WebSocket connections
  private readonly INACTIVITY_TIMEOUT_MS = 60000; // 60 seconds
  private sessions: Map<
    string,
    {
      ws: WebSocket | null;
      wsReady: boolean;
      wsConnectionPromise: Promise<void> | null;
      assemblySessionId: string;
      sessionExpiresAt: number;
      inactivityTimeout: NodeJS.Timeout | null;
      lastActivityTime: number;
      shouldStopProcessing: boolean;
    }
  > = new Map();

  constructor(props: {
    id?: string;
    config: AssemblyAISTTWebSocketNodeConfig;
  }) {
    const { config, ...nodeProps } = props;

    if (!config.apiKey) {
      throw new Error('AssemblyAISTTWebSocketNode requires an API key.');
    }

    if (!config.connections) {
      throw new Error(
        'AssemblyAISTTWebSocketNode requires a connections object.',
      );
    }

    if (!config.vadClient) {
      throw new Error(
        'AssemblyAISTTWebSocketNode requires a VAD client. Pass the shared VAD instance from InworldApp.',
      );
    }

    super({
      id: nodeProps.id || 'assembly-ai-stt-ws-node',
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

    this.apiKey = config.apiKey;
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
   * Build WebSocket URL with query parameters
   */
  private buildWebSocketUrl(): string {
    const params = new URLSearchParams({
      sample_rate: this.sampleRate.toString(),
      format_turns: this.formatTurns.toString(),
      end_of_turn_confidence_threshold:
        this.endOfTurnConfidenceThreshold.toString(),
      min_end_of_turn_silence_when_confident:
        this.minEndOfTurnSilenceWhenConfident.toString(),
      max_turn_silence: this.maxTurnSilence.toString(),
      language: this.language,
    });

    // Add keyterms if provided
    if (this.keytermsPrompt.length > 0) {
      this.keytermsPrompt.forEach((term) => {
        params.append('keyterms_prompt', term);
      });
    }

    return `${this.wsEndpointBaseUrl}?${params.toString()}`;
  }

  /**
   * Initialize persistent WebSocket connection for a session
   */
  private initializeWebSocket(sessionId: string): void {
    console.log(
      `[AssemblyAI WS STT] Initializing persistent WebSocket connection for session: ${sessionId}`,
    );

    const session = {
      ws: null as WebSocket | null,
      wsReady: false,
      wsConnectionPromise: null as Promise<void> | null,
      assemblySessionId: '',
      sessionExpiresAt: 0,
      inactivityTimeout: null as NodeJS.Timeout | null,
      lastActivityTime: Date.now(),
      shouldStopProcessing: false,
    };

    session.wsConnectionPromise = new Promise<void>((resolve, reject) => {
      const wsUrl = this.buildWebSocketUrl();
      console.log(
        `[AssemblyAI WS STT] Connecting session ${sessionId} to: ${wsUrl}`,
      );

      session.ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: this.apiKey,
        },
      });

      session.ws.on('open', () => {
        console.log(
          `[AssemblyAI WS STT] Session ${sessionId} WebSocket connection opened`,
        );
        session.wsReady = true;
        resolve();
      });

      session.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          const msgType = message.type;

          if (msgType === 'Begin') {
            session.assemblySessionId = message.id || message.session_id || '';
            session.sessionExpiresAt = message.expires_at || 0;
            console.log(
              `[AssemblyAI WS STT] Session ${sessionId} began: Assembly ID=${session.assemblySessionId}, ExpiresAt=${session.sessionExpiresAt ? new Date(session.sessionExpiresAt * 1000).toISOString() : 'unknown'}`,
            );
          }
        } catch (error) {
          console.error(
            `[AssemblyAI WS STT] Session ${sessionId} Error handling message:`,
            error,
          );
        }
      });

      session.ws.on('error', (error: Error) => {
        console.error(
          `[AssemblyAI WS STT] Session ${sessionId} WebSocket Error:`,
          error,
        );
        session.wsReady = false;
        reject(error);
      });

      session.ws.on('close', (code: number, reason: Buffer) => {
        console.log(
          `[AssemblyAI WS STT] Session ${sessionId} WebSocket closed: Status=${code}, Reason=${reason.toString()}`,
        );
        session.wsReady = false;
      });
    });

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
      `[AssemblyAI WS STT] Closing connection for session ${sessionId} due to inactivity (inactive for ${inactiveFor}ms)`,
    );

    // Signal any running audio processing loops to stop
    session.shouldStopProcessing = true;

    if (session.ws && session.wsReady) {
      try {
        session.ws.close();
        session.wsReady = false;
        console.log(
          `[AssemblyAI WS STT] Session ${sessionId} connection closed due to inactivity`,
        );
        this.sessions.delete(sessionId);
      } catch (error) {
        console.error(
          `[AssemblyAI WS STT] Error closing session ${sessionId} connection due to inactivity:`,
          error,
        );
      }
    }
  }

  /**
   * Ensure WebSocket connection is ready for a session, reconnect if needed
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
      !session.ws ||
      !session.wsReady ||
      session.ws.readyState !== WebSocket.OPEN ||
      isExpired
    ) {
      if (isExpired) {
        console.log(
          `[AssemblyAI WS STT] Session ${sessionId} expired, reconnecting...`,
        );
      } else {
        console.log(
          `[AssemblyAI WS STT] Session ${sessionId} connection not ready, connecting...`,
        );
      }

      // Close existing connection if any
      if (session?.ws && session.ws.readyState === WebSocket.OPEN) {
        try {
          session.ws.close();
        } catch (e) {
          console.warn(
            `[AssemblyAI WS STT] Error closing old connection for session ${sessionId}:`,
            e,
          );
        }
      }

      this.initializeWebSocket(sessionId);
      session = this.sessions.get(sessionId)!;
    }

    await session.wsConnectionPromise;

    // Reset the stop flag for new processing
    session.shouldStopProcessing = false;

    // Reset inactivity timer on successful connection
    this.resetInactivityTimer(sessionId);
  }

  /**
   * Process audio stream and transcribe using Assembly.AI WebSocket
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
      `[AssemblyAI WS STT - Iteration ${iteration}] Starting transcription for session: ${sessionId}`,
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

    // Set up temporary message handler for this process call
    const messageHandler = (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        const msgType = message.type;

        if (msgType === 'Turn') {
          // Ignore turn events if we've already decided to stop
          if (shouldStopProcessing) {
            console.log(
              `[${new Date().toISOString()}] [AssemblyAI WS STT - Iteration ${iteration}] Ignoring turn event (already stopping): ${message.transcript}`,
            );
            return;
          }

          const transcript = message.transcript || '';
          const utterance = message.utterance || '';
          const isFinal = message.end_of_turn; // message.turn_is_formatted

          if (!transcript) {
            return;
          }

          this.sendCancellation(sessionId, nextInteractionId);

          // Send partial transcript updates to the client for real-time feedback
          if (!isFinal) {
            // Send partial transcript to client
            const textToSend = utterance || transcript;
            if (textToSend) {
              this.sendPartialTranscript(
                sessionId,
                nextInteractionId,
                textToSend,
              );
            }
            console.log(
              `[${new Date().toISOString()}] [AssemblyAI WS STT - Iteration ${iteration}] Partial turn: ${textToSend}`,
            );
            return;
          }

          console.log(
            `[${new Date().toISOString()}] [AssemblyAI WS STT - Iteration ${iteration}] Turn detected: ${transcript}, ${JSON.stringify(message)}`,
          );

          transcriptText = transcript;
          turnDetected = true;
          shouldStopProcessing = true;
          turnResolve(transcript);
        } else if (msgType === 'Termination') {
          const audioDuration = message.audio_duration_seconds;
          const sessionDuration = message.session_duration_seconds;
          console.log(
            `[AssemblyAI WS STT - Iteration ${iteration}] Session Terminated: Audio Duration=${audioDuration}s, Session Duration=${sessionDuration}s`,
          );
        }
      } catch (error) {
        console.error(
          `[AssemblyAI WS STT - Iteration ${iteration}] Error handling message:`,
          error,
        );
      }
    };

    try {
      // Ensure WebSocket connection is ready (reuse existing or reconnect)
      await this.ensureConnection(sessionId);
      const session = this.sessions.get(sessionId)!;
      console.log(
        `[AssemblyAI WS STT - Iteration ${iteration}] Using established WebSocket connection for session ${sessionId}`,
      );

      // Attach temporary message handler for this process call
      if (session.ws) {
        session.ws.on('message', messageHandler);
      }

      // Process audio chunks and send to Assembly.AI
      const audioProcessingPromise = (async () => {
        try {
          console.log(
            `[AssemblyAI WS STT - Iteration ${iteration}] Starting audio processing loop`,
          );

          while (true) {
            // Check if session was closed externally (e.g., due to inactivity)
            if (session.shouldStopProcessing) {
              console.log(
                `[AssemblyAI WS STT - Iteration ${iteration}] Session closed externally - stopping audio processing`,
              );
              break;
            }

            const result: {
              data: Float32Array;
              sampleRate: number;
              done: boolean;
            } = await audioStream.next();

            if (result.done) {
              console.log(
                `[AssemblyAI WS STT - Iteration ${iteration}] Audio stream exhausted after ${audioChunkCount} chunks`,
              );
              isStreamExhausted = true;
              break;
            }

            // Check if turn was detected while we were waiting for the chunk
            if (shouldStopProcessing) {
              console.log(
                `[AssemblyAI WS STT - Iteration ${iteration}] Turn detected - stopping after processing chunk`,
              );
              break;
            }

            // Double-check session wasn't closed while waiting for chunk
            if (session.shouldStopProcessing) {
              console.log(
                `[AssemblyAI WS STT - Iteration ${iteration}] Session closed during chunk wait - stopping`,
              );
              break;
            }

            // Check if we have valid audio data
            if (!result.data || result.data.length === 0) {
              continue;
            }

            audioChunkCount++;
            totalAudioSamples += result.data.length;

            // Convert Float32Array to Int16Array (PCM16)
            const pcm16Data = this.convertToPCM16(result.data);

            // Send audio data to Assembly.AI WebSocket
            try {
              if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                // Send as Buffer from Int16Array
                session.ws.send(Buffer.from(pcm16Data.buffer));
              } else {
                console.warn(
                  `[AssemblyAI WS STT - Iteration ${iteration}] WebSocket not open, skipping chunk`,
                );
              }
            } catch (sendError) {
              console.error(
                `[AssemblyAI WS STT - Iteration ${iteration}] Error sending audio chunk:`,
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
                `[AssemblyAI WS STT - Iteration ${iteration}] Processed ${audioChunkCount} chunks, ${totalAudioSamples} total samples, endpointing latency: ${endpointingLatency.toFixed(0)}ms`,
              );
            }
          }
        } catch (error) {
          console.error(
            `[AssemblyAI WS STT - Iteration ${iteration}] Error processing audio:`,
            error,
          );
          errorOccurred = true;
          errorMessage = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          // Remove the temporary message handler
          console.log(
            `[AssemblyAI WS STT - Iteration ${iteration}] Cleaning up message handler`,
          );
          if (session.ws) {
            session.ws.off('message', messageHandler);
          }
        }
      })();

      // Wait for either a turn to complete or audio processing to finish
      await Promise.race([
        turnPromise,
        audioProcessingPromise.then(() => ''), // Return empty string if stream ends without turn
      ]);

      // // Ensure audio processing is stopped
      // shouldStopProcessing = true;

      // // Wait a bit for the audio processing to finish cleanup
      // await audioProcessingPromise.catch(() => {
      //   // Ignore errors during cleanup
      // });

      // Return DataStreamWithMetadata with transcript in metadata
      console.log(
        `[${new Date().toISOString()}] [AssemblyAI WS STT - Iteration ${iteration}] Returning DataStreamWithMetadata with transcript: "${transcriptText}", endpointing latency: ${endpointingLatency.toFixed(0)}ms`,
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
        `[AssemblyAI WS STT - Iteration ${iteration}] Transcription failed:`,
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
   * Send cancellation signal to client to stop current interaction
   */
  private sendCancellation(sessionId: string, interactionId?: string): void {
    const connection = this.connections[sessionId];
    if (!connection || !connection.ws) {
      console.warn(
        `[AssemblyAI WS STT] Cannot send cancellation - no connection for session: ${sessionId}`,
      );
      return;
    }

    const effectiveInteractionId =
      interactionId || connection.state?.interactionId || v4();
    console.log(
      `[AssemblyAI WS STT] Sending cancellation for interaction: ${effectiveInteractionId}`,
    );

    try {
      const cancelEvent = EventFactory.cancelResponse(effectiveInteractionId);
      connection.ws.send(JSON.stringify(cancelEvent));
    } catch (error) {
      console.error('[AssemblyAI WS STT] Error sending cancellation:', error);
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
        `[AssemblyAI WS STT] Cannot send partial transcript - no connection for session: ${sessionId}`,
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
        '[AssemblyAI WS STT] Error sending partial transcript:',
        error,
      );
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
      console.error('[AssemblyAI WS STT] VAD detection failed:', error);
      return false; // Assume no speech on error
    }
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    console.log(
      `[AssemblyAI WS STT] Destroying node and closing ${this.sessions.size} WebSocket connection(s)`,
    );

    // Clean up all sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      // Clear inactivity timeout
      if (session.inactivityTimeout) {
        clearTimeout(session.inactivityTimeout);
        console.log(
          `[AssemblyAI WS STT] Inactivity timeout cleared for session ${sessionId}`,
        );
      }

      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        try {
          // Send termination message
          const terminateMessage = { type: 'Terminate' };
          session.ws.send(JSON.stringify(terminateMessage));

          // Wait a bit for the message to be sent, then close
          await new Promise((resolve) => setTimeout(resolve, 100));
          session.ws.close();
          session.wsReady = false;
          console.log(
            `[AssemblyAI WS STT] Session ${sessionId} WebSocket connection closed`,
          );
        } catch (error) {
          console.error(
            `[AssemblyAI WS STT] Error closing WebSocket for session ${sessionId}:`,
            error,
          );
        }
      }
    }

    this.sessions.clear();
    console.log('[AssemblyAI WS STT] All sessions cleaned up');
  }
}
