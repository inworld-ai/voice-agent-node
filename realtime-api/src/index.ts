import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import { initTelemetry } from '@inworld/runtime/telemetry';
import cors from 'cors';
import express from 'express';
import http from 'http';
import { createServer } from 'http';
import client from 'prom-client';
import { parse } from 'url';
import { RawData, WebSocketServer } from 'ws';

import { createAppManager } from './components/app_factory';
import { RealtimeMessageHandler } from './components/realtime/realtime_message_handler';
import { WS_APP_PORT } from './config';
import { abortStream, parseEnvironmentVariables } from './helpers';
import { IAppManager } from './interfaces/app';
import { formatContext, formatError, formatSession, formatWorkspace } from './log-helpers';
import logger from './logger';

const METRICS_PORT = 9000;
const register = new client.Registry();
register.setDefaultLabels({ app: 'realtime-service' });

// Enable collection of default metrics
client.collectDefaultMetrics({ register });

const wsConnectionCounter = new client.Gauge({
  name: 'websocket_connections_total',
  help: 'Total number of active WebSocket connections',
  registers: [register],
});

const app = express();
const server = createServer(app);
const webSocket = new WebSocketServer({ noServer: true });

const metricsApp = express();
const metricsServer = http.createServer(metricsApp);

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// Parse environment variables and create the appropriate app manager
// The realtime engine is determined by REALTIME_ENGINE env variable (defaults to 'inworld')
// The graph type is determined by INWORLD_GRAPH_TYPE env variable (defaults to 'assemblyai')
const env = parseEnvironmentVariables();
const appManager: IAppManager = createAppManager(env.realtimeEngine, {
  voiceId: env.voiceId,
  ttsModelId: env.ttsModelId,
  graphVisualizationEnabled: env.graphVisualizationEnabled,
  assemblyAIApiKey: env.assemblyAIApiKey,
  fallbackModelId: env.fallbackModelId,
  graphType: env.inworldGraphType,
});

initTelemetry({
  apiKey: env.apiKey,
  appName: env.appName,
  appVersion: env.appVersion,
});

