import { GraphOutputStream, GraphTypes } from '@inworld/runtime/graph';
import { v4 } from 'uuid';
import { RawData } from 'ws';

import { INPUT_SAMPLE_RATE } from '../../constants';
import { AudioInput, AudioStreamInput, EVENT_TYPE, TextInput } from '../types';
import { Connection } from '../types';
import { InworldApp } from './app';
import { AudioStreamManager } from './audio_stream_manager';
import { EventFactory } from './event_factory';
import { InworldGraphWrapper } from './graph';

export class MessageHandler {
  private INPUT_SAMPLE_RATE = INPUT_SAMPLE_RATE;
  private currentInteractionId: string = v4();

  // Keep track of the processing queue to avoid concurrent execution of the graph
  // within the same session.
  private processingQueue: (() => Promise<void>)[] = [];
  private isProcessing = false;

  constructor(
    private inworldApp: InworldApp,
    private send: (data: any) => void,
  ) {}

  private createNewInteraction(logMessage: string): string {
    this.currentInteractionId = v4();
    console.log(logMessage, this.currentInteractionId);
    this.send(EventFactory.newInteraction(this.currentInteractionId));
    return this.currentInteractionId;
  }

  async handleMessage(data: RawData, sessionId: string) {
    const message = JSON.parse(data.toString());
    switch (message.type) {
      case 'text':
      case EVENT_TYPE.TEXT:
        this.createNewInteraction('Starting a new interaction from text input');
        const textInteractionId = this.currentInteractionId;

        let textInput = {
          text: message.text,
          interactionId: textInteractionId,
          sessionId,
        } as TextInput;

        // Use shared text graph
        // Voice is selected dynamically by TTSRequestBuilderNode based on session state
        this.addToQueue(() =>
          this.executeGraph({
            sessionId,
            input: textInput,
            interactionId: textInteractionId,
            graphWrapper: this.inworldApp.graphWithTextInput,
          }),
        );

        break;

      case 'audio':
      case EVENT_TYPE.AUDIO:
        // Process audio chunk - send directly to graph for VAD processing
        await this.processAudioChunk(message, sessionId);
        break;

      case EVENT_TYPE.AUDIO_SESSION_END:
        // Audio session ended - close the stream and wait for graph completion
        console.log('Audio session ended for sessionId:', sessionId);
        const audioConnection = this.inworldApp.connections[sessionId];
        if (audioConnection?.audioStreamManager) {
          console.log('Ending audio stream for sessionId:', sessionId);
          audioConnection.audioStreamManager.end();

          // Wait for the graph execution to complete
          if (audioConnection.currentAudioGraphExecution) {
            await audioConnection.currentAudioGraphExecution;
          }
        }
        break;
    }
  }

