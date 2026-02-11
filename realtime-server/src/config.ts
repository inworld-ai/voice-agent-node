// Audio Configuration Constants
export const TTS_SAMPLE_RATE = 24000; // Sample rate for TTS output
export const INPUT_SAMPLE_RATE = 16000; // Sample rate for STT input (Assembly.AI)
export const CLIENT_INPUT_SAMPLE_RATE = 24000 as const; // Sample rate for client capture (resampled to INPUT_SAMPLE_RATE on server)
export const STREAMING_STT_TIMEOUT_MS = 40000; // Streaming STT gRPC timeout and max turn duration

// Server Configuration
export const WS_APP_PORT = 4000; // WebSocket server port

// Voice and TTS Configuration
export const DEFAULT_VOICE_ID = process.env.VOICE_ID || 'Dennis';
export const DEFAULT_TTS_MODEL_ID = process.env.TTS_MODEL_ID || 'inworld-tts-1.5-mini';

// Mixpanel Configuration
export const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN;
