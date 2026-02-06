// Voice Configuration
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