  private async processAudioChunk(message: any, sessionId: string) {
    try {
      const connection = this.inworldApp.connections[sessionId];
      if (!connection) {
        console.error(`No connection found for sessionId: ${sessionId}`);
        return;
      }

      // Flatten audio array into single buffer
      const audioData: number[] = [];
      for (let i = 0; i < message.audio.length; i++) {
        Object.values(message.audio[i]).forEach((value) => {
          audioData.push(value as number);
        });
      }

      // Initialize audio stream manager if not already present
      if (!connection.audioStreamManager) {
        connection.audioStreamManager = new AudioStreamManager();

        // Start the graph execution with the stream
        const audioStreamInput: AudioStreamInput = {
          state: connection.state,
          sessionId,
        };

        // Get the shared audio graph
        // Voice is selected dynamically by TTSRequestBuilderNode based on session state
        const graphWrapper = await this.inworldApp.getGraphForSTTService(
          connection.sttService,
        );

        // Start graph execution in the background - it will consume from the stream
        connection.currentAudioGraphExecution =
          this.executeGraphWithAudioStream({
            sessionId,
            input: audioStreamInput,
            graphWrapper,
            audioStreamManager: connection.audioStreamManager,
          }).catch((error) => {
            console.error('Error in audio graph execution:', error);
            // Clean up on error
            if (connection.audioStreamManager) {
              connection.audioStreamManager.end();
              connection.audioStreamManager = undefined;
            }
            connection.currentAudioGraphExecution = undefined;
          });
      }

      // Push the audio chunk to the stream
      connection.audioStreamManager.pushChunk({
        data: audioData,
        sampleRate: this.INPUT_SAMPLE_RATE,
      });
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  }

  private async executeGraph({
    sessionId,
    input,
    interactionId,
    graphWrapper,
  }: {
    sessionId: string;
    input: TextInput | AudioInput;
    interactionId: string;
    graphWrapper: InworldGraphWrapper;
  }) {
    const connection = this.inworldApp.connections[sessionId];
    if (!connection) {
      throw new Error(`Failed to get connection for sessionId:${sessionId}`);
    }

    // Log state for debugging
    console.log(`[Session ${sessionId}] Executing graph with state:`, {
      messageCount: connection.state.messages?.length,
      systemPromptLength: connection.state.messages?.[0]?.content?.length,
      voiceId: connection.state.voiceId,
      agentName: connection.state.agent?.name,
    });

    const { outputStream } = await graphWrapper.graph.start(input, {
      dataStoreContent: {
        sessionId: input.sessionId,
        state: connection.state,
      },
    });

    await this.handleResponse(
      outputStream,
      interactionId,
      connection,
      sessionId,
    );

    this.send(EventFactory.interactionEnd(interactionId));
  }

  private async executeGraphWithAudioStream({
    sessionId,
    input,
    graphWrapper,
    audioStreamManager,
  }: {
    sessionId: string;
    input: AudioStreamInput;
    graphWrapper: InworldGraphWrapper;
    audioStreamManager: AudioStreamManager;
  }) {
    // Create a DataStream input following the test pattern
    // Tag the generator with 'BaseData' type so framework creates DataStream<BaseData>
    async function* audioStreamGenerator() {
      for await (const audioChunk of audioStreamManager.createStream()) {
        yield audioChunk;
      }
    }

    // Create the tagged stream with metadata
    // The metadata (sessionId, state) will be accessible to nodes via DataStreamWithMetadata
    const taggedStream = Object.assign(audioStreamGenerator(), {
      _iw_type: 'Audio',
    });

    const { outputStream } = await graphWrapper.graph.start(taggedStream, {
      dataStoreContent: {
        sessionId: input.sessionId,
        state: input.state,
      },
    });

    const connection = this.inworldApp.connections[sessionId];
    if (!connection) {
      throw new Error(`Failed to get connection for sessionId:${sessionId}`);
    }

    // Handle multiple interactions from the stream
    // Each loop iteration in AudioStreamSlicerNode produces one output
    try {
      // The graph loop will output multiple results - one per detected interaction
      let currentGraphInteractionId: string | undefined = undefined;
      let resultCount = 0;

      for await (const result of outputStream) {
        resultCount++;
        console.log(
          `[Session ${sessionId}] Processing audio interaction ${resultCount} from stream`,
        );

        // Check if result contains an error
        if (result && result.isGraphError && result.isGraphError()) {
          const errorData = result.data;
          console.error(
            `[Session ${sessionId}] Received error result from graph:`,
            errorData?.message || errorData,
            'Code:',
            errorData?.code,
          );

          // Check if this is a timeout error (code 4 = DEADLINE_EXCEEDED)
          const isTimeout =
            errorData?.code === 4 || errorData?.message?.includes('timed out');

          // Send error to client
          const effectiveInteractionId = currentGraphInteractionId || v4();
          const errorObj = new Error(
            errorData?.message || 'Graph processing error',
          );
          this.send(EventFactory.error(errorObj, effectiveInteractionId));

          // For timeout errors, close the audio session
          if (isTimeout) {
            console.error(
              `[Session ${sessionId}] ⚠️ TIMEOUT DETECTED - Closing audio session`,
            );

            // End the audio stream
            if (audioStreamManager) {
              audioStreamManager.end();
            }

            // Stop processing - don't continue with more results
            // Client will close microphone based on the error event already sent
            outputStream.abort();
            break;
          }

          // For non-timeout errors, continue processing other results
          continue;
        }

        currentGraphInteractionId = await this.processSingleResult(
          result,
          undefined, // No pre-defined interactionId for audio stream
          connection,
          sessionId,
          currentGraphInteractionId,
        );

        if (currentGraphInteractionId) {
          this.send(EventFactory.interactionEnd(currentGraphInteractionId));
        }
      }

      console.log(
        `[Session ${sessionId}] Audio stream processing complete - processed ${resultCount} result(s)`,
      );
    } catch (error) {
      console.error('Error processing audio stream interactions:', error);
      throw error;
    } finally {
      // Clean up stream manager
      connection.audioStreamManager = undefined;
      connection.currentAudioGraphExecution = undefined;
    }
  }

  private async processSingleResult(
    result: any,
    interactionId: string | undefined,
    connection: Connection,
    sessionId: string,
    currentGraphInteractionId: string | undefined,
  ): Promise<string | undefined> {

    // Log result type for debugging
    const resultType = result?.data?.constructor?.name || typeof result?.data;
    console.log(`[Session ${sessionId}] Processing result type: ${resultType}`);

    // Log detailed error info if this is a GraphError
    if (result?.isGraphError && result.isGraphError()) {
      console.error(`[Session ${sessionId}] *** GRAPH ERROR DETAILS ***`);
      console.error(`  Message: ${result?.data?.message || 'No message'}`);
      console.error(`  Code: ${result?.data?.code || 'No code'}`);
      console.error(`  Data:`, JSON.stringify(result?.data, null, 2));
    }

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

            const effectiveInteractionId = currentGraphInteractionId || v4();
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

          // Check if it's InteractionInfo (has isInterrupted property)
          if ('isInterrupted' in customData && customData.isInterrupted) {
            // InteractionInfo has interactionId field - use it directly
            const effectiveInteractionId =
              customData.interactionId || currentGraphInteractionId || v4();
            console.log(
              'Interruption detected, sending cancel to client for interactionId:',
              effectiveInteractionId,
            );
            // Send cancel event to client to stop audio playback
            this.send(EventFactory.cancelResponse(effectiveInteractionId));
            return;
          }

          // Otherwise treat as State (has messages property)
          if ('messages' in customData) {
            const text = customData.messages.at(-1).content;
            const role = customData.messages.at(-1).role;

            if (role === 'assistant') {
              return;
            }

            // Update the current graph interaction ID from the state
            // This captures the interactionId from TextInputNode or StateUpdateNode output
            currentGraphInteractionId = customData.interactionId;
            console.log(
              `Updated currentGraphInteractionId to: ${currentGraphInteractionId} (from ${role} message)`,
            );

            if (connection?.unloaded) {
              throw Error(`Session unloaded for sessionId:${sessionId}`);
            }
            if (!connection) {
              throw Error(
                `Failed to read connection for sessionId:${sessionId}`,
              );
            }
            const state = connection.state;
            if (!state) {
              throw Error(
                `Failed to read state from connection for sessionId:${sessionId}`,
              );
            }
            this.send(
              EventFactory.text(text, currentGraphInteractionId, {
                isUser: role === 'user',
              }),
            );
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
          const effectiveInteractionId =
            currentGraphInteractionId || interactionId || v4();

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

            // Close audio session if it exists
            // Client will close microphone based on the error event already sent
            const audioConnection = this.inworldApp.connections[sessionId];
            if (audioConnection?.audioStreamManager) {
              console.log(
                `[Session ${sessionId}] Ending audio stream due to timeout`,
              );
              audioConnection.audioStreamManager.end();
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

      const effectiveInteractionId =
        currentGraphInteractionId || interactionId || v4();

      // Send error to client if it's not about empty speech
      if (
        error instanceof Error &&
        !error.message.includes('recognition produced no text')
      ) {
        this.send(EventFactory.error(error, effectiveInteractionId));
        console.log(
          `[Session ${sessionId}] Error sent to client from catch block`,
        );
      }

      // Don't throw - let the processing continue for other results
      // Return the current interaction ID so the flow can continue
    }

    return currentGraphInteractionId;
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
          interactionId,
          connection,
          sessionId,
          currentGraphInteractionId,
        );
      }
    } catch (error) {
      console.error(error);
      const effectiveInteractionId = currentGraphInteractionId || v4();
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
