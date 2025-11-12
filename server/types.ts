import { AudioChunkInterface } from '@inworld/runtime/common';

import { AudioStreamManager } from './components/audio_stream_manager';

export enum EVENT_TYPE {
  TEXT = 'TEXT',
  AUDIO = 'AUDIO',
  AUDIO_SESSION_END = 'audioSessionEnd',
  NEW_INTERACTION = 'newInteraction',
  CANCEL_RESPONSE = 'CANCEL_RESPONSE',
  USER_SPEECH_COMPLETE = 'USER_SPEECH_COMPLETE',
}

export enum AUDIO_SESSION_STATE {
  PROCESSING = 'PROCESSING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  motivation: string;
  knowledge?: string[];
}

export interface TextInput {
  sessionId: string;
  text: string;
  interactionId: string;
}

export interface AudioInput {
  sessionId: string;
  audio: AudioChunkInterface;
  state: State;
  interactionId: string;
}

export interface AudioStreamInput {
  sessionId: string;
  state: State;
}

export interface State {
  interactionId: string;
  agent: Agent;
  userName: string;
  messages: ChatMessage[];
  voiceId?: string;
}

export interface Connection {
  state: State;
  ws: any;
  unloaded?: true;
  audioStreamManager?: AudioStreamManager;
  currentAudioGraphExecution?: Promise<void>;
  sttService?: string; // STT service selection for this session
}

export type ConnectionsMap = {
  [sessionId: string]: Connection;
};

export interface PromptInput {
  agent: Agent;
  messages: ChatMessage[];
  userName: string;
  userQuery: string;
}

export interface CreateGraphPropsInterface {
  apiKey: string;
  llmModelName: string;
  llmProvider: string;
  voiceId: string;
  graphVisualizationEnabled: boolean;
  disableAutoInterruption: boolean; // Flag to disable graph-based auto-interruptions (default: false, meaning auto-interruptions are enabled)
  connections: ConnectionsMap;
  withAudioInput?: boolean;
  ttsModelId: string;
  vadClient?: any; // Shared VAD client for audio processing nodes (required for all audio input pipelines)
  useAssemblyAI?: boolean; // Use Assembly.AI streaming STT (default: true)
  assemblyAIApiKey?: string; // Assembly.AI API key (required)
}

export interface InteractionInfo {
  sessionId: string;
  interactionId: string;
  text: string;
  isInterrupted: boolean;
}
