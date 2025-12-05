import path from 'path';

import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_PROVIDER,
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_VAD_MODEL_PATH,
  DEFAULT_VOICE_ID,
} from '../constants';

export const parseEnvironmentVariables = () => {
  if (!process.env.INWORLD_API_KEY) {
    throw new Error('INWORLD_API_KEY env variable is required');
  }

  const useGroq = (process.env.USE_GROQ || '').toLowerCase().trim() === 'true';
  const useAssemblyAI =
    (process.env.USE_ASSEMBLY_AI || '').toLowerCase().trim() === 'true';

  // Validate required API keys based on which STT service is enabled as default
  if (useGroq && !process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY env variable is required when USE_GROQ=true');
  }

  if (useAssemblyAI && !process.env.ASSEMBLY_AI_API_KEY) {
    throw new Error(
      'ASSEMBLY_AI_API_KEY env variable is required when USE_ASSEMBLY_AI=true',
    );
  }

  // Warn about available STT services for dynamic selection
  const availableSTTServices = ['Inworld Remote STT'];
  if (process.env.GROQ_API_KEY) availableSTTServices.push('Groq Whisper');
  if (process.env.ASSEMBLY_AI_API_KEY) availableSTTServices.push('Assembly.AI');
  console.log(`Available STT services: ${availableSTTServices.join(', ')}`);

  return {
    apiKey: process.env.INWORLD_API_KEY,
    llmModelName: process.env.LLM_MODEL_NAME || DEFAULT_LLM_MODEL_NAME,
    llmProvider: process.env.LLM_PROVIDER || DEFAULT_PROVIDER,
    voiceId: process.env.VOICE_ID || DEFAULT_VOICE_ID,
    vadModelPath:
      process.env.VAD_MODEL_PATH ||
      path.join(__dirname, DEFAULT_VAD_MODEL_PATH),
    ttsModelId: process.env.TTS_MODEL_ID || DEFAULT_TTS_MODEL_ID,
    // Because the env variable is optional and it's a string, we need to convert it to a boolean safely
    graphVisualizationEnabled:
      (process.env.GRAPH_VISUALIZATION_ENABLED || '').toLowerCase().trim() ===
      'true',
    interruptionEnabled:
      (process.env.INTERRUPTION_ENABLED || '').toLowerCase().trim() === 'true',
    disableAutoInterruption:
      (process.env.DISABLE_AUTO_INTERRUPTION || '').toLowerCase().trim() ===
      'true',
    useGroq,
    groqApiKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL || 'whisper-large-v3',
    useAssemblyAI,
    assemblyAIApiKey: process.env.ASSEMBLY_AI_API_KEY,
  };
};
