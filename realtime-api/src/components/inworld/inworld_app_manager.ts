import { stopInworldRuntime } from '@inworld/runtime';

import { AppConfig, IAppManager, IRealtimeApp } from '../../interfaces/app';
import { InworldGraphType } from '../../interfaces/graph';
import logger from '../../logger';
import { Connection } from '../../types/index';
import { parseInworldGraphType } from '../graphs/graph_factory';
import { InworldApp, InworldAppConfig } from './inworld_app';

/**
 * Helper to merge string config values with fallback chain
 */
function getStringConfig(
  configValue: string | undefined,
  defaultValue: string | undefined,
  envVar?: string | undefined,
  fallback: string = '',
): string {
  return configValue || defaultValue || envVar || fallback;
}

/**
 * Helper to merge boolean config values with fallback chain
 * Uses nullish coalescing to preserve false values
 */
function getBooleanConfig(
  configValue: boolean | undefined,
  defaultValue: boolean | undefined,
  envVar: string | undefined,
  fallback: boolean,
): boolean {
  if (configValue !== undefined) return configValue;
  if (defaultValue !== undefined) return defaultValue;
  if (envVar !== undefined && envVar.trim() !== '') {
    return envVar.toLowerCase().trim() === 'true';
  }
  return fallback;
}

/**
 * InworldAppManager manages a single InworldApp instance.
 * The graph supports multitenancy natively, so we only need one instance.
 * Implements IAppManager interface for compatibility with the app factory.
 */
export class InworldAppManager implements IAppManager {
  private app: InworldApp | null = null;
  private defaultConfig: Partial<AppConfig>;
  private initPromise: Promise<InworldApp> | null = null;

  // Shared connections map for all sessions
  private sharedConnections: { [sessionId: string]: Connection } = {};

  constructor(defaultConfig?: Partial<AppConfig>) {
    this.defaultConfig = defaultConfig || {};
  }

  /**
   * Get the singleton InworldApp instance, creating it if needed.
   * Uses lazy initialization with proper handling of concurrent calls.
   */
  async getApp(configOverrides?: Partial<AppConfig>): Promise<IRealtimeApp> {
    // Return existing app if already initialized
    if (this.app) {
      return this.app;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this.createApp(configOverrides);

    try {
      this.app = await this.initPromise;
      return this.app;
    } finally {
      this.initPromise = null;
    }
  }

  private async createApp(configOverrides?: Partial<AppConfig>): Promise<InworldApp> {
    logger.info('Creating InworldApp instance');

    // Determine graph type from config or environment
    const graphType: InworldGraphType =
      configOverrides?.graphType ||
      this.defaultConfig.graphType ||
      parseInworldGraphType(process.env.INWORLD_GRAPH_TYPE, 'assemblyai');

    const finalConfig: InworldAppConfig = {
      graphId: getStringConfig(configOverrides?.graphId, this.defaultConfig.graphId, undefined),
      voiceId: getStringConfig(configOverrides?.voiceId, this.defaultConfig.voiceId),
      ttsModelId: getStringConfig(configOverrides?.ttsModelId, this.defaultConfig.ttsModelId),
      graphVisualizationEnabled: getBooleanConfig(
        configOverrides?.graphVisualizationEnabled,
        this.defaultConfig.graphVisualizationEnabled,
        process.env.GRAPH_VISUALIZATION_ENABLED,
        false,
      ),
      assemblyAIApiKey: getStringConfig(
        configOverrides?.assemblyAIApiKey,
        this.defaultConfig.assemblyAIApiKey,
        process.env.ASSEMBLYAI_API_KEY,
      ),
      useMocks: getBooleanConfig(configOverrides?.useMocks, this.defaultConfig.useMocks, process.env.USE_MOCKS, false),
      sharedConnections: this.sharedConnections,
      fallbackModelId: getStringConfig(configOverrides?.fallbackModelId, this.defaultConfig.fallbackModelId),
      graphType,
    };

    // Validate required config based on graph type
    if (graphType === 'assemblyai' && !finalConfig.assemblyAIApiKey) {
      const error = new Error('Missing AssemblyAI API key (required for assemblyai graph type)');
      logger.error({ err: error }, 'Missing AssemblyAI API key');
      throw error;
    }

    logger.info({ graphType }, `Creating InworldApp with graph type: ${graphType}`);
    const app = await InworldApp.create(finalConfig);
    logger.info('InworldApp initialized successfully');
    return app;
  }

  /**
   * Check if the app has been initialized
   */
  isInitialized(): boolean {
    return this.app !== null;
  }

  /**
   * Shutdown the app and clean up resources
   */
  async shutdown(): Promise<void> {
    if (this.initPromise) {
      logger.info('Shutdown requested while initialization in progress - waiting for initialization to complete');
      try {
        await this.initPromise;
      } catch (err) {
        logger.warn({ err }, 'Initialization failed during shutdown wait - proceeding with cleanup');
      }
    }

    if (this.app) {
      logger.info('Shutting down InworldApp');
      await this.app.shutdown();
      this.app = null;
    }

    // Stop the global Inworld runtime
    stopInworldRuntime();
  }
}
