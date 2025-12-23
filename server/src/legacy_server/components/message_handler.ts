import { GraphOutputStream, GraphTypes } from '@inworld/runtime/graph';
import { v4 } from 'uuid';
import { RawData } from 'ws';

import { INPUT_SAMPLE_RATE } from '../../../../constants';
import { EVENT_TYPE } from '../types';
import { Connection } from '../types';
import { InworldApp } from './app';
import { EventFactory } from './event_factory';
import { InworldGraphWrapper } from './graph';
import { MultimodalStreamManager } from './multimodal_stream_manager';

export class MessageHandler {
  private INPUT_SAMPLE_RATE = INPUT_SAMPLE_RATE;

  // Keep track of the processing queue to avoid concurrent execution of the graph
  // within the same session.
  private processingQueue: (() => Promise<void>)[] = [];
  private isProcessing = false;

  constructor(
    private inworldApp: InworldApp,
    private send: (data: any) => void,
  ) {}

  async handleMessage(data: RawData, sessionId: string) {
    const message = JSON.parse(data.toString());
    const connection = this.inworldApp.connections[sessionId];

    if (!connection) {
      console.error(`No connection found for sessionId: ${sessionId}`);
      return;
    }

    switch (message.type) {
      case 'text':
      case EVENT_TYPE.TEXT:
        // Initialize a new multimodal stream if it doesn't exist
        if (!connection.multimodalStreamManager) {
          await this.initializeMultimodalStream(sessionId, connection);
        }
        // Push text to the multimodal stream
        connection.multimodalStreamManager.pushText(message.text);
        break;

      case 'audio':
      case EVENT_TYPE.AUDIO:
        if (!connection.multimodalStreamManager) {
          await this.initializeMultimodalStream(sessionId, connection);
        }
        // Flatten audio array into single buffer
        const audioData: number[] = [];
        for (let i = 0; i < message.audio.length; i++) {
          Object.values(message.audio[i]).forEach((value) => {
            audioData.push(value as number);
          });
        }

        // Push the audio chunk to the multimodal stream
        connection.multimodalStreamManager.pushAudio({
          data: audioData,
          sampleRate: this.INPUT_SAMPLE_RATE,
        });
        break;

      case EVENT_TYPE.AUDIO_SESSION_END:
        // Session ended - close the stream and wait for graph completion
        console.log('Stream session ended for sessionId:', sessionId);
        connection.multimodalStreamManager.end();

        // Wait for the graph execution to complete
        if (connection.currentGraphExecution) {
          await connection.currentGraphExecution;
        }
        break;
    }
  }

  /**
   * Initializes a long-running multimodal stream for a session.
   * Creates the multimodal stream manager and starts graph execution.
   * The stream can receive both text and audio messages.
   */
  private async initializeMultimodalStream(
    sessionId: string,
    connection: Connection,
  ) {
    console.log(`[Session ${sessionId}] Creating new multimodal stream`);
    connection.multimodalStreamManager = new MultimodalStreamManager();

    // Get the appropriate graph based on this session's STT service selection
    const graphWrapper = await this.inworldApp.getGraphForSTTService(
      connection.sttService,
      sessionId,
    );

    // Start graph execution with the multimodal stream (long-running)
    connection.currentGraphExecution = this.executeMultimodalStream({
      sessionId,
      graphWrapper,
      streamManager: connection.multimodalStreamManager,
    })
      .catch((error) => {
        console.error('Error in multimodal graph execution:', error);
        // Clean up on error
        if (connection.multimodalStreamManager) {
          connection.multimodalStreamManager.end();
          connection.multimodalStreamManager = undefined;
        }
        connection.currentGraphExecution = undefined;
      })
      .finally(() => {
        // Clean up when execution completes
        console.log(
          `[Session ${sessionId}] Multimodal stream execution completed`,
        );
        connection.multimodalStreamManager = undefined;
        connection.currentGraphExecution = undefined;
      });
  }

