import { AudioChunkInterface } from '@inworld/runtime/common';

import { MultimodalStreamManager } from './components/multimodal_stream_manager';

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
  systemPrompt?: string; // System prompt from UI configuration
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
  multimodalStreamManager?: MultimodalStreamManager; // Unified stream manager for audio and text
  currentGraphExecution?: Promise<void>; // Current graph execution (audio or text)
  sttService?: string; // STT service selection for this session
  nativeGraph?: any; // Per-session native C++ graph instance (NativeGraphWrapper)
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
  ttsModelId: string;
  vadClient: any; // Shared VAD client for audio processing nodes (required for all graphs with audio capability)
  vadModelPath?: string; // Path to VAD model file (used by native graph)
  turnDetectorModelPath?: string; // Path to turn detector model file (used by native graph)
  systemPrompt?: string; // System prompt for the agent (used by native graph as shared prompt across sessions)
  assemblyAIApiKey?: string; // Assembly.AI API key (required for STT)
  groqApiKey?: string; // Groq API key (used by native graph for Groq STT)
  useNativeGraph?: boolean; // Use native C++ graph with JSON configuration instead of GraphBuilder DSL (default: false)
}

export interface InteractionInfo {
  type: string;
  data: {
    sessionId: string;
    interactionId: string;
    text: string;
    isInterrupted: boolean;
  };
}
