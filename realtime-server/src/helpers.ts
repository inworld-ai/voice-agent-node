import { parseRealtimeEngine } from './components/app_factory';
import { parseInworldGraphType } from './components/graphs/graph_factory';
import { DEFAULT_TTS_MODEL_ID, DEFAULT_VOICE_ID } from './config';
import logger from './logger';

export const parseEnvironmentVariables = () => {
  // Parse realtime engine first to determine which validations to apply
  const realtimeEngine = parseRealtimeEngine(process.env.REALTIME_ENGINE, 'inworld');

  // Parse Inworld graph type (only relevant when using Inworld engine)
  const inworldGraphType = parseInworldGraphType(process.env.INWORLD_GRAPH_TYPE, 'assemblyai');

  // Validate environment variables based on realtime engine
  if (realtimeEngine === 'inworld') {
    if (!process.env.INWORLD_API_KEY) {
      throw new Error('INWORLD_API_KEY env variable is required for Inworld engine');
    }

    // Assembly.AI is required only when using assemblyai graph type
    if (inworldGraphType === 'assemblyai' && !process.env.ASSEMBLYAI_API_KEY) {
      throw new Error('ASSEMBLYAI_API_KEY env variable is required for Inworld engine with assemblyai graph type');
    }

    logger.info({ realtimeEngine, graphType: inworldGraphType }, 'Realtime Engine: Inworld');
    logger.info({ graphType: inworldGraphType }, `Graph Type: ${inworldGraphType}`);
  } else if (realtimeEngine === 'openai') {
    // OpenAI engine may have different requirements
    logger.info('Realtime Engine: OpenAI (stub implementation)');
  }

  return {
    realtimeEngine,
    inworldGraphType,
    apiKey: process.env.INWORLD_API_KEY,
    voiceId: DEFAULT_VOICE_ID,
    ttsModelId: DEFAULT_TTS_MODEL_ID,
    // Because the env variable is optional and it's a string, we need to convert it to a boolean safely
    graphVisualizationEnabled: (process.env.GRAPH_VISUALIZATION_ENABLED || '').toLowerCase().trim() === 'true',
    assemblyAIApiKey: process.env.ASSEMBLYAI_API_KEY,
    appName: process.env.APP_NAME || 'realtime-service',
    appVersion: process.env.APP_VERSION || '1.0.0',
    fallbackModelId: `${process.env.DEFAULT_LLM_PROVIDER_NAME || 'google'}/${process.env.DEFAULT_LLM_MODEL_NAME || 'gemini-2.5-flash'}`,
  };
};

/**
 * Safely aborts a stream with proper error handling and logging.
 * Handles both regular streams with abort() method and ContentStreams with napiStream.
 *
 * @param stream The stream to abort (must have an abort method or napiStream with abort method)
 * @param streamName Descriptive name for the stream (for logging)
 * @param sessionId Session ID associated with the stream (for logging)
 * @param context Optional context message for logging (e.g., 'on close', 'due to cancellation')
 */
export function abortStream(
  stream: any | undefined,
  streamName: string,
  sessionId: string,
  context: string = '',
): void {
  if (!stream) {
    return;
  }

  const logContext = context ? ` ${context}` : '';
  logger.debug({ sessionId }, `Aborting ${streamName}${logContext}`);

  try {
    if (typeof stream.abort === 'function') {
      stream.abort();
    } else if (stream.napiStream && typeof stream.napiStream.abort === 'function') {
      // ContentStream doesn't have an abort() method, but we can try to abort the underlying napiStream
      stream.napiStream.abort();
    }
  } catch (error) {
    logger.error({ error, sessionId }, `Error aborting ${streamName}`);
  }
}