  /**
   * Executes a graph with a multimodal stream that can handle both audio and text.
   */
  private async executeMultimodalStream({
    sessionId,
    graphWrapper,
    streamManager,
  }: {
    sessionId: string;
    graphWrapper: InworldGraphWrapper | any; // Can be InworldGraphWrapper or NativeGraphWrapper
    streamManager: MultimodalStreamManager;
  }) {
    const connection = this.inworldApp.connections[sessionId];
    if (!connection) {
      throw new Error(`Failed to get connection for sessionId:${sessionId}`);
    }

    console.log(
      `[Session ${sessionId}] Starting multimodal graph execution...`,
    );

    try {
      // Create the multimodal stream iterator
      const multimodalStream = streamManager.createStream();

      // Tag with MultimodalContent type for the entry node
      const taggedStream = Object.assign(multimodalStream, {
        type: 'MultimodalContent',
      });

      // Start the graph with the multimodal stream
      const { outputStream } = await graphWrapper.graph.start(taggedStream, {
        dataStoreContent: {
          sessionId,
          state: connection.state,
        },
        userCredentials: {
          inworld_api_key: this.inworldApp.apiKey,
        },
      });

      console.log(
        `[Session ${sessionId}] Processing multimodal graph output stream...`,
      );

      // Process graph outputs
      let currentGraphInteractionId: string = v4();
      for await (const result of outputStream) {
        // Check if result contains an error
        if (result && result.isGraphError && result.isGraphError()) {
          const errorData = result.data;
          console.error(
            `[Session ${sessionId}] Received error result from graph:`,
            errorData?.message || errorData,
            'Code:',
            errorData?.code,
          );

          // Send error to client
          const errorObj = new Error(
            errorData?.message || 'Graph processing error',
          );
          this.send(EventFactory.error(errorObj, currentGraphInteractionId));

          // Check if this is a timeout error (code 4 = DEADLINE_EXCEEDED)
          const isTimeout =
            errorData?.code === 4 || errorData?.message?.includes('timed out');

          if (isTimeout) {
            console.error(
              `[Session ${sessionId}] ⚠️ TIMEOUT DETECTED - Ending stream`,
            );
            streamManager.end();
            outputStream.abort();
            break;
          }

          continue;
        }

        // Process the result
        currentGraphInteractionId = await this.processSingleResult(
          result,
          currentGraphInteractionId,
          connection,
          sessionId,
        );

        if (currentGraphInteractionId) {
          this.send(EventFactory.interactionEnd(currentGraphInteractionId));
        }
      }
    } catch (error) {
      console.error(
        `[Session ${sessionId}] Error in multimodal stream execution:`,
        error,
      );
      throw error;
    }
  }

