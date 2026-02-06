import { ConnectionsMap } from '../types';
import { InworldGraphType } from './graph';

/**
 * Configuration for creating an app instance
 */
export interface AppConfig {
  graphId?: string;
  voiceId?: string;
  ttsModelId?: string;
  graphVisualizationEnabled?: boolean;
  assemblyAIApiKey?: string;
  useMocks?: boolean;
  fallbackModelId: string;
  graphType?: InworldGraphType;
}

/**
 * Interface for AssemblyAI STT node operations
 */
export interface IAssemblyAINode {
  closeSession(sessionId: string): Promise<void>;
  updateTurnDetectionSettings(sessionId: string, settings: any): void;
}

/**
 * Interface for graph wrapper operations
 * Abstracts the underlying graph implementation (Inworld, OpenAI, etc.)
 */
export interface IGraphWrapper {
  assemblyAINode?: IAssemblyAINode;
  destroy(): Promise<void>;
}

/**
 * Core interface for realtime app implementations
 * Both InworldApp and OpenAIApp should implement this interface
 */
export interface IRealtimeApp {
  // Connection management
  connections: ConnectionsMap;

  // Configuration properties
  voiceId: string;
  fallbackModelId: string;

  // Graph accessor (optional - some implementations may not have a graph)
  getGraph(): IGraphWrapper | undefined;

  // Session management
  removeSession(sessionId: string): void;

  // Lifecycle management
  shutdown(): Promise<void>;
}

/**
 * Interface for app manager implementations
 * Manages the lifecycle of IRealtimeApp instances
 */
export interface IAppManager {
  /**
   * Get the app instance, creating it if needed (lazy initialization)
   */
  getApp(configOverrides?: Partial<AppConfig>): Promise<IRealtimeApp>;

  /**
   * Check if the app has been initialized
   */
  isInitialized(): boolean;

  /**
   * Shutdown the app and clean up all resources
   */
  shutdown(): Promise<void>;
}

/**
 * Available realtime engine types for the factory
 */
export type RealtimeEngine = 'inworld' | 'openai';
