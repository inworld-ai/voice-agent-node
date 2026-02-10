import { DEFAULT_TTS_MODEL_ID, DEFAULT_VOICE_ID } from '../../config';
import { AppConfig, IGraphWrapper, IRealtimeApp } from '../../interfaces/app';
import { IInworldGraph, InworldGraphType } from '../../interfaces/graph';
import logger from '../../logger';
import { ConnectionsMap } from '../../types';
import { createInworldGraph } from '../graphs/graph_factory';

/**
 * Extended configuration for InworldApp that includes shared connections and graph type
 */
export interface InworldAppConfig extends AppConfig {
  sharedConnections?: ConnectionsMap;
  graphType?: InworldGraphType;
}

/**
 * Inworld implementation of the realtime app interface.
 * Manages connections and the Inworld graph for audio/text processing.
 */
export class InworldApp implements IRealtimeApp {
  graphId?: string;
  voiceId: string;
  graphVisualizationEnabled: boolean;
  ttsModelId: string;
  assemblyAIApiKey: string;
  useMocks: boolean;
  connections: ConnectionsMap = {};
  fallbackModelId: string;
  graphType: InworldGraphType;

  graphWithAudioInput: IInworldGraph | undefined;

  private constructor(config: InworldAppConfig) {
    this.graphId = config.graphId;
    this.voiceId = config.voiceId || DEFAULT_VOICE_ID;
    this.ttsModelId = config.ttsModelId || DEFAULT_TTS_MODEL_ID;
    this.graphVisualizationEnabled = config.graphVisualizationEnabled!;
    this.assemblyAIApiKey = config.assemblyAIApiKey || '';
    this.useMocks = config.useMocks ?? false;
    this.fallbackModelId = config.fallbackModelId;
    this.graphType = config.graphType || 'assemblyai';

    // Use shared connections if provided, otherwise create own
    this.connections = config.sharedConnections || {};
  }

  /**
   * Factory method to create and initialize an InworldApp instance
   * Use this instead of calling the constructor directly
   */
  static async create(config: InworldAppConfig): Promise<InworldApp> {
    const app = new InworldApp(config);
    await app.initialize();
    return app;
  }

  private async initialize() {
    // Create audio graph using the factory based on graphType
    this.graphWithAudioInput = await createInworldGraph(this.graphType, {
      voiceId: this.voiceId,
      connections: this.connections,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      ttsModelId: this.ttsModelId,
      useAssemblyAI: this.graphType === 'assemblyai',
      assemblyAIApiKey: this.assemblyAIApiKey,
      useMocks: this.useMocks,
      useInworldStreamingSTT: true,
    });

    logger.info({ graphType: this.graphType }, `✓ Audio input graph initialized (${this.graphType})`);
  }

  /**
   * Get the graph wrapper (implements IRealtimeApp interface)
   */
  getGraph(): IGraphWrapper | undefined {
    return this.graphWithAudioInput;
  }

  /**
   * Remove a session and clean up its connection
   */
  removeSession(sessionId: string): void {
    delete this.connections[sessionId];
  }

  async shutdown(): Promise<void> {
    // Clear all connections
    Object.keys(this.connections).forEach((sessionId) => {
      delete this.connections[sessionId];
    });

    if (this.graphWithAudioInput) {
      await this.graphWithAudioInput.destroy();
    }
  }
}
