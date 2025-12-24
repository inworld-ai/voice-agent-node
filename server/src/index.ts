import "dotenv/config";

import { stopInworldRuntime } from "@inworld/runtime";

import cors from "cors";
import express from "express";
import { createServer } from "http";
import { parse } from "url";
import { RawData, WebSocketServer } from "ws";

import { INPUT_SAMPLE_RATE, WS_APP_PORT } from "../../constants";
import { isWSInboundMessage, type LoadRequestBody } from "../../contract";
import { RealtimeAgentProvider } from "./graph/providers/realtime_agent_provider";
import { SessionService } from "./session/session_service";
import { SessionStore } from "./session/session_store";

/**
 * Minimal bootstrap for the new realtime voice agent server.
 *
 * @remarks
 * This is intentionally small: the follow-up todos will introduce proper
 * session services, graph providers, and a graph runner.
 */
const app = express();
const server = createServer(app);
const webSocket = new WebSocketServer({ noServer: true });

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

const INWORLD_API_KEY = (process.env.INWORLD_API_KEY || "").trim();
const VOICE_ID = (process.env.VOICE_ID || "Dennis").trim() || "Dennis";
const VAD_MODEL_PATH = (
  process.env.VAD_MODEL_PATH || "models/silero_vad/silero_vad_v6.2.onnx"
).trim();
const TURN_DETECTOR_MODEL_PATH = (
  process.env.TURN_DETECTOR_MODEL_PATH ||
  "models/pipecat_smart_turn/smart-turn-v3.0.onnx"
).trim();

if (!INWORLD_API_KEY) {
  throw new Error("INWORLD_API_KEY env variable is required");
}
if (!VAD_MODEL_PATH) {
  throw new Error("VAD_MODEL_PATH env variable is required");
}
if (!TURN_DETECTOR_MODEL_PATH) {
  throw new Error("TURN_DETECTOR_MODEL_PATH env variable is required");
}

const store = new SessionStore();

const realtimeAgentProvider = new RealtimeAgentProvider(INWORLD_API_KEY, {
  voiceId: VOICE_ID,
  vadModelPath: VAD_MODEL_PATH,
  turnDetectorModelPath: TURN_DETECTOR_MODEL_PATH,
});

const sessionService = new SessionService(
  store,
  {
    async getGraph(session) {
      return realtimeAgentProvider.getGraph(session);
    },
    async destroySessionResources(sessionId) {
      await realtimeAgentProvider.destroySessionResources(sessionId);
    },
  },
  (ws, packet) => ws.send(JSON.stringify(packet)),
  INWORLD_API_KEY
);

app.post("/load", (req, res) => {
  const sessionId = String(req.query.sessionId ?? "");
  const body = req.body as LoadRequestBody;
  const session = sessionService.createSession(sessionId, body);
  res.json({
    agent: { id: session.state.agent.id, name: session.state.agent.name },
  });
});

app.post("/unload", async (req, res) => {
  const sessionId = String(req.query.sessionId ?? "");
  await sessionService.unload(sessionId);
  res.json({ message: "Session unloaded" });
});

webSocket.on("connection", (ws, request) => {
  const { query } = parse(request.url!, true);
  const sessionId = query.sessionId?.toString() ?? "";

  if (!store.has(sessionId)) {
    ws.close(1008, "Session not found");
    return;
  }

  sessionService.attachWebSocket(sessionId, ws as any);

  ws.on("error", console.error);
  ws.on("message", (data: RawData) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!isWSInboundMessage(msg)) {
        return;
      }
      sessionService.ensureStreamAndExecution(sessionId);
      const session = store.get(sessionId)!;
      if (msg.type === "audioSessionEnd") {
        session.stream?.end();
        return;
      }
      if (msg.type === "text" || msg.type === "TEXT") {
        session.stream?.pushText(msg.text);
        return;
      }
      if (msg.type === "audio" || msg.type === "AUDIO") {
        const audioData = (msg.audio as Array<Record<string, number>>).flatMap(
          (chunk) => Object.values(chunk)
        );
        session.stream?.pushAudio({
          data: audioData,
          sampleRate: INPUT_SAMPLE_RATE,
        });
      }
    } catch (e) {
      console.error("[voice_agent_server] bad message", e);
    }
  });
});

server.on("upgrade", async (request, socket, head) => {
  const { pathname } = parse(request.url!);

  if (pathname === "/session") {
    webSocket.handleUpgrade(request, socket, head, (ws) => {
      webSocket.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(WS_APP_PORT, async () => {
  console.log(`[voice_agent_server] listening on ${WS_APP_PORT}`);
});

async function gracefulShutdown(signal: string) {
  console.log(`[voice_agent_server] ${signal} received, shutting down...`);

  // Close all WebSocket connections
  webSocket.clients.forEach((ws) => ws.close(1001, "Server shutting down"));

  // Stop runtime
  await stopInworldRuntime();

  // Close HTTP server
  server.close(() => {
    console.log("[voice_agent_server] HTTP server closed");
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => process.exit(1), 10000);
}

["SIGINT", "SIGTERM"].forEach((signal) =>
  process.on(signal, () => gracefulShutdown(signal))
);
