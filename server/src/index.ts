import 'dotenv/config';

import { VAD } from '@inworld/runtime/primitives/vad';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { parse } from 'url';
import { RawData, WebSocketServer } from 'ws';

import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_PROVIDER,
  DEFAULT_TTS_MODEL_ID,
  SPEECH_THRESHOLD,
  WS_APP_PORT,
} from '../../constants';
import { isWSInboundMessage, type LoadRequestBody } from '../../contract';
import { AssemblyAIProvider } from './graph/providers/assemblyai_provider';
import { RealtimeAgentProvider } from './graph/providers/realtime_agent_provider';
import { InworldGraphWrapper } from './legacy_server/components/graph';
import type { ConnectionsMap } from './legacy_server/types';
import { SessionService } from './session/session_service';
import { SessionStore } from './session/session_store';

/**
 * Minimal bootstrap for the new voice agent server.
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

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// TODO(config/env): move to env module and validate per-provider
// NOTE: treat empty strings as "unset" so we don't pass invalid config values.
const INWORLD_API_KEY = process.env.INWORLD_API_KEY || '';
const VOICE_ID = process.env.VOICE_ID || 'Dennis';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const VAD_MODEL_PATH = process.env.VAD_MODEL_PATH;
const TURN_DETECTOR_MODEL_PATH = process.env.TURN_DETECTOR_MODEL_PATH;
const ASSEMBLY_AI_API_KEY = process.env.ASSEMBLY_AI_API_KEY || '';
const LLM_PROVIDER = process.env.LLM_PROVIDER || DEFAULT_PROVIDER;
const LLM_MODEL_NAME = process.env.LLM_MODEL_NAME || DEFAULT_LLM_MODEL_NAME;
const TTS_MODEL_ID = process.env.TTS_MODEL_ID || DEFAULT_TTS_MODEL_ID;
const DISABLE_AUTO_INTERRUPTION =
  (process.env.DISABLE_AUTO_INTERRUPTION || '').toLowerCase().trim() === 'true';

const store = new SessionStore();
const connections: ConnectionsMap = {};

let vadClientPromise: Promise<VAD> | undefined;
function getVadClient(): Promise<VAD> {
  if (!vadClientPromise) {
    if (!VAD_MODEL_PATH) {
      return Promise.reject(
        new Error('VAD_MODEL_PATH env variable is required for AssemblyAI STT'),
      );
    }
    vadClientPromise = VAD.create({
      localConfig: {
        modelPath: VAD_MODEL_PATH,
        device: { type: 'DEVICE_TYPE_CPU', index: 0 },
        defaultConfig: { speechThreshold: SPEECH_THRESHOLD },
      },
    });
  }
  return vadClientPromise;
}

const realtimeAgentProvider = new RealtimeAgentProvider(INWORLD_API_KEY, {
  voiceId: VOICE_ID,
  groqApiKey: GROQ_API_KEY,
  vadModelPath: VAD_MODEL_PATH,
  turnDetectorModelPath: TURN_DETECTOR_MODEL_PATH,
});

const assemblyProvider = new AssemblyAIProvider(async () => {
  if (!ASSEMBLY_AI_API_KEY) {
    throw new Error('ASSEMBLY_AI_API_KEY env variable is required');
  }
  const vadClient = await getVadClient();
  const wrapper = await InworldGraphWrapper.create({
    apiKey: INWORLD_API_KEY,
    llmModelName: LLM_MODEL_NAME,
    llmProvider: LLM_PROVIDER,
    voiceId: VOICE_ID,
    connections,
    graphVisualizationEnabled: false,
    disableAutoInterruption: DISABLE_AUTO_INTERRUPTION,
    ttsModelId: TTS_MODEL_ID,
    vadClient,
    assemblyAIApiKey: ASSEMBLY_AI_API_KEY,
  });
  return wrapper.graph;
});

const sessionService = new SessionService(
  store,
  {
    async getGraph(session) {
      return session.sttService === 'native'
        ? realtimeAgentProvider.getGraph(session)
        : assemblyProvider.getGraph(session);
    },
    async destroySessionResources(sessionId) {
      await realtimeAgentProvider.destroySessionResources(sessionId);
      await assemblyProvider.destroySessionResources(sessionId);
    },
  },
  (ws, packet) => ws.send(JSON.stringify(packet)),
  INWORLD_API_KEY,
);

app.post('/load', (req, res) => {
  const sessionId = String(req.query.sessionId ?? '');
  const body = req.body as LoadRequestBody;
  if (body?.sttService === 'assemblyai' && !ASSEMBLY_AI_API_KEY) {
    res.status(400).json({
      error: 'ASSEMBLY_AI_API_KEY env variable is required for AssemblyAI STT',
    });
    return;
  }
  const session = sessionService.createSession(sessionId, body);
  connections[sessionId] = {
    state: session.state as any,
    ws: undefined as any,
  } as any;
  res.json({
    agent: { id: session.state.agent.id, name: session.state.agent.name },
  });
});

app.post('/unload', async (req, res) => {
  const sessionId = String(req.query.sessionId ?? '');
  await sessionService.unload(sessionId);
  delete connections[sessionId];
  res.json({ message: 'Session unloaded' });
});

webSocket.on('connection', (ws, request) => {
  const { query } = parse(request.url!, true);
  const sessionId = query.sessionId?.toString() ?? '';

  if (!store.has(sessionId)) {
    ws.close(1008, 'Session not found');
    return;
  }

  sessionService.attachWebSocket(sessionId, ws as any);
  if (connections[sessionId]) {
    connections[sessionId].ws = ws as any;
  }

  ws.on('error', console.error);
  ws.on('message', (data: RawData) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!isWSInboundMessage(msg)) {
        return;
      }
      sessionService.ensureStreamAndExecution(sessionId);
      const session = store.get(sessionId)!;
      if (msg.type === 'audioSessionEnd') {
        session.stream?.end();
        return;
      }
      if (msg.type === 'text' || msg.type === 'TEXT') {
        session.stream?.pushText(msg.text);
        return;
      }
      if (msg.type === 'audio' || msg.type === 'AUDIO') {
        const audioData: number[] = [];
        for (let i = 0; i < (msg.audio as any[]).length; i++) {
          Object.values((msg.audio as any[])[i] as any).forEach((v) =>
            audioData.push(v as number),
          );
        }
        session.stream?.pushAudio({
          data: audioData,
          sampleRate: 16000,
        } as any);
      }
    } catch (e) {
      console.error('[voice_agent_server] bad message', e);
    }
  });
});

server.on('upgrade', async (request, socket, head) => {
  const { pathname } = parse(request.url!);

  if (pathname === '/session') {
    webSocket.handleUpgrade(request, socket, head, (ws) => {
      webSocket.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(WS_APP_PORT, async () => {
  console.log(`[voice_agent_server] listening on ${WS_APP_PORT}`);
});
