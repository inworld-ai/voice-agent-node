import { AppConfig, IAppManager, RealtimeEngine } from '../interfaces/app';
import { InworldAppManager } from './inworld';
import { OpenAIAppManager } from './openai';

/**
 * Factory function to create the appropriate app manager based on realtime engine type.
 *
 * @param engine - The realtime engine to use ('inworld' or 'openai')
 * @param config - Configuration for the app manager
 * @returns An IAppManager instance
 */
export function createAppManager(engine: RealtimeEngine, config?: Partial<AppConfig>): IAppManager {
  switch (engine) {
    case 'inworld':
      return new InworldAppManager(config);
    case 'openai':
      return new OpenAIAppManager(config);
    default:
      throw new Error(`Unknown realtime engine: ${engine}. Valid engines are: 'inworld', 'openai'`);
  }
}

/**
 * Parse realtime engine from string with validation
 */
export function parseRealtimeEngine(
  value: string | undefined,
  defaultValue: RealtimeEngine = 'inworld',
): RealtimeEngine {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.toLowerCase().trim();
  if (normalized === 'inworld' || normalized === 'openai') {
    return normalized;
  }

  throw new Error(`Invalid REALTIME_ENGINE: '${value}'. Valid engines are: 'inworld', 'openai'`);
}
