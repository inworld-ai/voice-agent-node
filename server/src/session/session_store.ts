import type { WebSocket } from "ws";

import type { STTService } from "../../../contract";
import { MultimodalStream } from "../stream/multimodal_stream";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  id: string;
}
interface Agent {
  id: string;
  name?: string;
  systemPrompt?: string;
}

export interface SessionState {
  interactionId: string;
  agent: Agent;
  userName: string;
  messages: Message[];
  voiceId?: string;
}

export interface Session {
  sessionId: string;
  ws?: WebSocket;
  state: SessionState;
  sttService: STTService;
  unloaded?: true;
  stream?: MultimodalStream;
  execution?: Promise<void>;
}

export class SessionStore {
  private sessions = new Map<string, Session>();

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  set(session: Session): void {
    this.sessions.set(session.sessionId, session);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
