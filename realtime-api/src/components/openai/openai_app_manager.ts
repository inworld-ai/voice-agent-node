import { AppConfig, IAppManager, IRealtimeApp } from '../../interfaces/app';
import logger from '../../logger';
import { Connection } from '../../types/index';
import { OpenAIApp, OpenAIAppConfig } from './openai_app';

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
 * OpenAIAppManager manages a single OpenAIApp instance.
 * Implements IAppManager interface for compatibility with the app factory.
 *
 * This is a stub implementation that can be extended for OpenAI's Realtime API.
 */
export class OpenAIAppManager implements IAppManager {
  private app: OpenAIApp | null = null;
  private defaultConfig: Partial<AppConfig>;
  private initPromise: Promise<OpenAIApp> | null = null;

  // Shared connections map for all sessions
  private sharedConnections: { [sessionId: string]: Connection } = {};

  constructor(defaultConfig?: Partial<AppConfig>) {
    this.defaultConfig = defaultConfig || {};
  }

  /**
   * Get the singleton OpenAIApp instance, creating it if needed.
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

  private async createApp(configOverrides?: Partial<AppConfig>): Promise<OpenAIApp> {
    logger.info('Creating OpenAIApp instance');

    const finalConfig: OpenAIAppConfig = {
      voiceId: getStringConfig(configOverrides?.voiceId, this.defaultConfig.voiceId),
      graphVisualizationEnabled: getBooleanConfig(
        configOverrides?.graphVisualizationEnabled,
        this.defaultConfig.graphVisualizationEnabled,
        process.env.GRAPH_VISUALIZATION_ENABLED,
        false,
      ),
      useMocks: getBooleanConfig(configOverrides?.useMocks, this.defaultConfig.useMocks, process.env.USE_MOCKS, false),
      sharedConnections: this.sharedConnections,
      fallbackModelId: getStringConfig(configOverrides?.fallbackModelId, this.defaultConfig.fallbackModelId),
      openaiApiKey: process.env.OPENAI_API_KEY,
    };

    const app = await OpenAIApp.create(finalConfig);
    logger.info('OpenAIApp initialized successfully');
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
      logger.info('Shutting down OpenAIApp');
      await this.app.shutdown();
      this.app = null;
    }
  }
}
