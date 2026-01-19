// Voice Configuration (shared between client and server)
export interface Voice {
  voiceId: string;
  displayName: string;
  description: string;
  languages: string[];
  gender: 'male' | 'female';
}

export const AVAILABLE_VOICES: Voice[] = [
  // Female voices
  {
    voiceId: 'Ashley',
    displayName: 'Ashley',
    description: 'A warm, natural female voice',
    languages: ['en'],
    gender: 'female',
  },
  {
    voiceId: 'Deborah',
    displayName: 'Deborah',
    description: 'Gentle and elegant female voice',
    languages: ['en'],
    gender: 'female',
  },
  {
    voiceId: 'Hana',
    displayName: 'Hana',
    description: 'Bright, expressive young female voice, perfect for storytelling, gaming, and playful content',
    languages: ['en'],
    gender: 'female',
  },
  {
    voiceId: 'Luna',
    displayName: 'Luna',
    description: 'Calm, relaxing female voice, perfect for meditations, sleep stories, and mindfulness exercises',
    languages: ['en'],
    gender: 'female',
  },
  {
    voiceId: 'Olivia',
    displayName: 'Olivia',
    description: 'Young, British female with an upbeat, friendly tone',
    languages: ['en'],
    gender: 'female',
  },
  {
    voiceId: 'Pixie',
    displayName: 'Pixie',
    description: 'High-pitched, childlike female voice with a squeaky quality - great for a cartoon character',
    languages: ['en'],
    gender: 'female',
  },
  {
    voiceId: 'Sarah',
    displayName: 'Sarah',
    description: 'Fast-talking young adult woman, with a questioning and curious tone',
    languages: ['en'],
    gender: 'female',
  },
  {
    voiceId: 'Wendy',
    displayName: 'Wendy',
    description: 'Posh, middle-aged British female voice',
    languages: ['en'],
    gender: 'female',
  },
  // Male voices
  {
    voiceId: 'Alex',
    displayName: 'Alex',
    description: 'Energetic and expressive mid-range male voice, with a mildly nasal quality',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Blake',
    displayName: 'Blake',
    description: 'Rich, intimate male voice, perfect for audiobooks, romantic content, and reassuring narration',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Carter',
    displayName: 'Carter',
    description: 'Energetic, mature radio announcer-style male voice, great for storytelling, pep talks, and voiceovers',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Clive',
    displayName: 'Clive',
    description: 'British-accented English-language male voice with a calm, cordial quality',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Craig',
    displayName: 'Craig',
    description: 'Older British male with a refined and articulate voice',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Dennis',
    displayName: 'Dennis',
    description: 'Middle-aged man with a smooth, calm and friendly voice',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Dominus',
    displayName: 'Dominus',
    description: 'Robotic, deep male voice with a menacing quality. Perfect for villains',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Edward',
    displayName: 'Edward',
    description: 'Male with a fast-talking, emphatic and streetwise tone',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Hades',
    displayName: 'Hades',
    description: 'Commanding and gruff male voice, think an omniscient narrator or castle guard',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Mark',
    displayName: 'Mark',
    description: 'Energetic, expressive man with a rapid-fire delivery',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Ronald',
    displayName: 'Ronald',
    description: 'Confident, British man with a deep, gravelly voice',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Theodore',
    displayName: 'Theodore',
    description: 'Gravelly male voice with a time-worn quality, Irish/Scottish accent',
    languages: ['en'],
    gender: 'male',
  },
  {
    voiceId: 'Timothy',
    displayName: 'Timothy',
    description: 'Lively, upbeat American male voice',
    languages: ['en'],
    gender: 'male',
  },
];

// Fallback voice used by server when client doesn't specify one
// NOTE: This is only used as a fallback. The primary way to set voices is through
// the client template selection (see: client/src/app/configuration/ConfigView.tsx)
export const DEFAULT_VOICE_ID = 'Alex';
export const DEFAULT_LLM_MODEL_NAME = 'llama-3.3-70b-versatile'; //'gpt-4o-mini';
export const DEFAULT_PROVIDER = 'groq'; //'openai';
export const DEFAULT_TTS_MODEL_ID = 'inworld-tts-1.5-max';
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