  private async processSingleResult(
    result: any,
    interactionId: string | undefined,
    connection: Connection,
    sessionId: string,
  ): Promise<string | undefined> {
    console.log(
      `[Session ${sessionId}][${interactionId}] Processing single result...`,
    );

    try {
      await result.processResponse({
        TTSOutputStream: async (ttsStream: GraphTypes.TTSOutputStream) => {
          for await (const chunk of ttsStream) {
            // Validate audio data exists
            if (!chunk.audio?.data) {
              console.warn(
                `[Session ${sessionId}] Skipping chunk with missing audio data`,
              );
              continue;
            }

            let audioBuffer: Buffer;

            if (Array.isArray(chunk.audio.data)) {
              // The array contains byte values from a Buffer, not float values
              // Interpret these bytes as Float32 data (4 bytes per float)
              audioBuffer = Buffer.from(chunk.audio.data);
            } else if (typeof chunk.audio.data === 'string') {
              // If it's a base64 string (legacy format)
              audioBuffer = Buffer.from(chunk.audio.data, 'base64');
            } else if (Buffer.isBuffer(chunk.audio.data)) {
              // If it's already a Buffer
              audioBuffer = chunk.audio.data;
            } else {
              console.error(
                `[Session ${sessionId}] Unsupported audio data type:`,
                typeof chunk.audio.data,
              );
              continue;
            }

            if (audioBuffer.byteLength === 0) {
              console.warn(
                `[Session ${sessionId}] Skipping chunk with zero-length audio buffer`,
              );
              continue;
            }

            const effectiveInteractionId = interactionId || v4();
            const textPacket = EventFactory.text(
              chunk.text,
              effectiveInteractionId,
              {
                isAgent: true,
                name: connection.state.agent.id,
              },
            );

            this.send(
              EventFactory.audio(
                audioBuffer.toString('base64'),
                effectiveInteractionId,
                textPacket.packetId.utteranceId,
              ),
            );
            this.send(textPacket);
          }
        },
        Custom: async (customData: GraphTypes.Custom<any>) => {
          // Check if it's SpeechCompleteEvent (from SpeechCompleteNotifierNode - VAD based)
          if (customData.type === 'SPEECH_COMPLETE') {
            // Use the full interactionId from the event (compound ID like "abc123#1")
            const effectiveInteractionId =
              customData.interactionId || String(customData.iteration);
            console.log(
              `User speech complete (VAD) - Interaction: ${effectiveInteractionId}, ` +
                `Iteration: ${customData.iteration}, Samples: ${customData.totalSamples}, Endpointing Latency: ${customData.endpointingLatencyMs}ms`,
            );

            // Send USER_SPEECH_COMPLETE event to client for latency tracking
            this.send(
              EventFactory.userSpeechComplete(effectiveInteractionId, {
                totalSamples: customData.totalSamples,
                sampleRate: customData.sampleRate,
                endpointingLatencyMs: customData.endpointingLatencyMs,
                source: 'VAD',
                iteration: customData.iteration,
              }),
            );
            return;
          }

          // Check if it's InteractionInfo from native C++ graph
          if (customData.type === 'InteractionInfo') {
            // Access the nested data object
            const interactionData = customData.data || customData;
            const isInterrupted = interactionData.isInterrupted || false;
            const text = interactionData.text;
            const interactionIdFromData =
              interactionData.interaction_id ?? interactionData.interactionId;
            const endpointingLatencyMs = interactionData.endpointingLatencyMs;

            console.log(
              `[Session ${sessionId}][${interactionId}] InteractionInfo data:`,
              interactionData,
            );

            // Get effective interaction ID (0 is valid, so check for null/undefined)
            const effectiveInteractionId =
              interactionIdFromData != null
                ? String(interactionIdFromData)
                : interactionId || v4();

            // Report endpointing latency if present
            if (endpointingLatencyMs != null && endpointingLatencyMs > 0) {
              console.log(
                `User speech complete (InteractionInfo) - Interaction: ${effectiveInteractionId}, ` +
                  `Endpointing Latency: ${endpointingLatencyMs}ms`,
              );

              // Send USER_SPEECH_COMPLETE event to client for latency tracking
              this.send(
                EventFactory.userSpeechComplete(effectiveInteractionId, {
                  endpointingLatencyMs,
                  source: 'InteractionInfo',
                  iteration: interactionIdFromData,
                }),
              );
            }
            console.log(
              `[Session ${sessionId}][${interactionId}] Effective interactionId:`,
              effectiveInteractionId,
            );

            if (isInterrupted) {
              console.log(
                `[Session ${sessionId}] Interruption detected, sending cancel to client for interactionId:`,
                effectiveInteractionId,
              );
              // Send cancel event to client to stop audio playback
              this.send(EventFactory.cancelResponse(effectiveInteractionId));
            }

            // Handle normal InteractionInfo with text (from native graph)
            if (text) {
              // Update the interaction ID
              interactionId = effectiveInteractionId;
              console.log(
                `[Session ${sessionId}][${interactionId}] Updated interactionId:`,
                interactionId,
              );

              if (connection?.unloaded) {
                throw Error(`Session unloaded for sessionId:${sessionId}`);
              }
              if (!connection) {
                throw Error(
                  `Failed to read connection for sessionId:${sessionId}`,
                );
              }

              // Send the text as a user message (from STT)
              console.log(
                `[Session ${sessionId}][${interactionId}] Sending text to client:`,
                text,
              );
              this.send(
                EventFactory.text(
                  text,
                  interactionId,
                  {
                    isUser: true,
                  },
                  false,
                ),
              );
              return;
            }
            return;
          }

          if ('isInterrupted' in customData && customData.isInterrupted) {
            // InteractionInfo has interactionId field - use it directly
            const effectiveInteractionId =
              customData.interactionId || interactionId || v4();
            console.log(
              'Interruption detected, sending cancel to client for interactionId:',
              effectiveInteractionId,
            );
            // Send cancel event to client to stop audio playback
            this.send(EventFactory.cancelResponse(effectiveInteractionId));
            return;
          }
        },
        error: async (error: GraphTypes.GraphError) => {
          console.error(`[Session ${sessionId}] *** ERROR HANDLER CALLED ***`);
          console.error(
            `[Session ${sessionId}] Graph error:`,
            error.message,
            'Code:',
            error.code,
          );

          // Get effective interaction ID
          const effectiveInteractionId = interactionId || v4();

          // Check if this is a timeout error
          // Code 4 = DEADLINE_EXCEEDED in gRPC/Abseil status codes
          const isTimeout =
            error.code === 4 || error.message.includes('timed out');

          // Don't send errors for empty speech recognition (common and expected)
          if (!error.message.includes('recognition produced no text')) {
            // Convert GraphError to Error for EventFactory
            const errorObj = new Error(error.message);
            this.send(EventFactory.error(errorObj, effectiveInteractionId));
            console.log(`[Session ${sessionId}] Error sent to client`);
          } else {
            console.log(`[Session ${sessionId}] Ignoring empty speech error`);
          }

          // For timeout errors, close audio session if active
          if (isTimeout) {
            console.error(
              `[Session ${sessionId}] ⚠️ NODE TIMEOUT DETECTED - Closing audio session`,
              '\n  Possible causes:',
              '\n  - Audio stream issues or delays',
              '\n  - STT service connectivity problems',
              '\n  - Slow processing in custom nodes',
              '\n  - Network latency to external services',
            );

            // Close stream session if it exists
            // Client will close microphone based on the error event already sent
            const connection = this.inworldApp.connections[sessionId];
            if (connection?.multimodalStreamManager) {
              console.log(
                `[Session ${sessionId}] Ending multimodal stream due to timeout`,
              );
              connection.multimodalStreamManager.end();
            }
          }
        },
        default: (data: any) => {
          console.log('Unprocessed data', data);
        },
      });
    } catch (error) {
      // Catch any errors not handled by the error handler above
      console.error(
        `[Session ${sessionId}] *** CATCH BLOCK - Error processing result:***`,
        error,
      );

      const effectiveInteractionId = interactionId || v4();

      // Check if this is a CANCELLED error (expected during interruptions)
      const isCancelledError =
        error instanceof Error &&
        (error.message.includes('CANCELLED') ||
          error.message.includes('cancelled'));

      // Send error to client if it's not about empty speech or cancellation
      if (
        error instanceof Error &&
        !error.message.includes('recognition produced no text') &&
        !isCancelledError
      ) {
        this.send(EventFactory.error(error, effectiveInteractionId));
        console.log(
          `[Session ${sessionId}] Error sent to client from catch block`,
        );
      } else if (isCancelledError) {
        console.log(
          `[Session ${sessionId}] Ignoring CANCELLED error (expected during interruption)`,
        );
      }

      // Don't throw - let the processing continue for other results
      // Return the current interaction ID so the flow can continue
    }

    return interactionId;
  }

