import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { parse } from 'url';
import { RawData, WebSocketServer } from 'ws';

const { query } = require('express-validator');

import { body } from 'express-validator';

import { WS_APP_PORT } from '../constants';
import { InworldApp } from './components/app';
import { MessageHandler } from './components/message_handler';

const app = express();
const server = createServer(app);
const webSocket = new WebSocketServer({ noServer: true });

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

const inworldApp = new InworldApp();

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/voices', async (req, res) => {
  try {
    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'INWORLD_API_KEY not configured' });
    }

    const response = await fetch('https://api.inworld.ai/tts/v1/voices', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ 
        error: 'Failed to fetch voices',
        details: errorText 
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching voices:', error);
    res.status(500).json({ 
      error: 'Failed to fetch voices',
      details: error.message 
    });
  }
});

webSocket.on('connection', (ws, request) => {
  const { query } = parse(request.url!, true);
  const sessionId = query.sessionId?.toString();

  if (!inworldApp.connections?.[sessionId]) {
    console.log(`Session not found: ${sessionId}`);
    ws.close(1008, 'Session not found');
    return;
  }

  inworldApp.connections[sessionId].ws =
    inworldApp.connections[sessionId].ws ?? ws;

  ws.on('error', console.error);

  const messageHandler = new MessageHandler(inworldApp, (data: any) =>
    ws.send(JSON.stringify(data)),
  );

  ws.on('message', (data: RawData) =>
    messageHandler.handleMessage(data, sessionId),
  );

  ws.on('close', (code, reason) => {
    console.log(
      `[Session ${sessionId}] WebSocket closed: code=${code}, reason=${reason.toString()}`,
    );

    // Clean up audio stream if it exists
    const connection = inworldApp.connections[sessionId];
    if (connection?.audioStreamManager) {
      console.log(
        `[Session ${sessionId}] Ending audio stream due to WebSocket close`,
      );
      connection.audioStreamManager.end();
      connection.audioStreamManager = undefined;
    }

    // Mark connection as unloaded
    if (connection) {
      connection.unloaded = true;
    }
  });
});

app.post(
  '/load',
  query('sessionId').trim().isLength({ min: 1 }),
  body('agent').isObject(),
  body('userName').trim().isLength({ min: 1 }),
  inworldApp.load.bind(inworldApp),
);

app.post(
  '/unload',
  query('sessionId').trim().isLength({ min: 1 }),
  inworldApp.unload.bind(inworldApp),
);

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
  try {
    await inworldApp.initialize();
  } catch (error) {
    console.error(error);
  }

  console.log(`Server is running on port ${WS_APP_PORT}`);
});

async function done() {
  console.log('Server is closing');

  await inworldApp.shutdown();

  process.exit(0);
}

process.on('SIGINT', done);
process.on('SIGTERM', done);
process.on('SIGUSR2', done);
process.on('unhandledRejection', (err: Error) => {
  if (err instanceof InworldError) {
    console.error('Inworld Error: ', {
      message: err.message,
      context: err.context,
    });
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
