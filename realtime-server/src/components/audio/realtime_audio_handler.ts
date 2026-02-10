import { INPUT_SAMPLE_RATE } from '../../config';
import { IRealtimeApp } from '../../interfaces/app';
import { IInworldGraph } from '../../interfaces/graph';
import logger from '../../logger';
import * as RT from '../../types/realtime';
import { RealtimeGraphExecutor } from '../graphs/realtime_graph_executor';
import { RealtimeEventFactory } from '../realtime/realtime_event_factory';
import { RealtimeSessionManager } from '../realtime/realtime_session_manager';
import { MultimodalStreamManager } from './multimodal_stream_manager';

export class RealtimeAudioHandler {
  constructor(
    private realtimeApp: IRealtimeApp,
    private sessionKey: string,
    private send: (data: RT.ServerEvent) => void,
    private graphExecutor: RealtimeGraphExecutor,
    private sessionManager: RealtimeSessionManager,
  ) {}

  /**
   * Ensures that the audio graph execution is running.
   * Creates the multimodal stream manager and starts the graph execution if not already running.
   * @param connection - The connection object to initialize
   * @param context - Context string for logging (e.g., 'Audio', 'Text Input')
   */
  private ensureAudioGraphExecution(
    connection: NonNullable<(typeof this.realtimeApp.connections)[string]>,
    context: string = 'Audio',
  ): void {
    if (connection.multimodalStreamManager && !connection.multimodalStreamManager.isEnded()) {
      return;
    }

    connection.multimodalStreamManager = new MultimodalStreamManager();

    const session = this.sessionManager.getSession();

    // Start the audio graph execution with the stream
    const audioStreamInput = {
      sessionId: this.sessionKey,
      state: connection.state,
      voiceId: connection.state.voiceId || session.session.audio.output.voice,
    };

    // Get the Inworld graph for audio processing
    const graphWrapper = this.realtimeApp.getGraph() as IInworldGraph;

    // Start graph execution in the background - it will consume from the stream
    connection.currentAudioGraphExecution = this.graphExecutor
      .executeAudioGraph({
        sessionId: this.sessionKey,
        workspaceId: connection.workspaceId,
        apiKey: connection.apiKey,
        input: audioStreamInput,
        graphWrapper,
        multimodalStreamManager: connection.multimodalStreamManager,
      })
      .catch((error) => {
        logger.error({ err: error, sessionId: this.sessionKey }, `${context} - Error in audio graph execution`);
        // Clean up on error
        if (connection.multimodalStreamManager) {
          connection.multimodalStreamManager.end();
          connection.multimodalStreamManager = undefined;
        }
        connection.currentAudioGraphExecution = undefined;
        // Send error to websocket
        this.send(
          RealtimeEventFactory.error({
            type: 'server_error',
            message: error instanceof Error ? error.message : 'Error in audio graph execution',
          }),
        );
      });
  }

  /**
   * Handle input_audio_buffer.append event
   * Stream audio directly to Inworld SDK 0.8 audio graph
   */
  async handleInputAudioBufferAppend(event: RT.InputAudioBufferAppendEvent): Promise<void> {
    const connection = this.realtimeApp.connections[this.sessionKey];
    if (!connection) {
      logger.error({ sessionId: this.sessionKey }, 'Audio - No connection found');
      return;
    }

    // Ensure the audio graph execution is running
    this.ensureAudioGraphExecution(connection, 'Audio');

    // Decode base64 audio (Float32 at 16kHz from client - no resampling needed)
    const audioBuffer = Buffer.from(event.audio, 'base64');
    connection.multimodalStreamManager!.pushAudio({
      data: audioBuffer,
      sampleRate: INPUT_SAMPLE_RATE, // 16kHz for Inworld graph
    });
  }

  /**
   * Handle input_audio_buffer.commit event
   * End the audio stream and wait for graph to complete
   */
  async handleInputAudioBufferCommit(event: RT.InputAudioBufferCommitEvent): Promise<void> {
    const connection = this.realtimeApp.connections[this.sessionKey];
    if (!connection) {
      this.send(
        RealtimeEventFactory.error({
          type: 'invalid_request_error',
          message: 'No connection found',
          event_id: event.event_id,
        }),
      );
      return;
    }

    if (!connection.multimodalStreamManager) {
      this.send(
        RealtimeEventFactory.error({
          type: 'invalid_request_error',
          message: 'No active audio stream',
          event_id: event.event_id,
        }),
      );
      return;
    }

    logger.info(
      { sessionId: this.sessionKey },
      `Commit - Manual commit requested - ending audio stream [${this.sessionKey}]`,
    );
    connection.multimodalStreamManager.end();

    // Wait for the graph execution to complete
    if (connection.currentAudioGraphExecution) {
      await connection.currentAudioGraphExecution;
    }

    // Clear the buffer
    this.sessionManager.getSession().inputAudioBuffer = [];
  }

  /**
   * Handle input_audio_buffer.clear event
   */
  async handleInputAudioBufferClear(_event: RT.InputAudioBufferClearEvent): Promise<void> {
    const connection = this.realtimeApp.connections[this.sessionKey];
    if (connection?.multimodalStreamManager) {
      connection.multimodalStreamManager.end();
      connection.multimodalStreamManager = undefined;
      connection.currentAudioGraphExecution = undefined;
    }

    this.sessionManager.getSession().inputAudioBuffer = [];
    this.send(RealtimeEventFactory.inputAudioBufferCleared());
  }

  /**
   * Handle text input by pushing it to the multimodal stream manager
   * This unifies text and audio inputs through the same audio graph
   */
  async handleTextInput(text: string): Promise<void> {
    const connection = this.realtimeApp.connections[this.sessionKey];
    if (!connection) {
      logger.error({ sessionId: this.sessionKey }, 'Text Input - No connection found');
      return;
    }

    logger.info(
      { sessionId: this.sessionKey, text: text.substring(0, 100) },
      `Text Input - Pushing text to audio graph: "${text.substring(0, 50)}..."`,
    );

    // Ensure the audio graph execution is running
    this.ensureAudioGraphExecution(connection, 'Text Input');

    // Push the text to the stream
    connection.multimodalStreamManager!.pushText(text);

    // Don't wait for completion here - let the graph run in the background
    // The graph will automatically create a response when it processes the text
    // The response.create event will wait for completion if needed
  }
}