  private async handleResponse(
    outputStream: GraphOutputStream,
    interactionId: string | undefined,
    connection: Connection,
    sessionId: string,
  ): Promise<string | undefined> {
    // Track the actual interactionId being processed by the graph
    // This will be updated when we receive TextInputNode output
    let currentGraphInteractionId = interactionId;

    try {
      for await (const result of outputStream) {
        currentGraphInteractionId = await this.processSingleResult(
          result,
          currentGraphInteractionId,
          connection,
          sessionId,
        );
      }
    } catch (error) {
      console.error(error);
      const effectiveInteractionId = currentGraphInteractionId || v4();

      // Check if this is a CANCELLED error (expected during interruptions)
      const isCancelledError =
        error instanceof Error &&
        (error.message.includes('CANCELLED') ||
          error.message.includes('cancelled'));

      if (isCancelledError) {
        console.log(
          `[Session ${sessionId}] Ignoring CANCELLED error in handleResponse (expected during interruption)`,
        );
        return effectiveInteractionId;
      }

      const errorPacket = EventFactory.error(error, effectiveInteractionId);
      // Ignore errors caused by empty speech.
      if (!errorPacket.error.includes('recognition produced no text')) {
        this.send(errorPacket);
      }
      return effectiveInteractionId;
    }

    return currentGraphInteractionId;
  }

  private addToQueue(task: () => Promise<void>) {
    this.processingQueue.push(task);
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    while (this.processingQueue.length > 0) {
      const task = this.processingQueue.shift();
      if (task) {
        try {
          await task();
        } catch (error) {
          console.error('Error processing task from queue:', error);
        }
      }
    }
    this.isProcessing = false;
  }
}
