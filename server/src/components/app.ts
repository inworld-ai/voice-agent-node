import logger from '../logger';
import { Connection } from '../types/index';
import { InworldGraphWrapper } from './graphs/graph';
import { InworldAppConfig } from './runtime_app_manager';
import { DEFAULT_VOICE_ID, DEFAULT_TTS_MODEL_ID } from '../config';

export class InworldApp {
  graphId?: string;
  voiceId: string;
  graphVisualizationEnabled: boolean;
  ttsModelId: string;
  assemblyAIApiKey: string;
  useMocks: boolean;
  connections: {
    [sessionId: string]: Connection;
  } = {};
  fallback_model_id: {provider: string, modelName: string};

  graphWithAudioInput: InworldGraphWrapper;

  private constructor(config: InworldAppConfig) {
    this.graphId = config.graphId;
    this.voiceId = config.voiceId || DEFAULT_VOICE_ID;
    this.ttsModelId = config.ttsModelId || DEFAULT_TTS_MODEL_ID;
    this.graphVisualizationEnabled = config.graphVisualizationEnabled!;
    this.assemblyAIApiKey = config.assemblyAIApiKey || '';
    this.useMocks = config.useMocks ?? false;

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
    // Create audio graph with Assembly.AI STT (handles both audio and text inputs)
    this.graphWithAudioInput = await InworldGraphWrapper.create({
      voiceId: this.voiceId,
      connections: this.connections,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      ttsModelId: this.ttsModelId,
      useAssemblyAI: true,
      assemblyAIApiKey: this.assemblyAIApiKey,
      useMocks: this.useMocks,
    });

    logger.info('✓ Audio input graph initialized (Assembly.AI STT)');
  }

  /**
   * Remove a session and clean up its connection
   */
  removeSession(sessionId: string): void {
    delete this.connections[sessionId];
  }

  async shutdown() {
    // Clear all connections
    Object.keys(this.connections).forEach(sessionId => {
      delete this.connections[sessionId];
    });

    await this.graphWithAudioInput.destroy();
  }
}