metricsApp.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (ex) {
    logger.error({ error: ex }, `Error serving metrics${formatError(ex)}`);
    res.status(500).end('Internal Server Error');
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

/**
 * Extracts the Inworld API key from request headers.
 *
 * Checks in order:
 * 1. sec-websocket-protocol header with 'basic_' prefix (for browser WebSocket clients)
 * 2. Authorization header with 'Basic ' prefix (for server-side clients)
 *
 * For sec-websocket-protocol, reconstructs any missing base64 padding since
 * '=' characters are invalid in WebSocket subprotocol names.
 */
function extractInworldApiKey(headers: http.IncomingHttpHeaders): string | undefined {
  // First, try to extract from sec-websocket-protocol header
  const wsProtocolHeader = headers['sec-websocket-protocol'] as string;
  if (wsProtocolHeader) {
    // The protocol header may contain comma-separated values, look for basic_ prefix
    const protocols = wsProtocolHeader.split(',').map((p) => p.trim());
    for (const protocol of protocols) {
      if (protocol.startsWith('basic_')) {
        let base64Key = protocol.substring(6); // Remove 'basic_' prefix to get base64 credentials

        // Reconstruct missing padding = symbols (sender cuts trailing = symbols)
        // Base64 strings should be a multiple of 4 characters in length
        const paddingNeeded = (4 - (base64Key.length % 4)) % 4;
        if (paddingNeeded > 0) {
          base64Key += '='.repeat(paddingNeeded);
        }
        return base64Key;
      }
    }
  }

  // Fallback: try to extract from Authorization header
  const authHeader = headers['authorization'] as string;
  if (authHeader && authHeader.toLowerCase().startsWith('basic ')) {
    // Authorization header format: "Basic <base64-credentials>"
    return authHeader.substring(6); // Remove 'Basic ' prefix
  }

  return undefined;
}

webSocket.on('connection', async (ws, request) => {
  wsConnectionCounter.inc(1);
  const workspaceId = (request.headers['workspace-id'] as string) || process.env.WORKSPACE_ID || 'default';

  try {
    logger.info({ workspaceId }, `WebSocket connection received ${formatWorkspace(workspaceId)}`);

    // Extract the Inworld API key from sec-websocket-protocol header
    const inworldApiKey = extractInworldApiKey(request.headers);

    const { query } = parse(request.url!, true);
    const sessionId = query.key?.toString();

    logger.info(
      { sessionId, workspaceId },
      `WebSocket connection established ${formatContext(sessionId, workspaceId)}`,
    );

    if (!sessionId) {
      logger.error(
        { workspaceId },
        `WebSocket connection rejected ${formatWorkspace(workspaceId)}: no session key provided`,
      );
      ws.close(1008, 'No session key provided');
      return;
    }

    if (!inworldApiKey) {
      logger.error(
        { sessionId, workspaceId },
        `WebSocket connection rejected ${formatContext(sessionId, workspaceId)}: no API key provided. ` +
          `Expected 'basic_' prefix in sec-websocket-protocol header or 'Basic ' prefix in Authorization header.`,
      );
      ws.close(1008, 'No API key provided');
      return;
    }

    // Get the singleton app instance from the manager
    const realtimeApp = await appManager.getApp();

    // Create session on-the-fly if it doesn't exist
    if (!realtimeApp.connections?.[sessionId]) {
      logger.info({ sessionId, workspaceId }, `Creating new session ${formatContext(sessionId, workspaceId)}`);
      // Create a minimal connection for realtime protocol
      // The session will be fully configured via session.update events
      realtimeApp.connections[sessionId] = {
        workspaceId,
        state: {
          interactionId: '', // Will be set by graph nodes
          messages: [],
          agent: null,
          userName: 'User',
          fallbackModelId: env.fallbackModelId,
        },
        apiKey: inworldApiKey,
        ws: null,
      };
    }

    realtimeApp.connections[sessionId].ws = realtimeApp.connections[sessionId].ws ?? ws;

    ws.on('error', (error) => {
      logger.error(
        { error, sessionId, workspaceId },
        `WebSocket error ${formatContext(sessionId, workspaceId)}${formatError(error)}`,
      );
    });

    ws.on('close', async (code, reason) => {
      logger.info(
        { sessionId, workspaceId, code, reason: reason.toString() },
        `WebSocket closed ${formatContext(sessionId, workspaceId)} [code:${code}] [reason:${reason.toString()}]`,
      );
      wsConnectionCounter.dec(1);

      const connection = realtimeApp.connections[sessionId];
      if (connection) {
        // Step 1: Abort any active graph executions FIRST
        abortStream(connection.currentAudioExecutionStream, 'audio execution stream', sessionId, 'on close');
        connection.currentAudioExecutionStream = undefined;

        // Step 2: Clean up multimodal stream if it exists
        if (connection.multimodalStreamManager) {
          logger.info({ sessionId }, `Ending multimodal stream ${formatSession(sessionId)} due to WebSocket close`);
          connection.multimodalStreamManager.end();
          connection.multimodalStreamManager = undefined;
        }

        // Step 3: Clean up audio graph execution reference
        if (connection.currentAudioGraphExecution) {
          connection.currentAudioGraphExecution = undefined;
        }
      }

      // Clean up AssemblyAI STT session if it exists (only for apps that have a graph)
      const graph = realtimeApp.getGraph();
      const assemblyAINode = graph?.assemblyAINode;
      if (assemblyAINode) {
        try {
          await assemblyAINode.closeSession(sessionId);
        } catch (error) {
          logger.error(
            { error, sessionId, workspaceId },
            `Error during closing Assembly Session ${formatContext(sessionId, workspaceId)}${formatError(error)}`,
          );
        }
      }

      // Clean up connection
      realtimeApp.removeSession(sessionId);
      logger.info(`[Session ${sessionId}] Session removed and resources cleaned up`);
    });

    // Use OpenAI Realtime API protocol
    const realtimeHandler = new RealtimeMessageHandler(realtimeApp, sessionId, (data: any) =>
      ws.send(JSON.stringify(data)),
    );

    // Initialize session and send session.created event
    logger.info({ sessionId, workspaceId }, `Initializing realtime session ${formatContext(sessionId, workspaceId)}`);
    await realtimeHandler.initialize();
    logger.info(
      { sessionId, workspaceId },
      `Realtime session initialized successfully ${formatContext(sessionId, workspaceId)}`,
    );

    ws.on('message', (data: RawData) => realtimeHandler.handleMessage(data));
  } catch (error) {
    logger.error(
      { error, workspaceId },
      `WebSocket connection error ${formatWorkspace(workspaceId)}${formatError(error)}`,
    );
    ws.close(1011, 'Internal server error');
  }
});

server.on('upgrade', async (request, socket, head) => {
  const { pathname, query } = parse(request.url!, true);

  if (pathname === '/session') {
    const authToken = process.env.AUTH_TOKEN;

    // Validate token if configured
    if (authToken) {
      const providedToken = query?.token?.toString();

      if (!providedToken || providedToken !== authToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    webSocket.handleUpgrade(request, socket, head, (ws) => {
      webSocket.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(WS_APP_PORT, () => {
  logger.info({ port: WS_APP_PORT }, `Application Server listening on port ${WS_APP_PORT}`);
  logger.info(
    { realtimeEngine: env.realtimeEngine },
    `Realtime engine (${env.realtimeEngine}) will be created on first connection`,
  );
});

metricsServer.listen(METRICS_PORT, () => {
  logger.info({ port: METRICS_PORT }, `Metrics Server listening on port ${METRICS_PORT}`);
});

function done() {
  logger.info('Server is closing');

  // Handle the async shutdown properly
  appManager
    .shutdown()
    .then(() => {
      metricsServer.close(() => {
        logger.info('Metrics server closed');
        process.exit(0);
      });
    })
    .catch((err) => {
      logger.error({ error: err }, `Error during shutdown${formatError(err)}`);
      process.exit(1);
    });
}

process.on('SIGINT', done);
process.on('SIGTERM', done);
process.on('SIGUSR2', done);
process.on('unhandledRejection', (err: unknown) => {
  if (err instanceof InworldError) {
    logger.error(
      {
        message: err.message,
        context: err.context,
      },
      `Inworld Error - unhandled rejection${formatError(err)}`,
    );
  } else {
    logger.error({ error: err }, `Unhandled rejection${formatError(err)}`);
  }
  process.exit(1);
});
