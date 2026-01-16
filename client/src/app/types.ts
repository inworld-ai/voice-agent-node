export type STTService = 'assemblyai';

// Re-export Voice type from shared constants
export type { Voice } from '../../../../constants';

export type ConfigurationSession = {
  agent?: ConfigurationAgent;
  user?: ConfigurationUser;
  voiceId?: string;
  voiceName?: string; // Display name for custom cloned voice
  sttService?: STTService;
};

export type ConfigurationAgent = {
  name?: string;
  description?: string;
  motivation?: string;
  knowledge?: string;
  systemPrompt?: string;
};

export type ConfigurationScene = {
  name?: string;
};

export type ConfigurationUser = {
  name?: string;
};

export type Configuration = {
  agent?: ConfigurationAgent;
  scene?: ConfigurationScene;
  user?: ConfigurationUser;
  voiceId?: string;
  voiceName?: string; // Display name for custom cloned voice
  sttService?: STTService;
};

export type Agent = {
  name?: string;
  id?: string;
};

export type Actor = {
  name: string;
  isUser: boolean;
  isAgent: boolean;
};

export enum CHAT_HISTORY_TYPE {
  ACTOR = 'actor',
  TEXT = 'text',
  INTERACTION_END = 'interaction_end',
}

export type HistoryItemBase = {
  date: Date;
  id: string;
  interactionId?: string;
  source: Actor;
  type: CHAT_HISTORY_TYPE;
};

export type HistoryItemActor = HistoryItemBase & {
  type: CHAT_HISTORY_TYPE.ACTOR;
  text: string;
  isRecognizing?: boolean;
  author?: string;
  source: Actor;
};

export type HistoryItemInteractionEnd = HistoryItemBase & {
  type: CHAT_HISTORY_TYPE.INTERACTION_END;
};

export type ChatHistoryItem = HistoryItemActor | HistoryItemInteractionEnd;

export type InteractionLatency = {
  interactionId: string;
  userTextTimestamp?: number; // For text-based interactions
  speechCompleteTimestamp?: number; // For audio-based interactions
  firstAudioTimestamp?: number;
  latencyMs?: number;
  userText: string;
  metadata?: any; // Additional metadata from speech completion
};
