// Fallback voice used by server when client doesn't specify one
// NOTE: This is only used as a fallback. The primary way to set voices is through
// the client template selection (see: client/src/app/configuration/ConfigView.tsx)
export const DEFAULT_VOICE_ID = 'Alex';
export const DEFAULT_LLM_MODEL_NAME = 'llama-3.3-70b-versatile'; //'gpt-4o-mini';
export const DEFAULT_PROVIDER = 'groq'; //'openai';
export const DEFAULT_TTS_MODEL_ID = 'inworld-tts-1';
export const DEFAULT_VAD_MODEL_PATH = 'models/silero_vad.onnx';

// Audio Configuration (used by graph-based VAD)
export const INPUT_SAMPLE_RATE = 16000;
export const TTS_SAMPLE_RATE = 24000;
export const PAUSE_DURATION_THRESHOLD_MS = 300; // Silence duration to mark end of speech interaction
export const SPEECH_THRESHOLD = 0.5; // VAD sensitivity (0.0-1.0, higher = more sensitive)

// Legacy constants (previously used by AudioHandler, now handled by graph)
export const MIN_SPEECH_DURATION_MS = 200; // decrease to capture shorter utterances
export const PRE_ROLL_MS = 500; // Add tolerance for clipping of the beginning of user speech
export const FRAME_PER_BUFFER = 1024;
export const TEXT_CONFIG = {
  maxNewTokens: 100, // 75 words
  maxPromptLength: 1000,
  repetitionPenalty: 1,
  topP: 0.5,
  temperature: 0.1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  stopSequences: ['\n\n'],
};

export const WS_APP_PORT = 4000;
