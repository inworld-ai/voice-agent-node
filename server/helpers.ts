import path from 'path';

import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_PROVIDER,
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_VAD_MODEL_PATH,
} from '../constants';

export const parseEnvironmentVariables = () => {
  if (!process.env.INWORLD_API_KEY) {
    throw new Error('INWORLD_API_KEY env variable is required');
  }

  // Validate required API keys for Assembly.AI (default STT service)
  const assemblyAIApiKey = process.env.ASSEMBLY_AI_API_KEY?.trim();
  if (!assemblyAIApiKey) {
    throw new Error(
      'ASSEMBLY_AI_API_KEY env variable is required and cannot be empty',
    );
  }

  console.log(`Available STT service: Assembly.AI`);

  return {
    apiKey: process.env.INWORLD_API_KEY,
    llmModelName: process.env.LLM_MODEL_NAME || DEFAULT_LLM_MODEL_NAME,
    llmProvider: process.env.LLM_PROVIDER || DEFAULT_PROVIDER,
    vadModelPath:
      process.env.VAD_MODEL_PATH ||
      path.join(__dirname, DEFAULT_VAD_MODEL_PATH),
    ttsModelId: process.env.TTS_MODEL_ID || DEFAULT_TTS_MODEL_ID,
    // Because the env variable is optional and it's a string, we need to convert it to a boolean safely
    graphVisualizationEnabled:
      (process.env.GRAPH_VISUALIZATION_ENABLED || '').toLowerCase().trim() ===
      'true',
    disableAutoInterruption:
      (process.env.DISABLE_AUTO_INTERRUPTION || '').toLowerCase().trim() ===
      'true',
    useAssemblyAI: true,
    assemblyAIApiKey,
  };
};
