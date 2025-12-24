import { v4 } from "uuid";
import type { WebSocket } from "ws";

import type {
  LoadRequestBody,
  STTService,
  WSOutboundPacket,
} from "../../../contract";
import type { GraphProvider } from "../graph/graph_provider";
import { GraphRunner } from "../graph/graph_runner";
import { MultimodalStream } from "../stream/multimodal_stream";
import { type Session, SessionStore } from "./session_store";

export class SessionService {
  constructor(
    private readonly store: SessionStore,
    private readonly graphProvider: GraphProvider,
    private readonly sendToWs: (
      ws: WebSocket,
      packet: WSOutboundPacket
    ) => void,
    private readonly inworldApiKey: string
  ) {}

  createSession(sessionId: string, body: LoadRequestBody): Session {
    const agent = { ...body.agent, id: v4() };
    const systemMessageId = v4();
    const sttService: STTService = "native";

    const session: Session = {
      sessionId,
      sttService,
      state: {
        interactionId: systemMessageId,
        messages: [
          {
            role: "system",
            content: (body.agent?.systemPrompt || "").replace(
              "{userName}",
              body.userName
            ),
            id: "system" + systemMessageId,
          },
        ],
        agent,
        userName: body.userName,
        voiceId: body.voiceId,
      },
      ws: undefined,
    };

    this.store.set(session);
    return session;
  }

  attachWebSocket(sessionId: string, ws: WebSocket): Session {
    const session = this.store.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.ws = ws;
    this.store.set(session);
    return session;
  }

  async unload(sessionId: string): Promise<void> {
    const session = this.store.get(sessionId);
    if (!session) return;
    session.unloaded = true;
    session.stream?.end();
    if (session.execution) {
      await session.execution.catch((err) => {
        console.warn(
          `[SessionService] execution cleanup error for ${sessionId}:`,
          err
        );
      });
    }
    await this.graphProvider.destroySessionResources(sessionId);
    this.store.delete(sessionId);
  }

  ensureStreamAndExecution(sessionId: string): void {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.stream || session.execution) return;

    session.stream = new MultimodalStream();
    const runner = new GraphRunner((packet) => {
      if (session.ws) this.sendToWs(session.ws, packet);
    });

    session.execution = (async () => {
      const { graph } = await this.graphProvider.getGraph({
        sessionId: session.sessionId,
        sttService: session.sttService,
        state: session.state,
      });
      await runner.run({
        ctx: {
          sessionId: session.sessionId,
          userApiKey: this.inworldApiKey,
          state: session.state,
        },
        stream: session.stream!,
        graphWrapper: { graph },
      });
    })().finally(() => {
      session.stream = undefined;
      session.execution = undefined;
    });

    this.store.set(session);
  }
}
