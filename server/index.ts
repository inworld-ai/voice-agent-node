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
import { generateCharacterPrompt } from './character_generator';

const app = express();
const server = createServer(app);
const webSocket = new WebSocketServer({ noServer: true });

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased for voice cloning audio uploads
app.use(express.static('frontend'));

const inworldApp = new InworldApp();

app.get('/health', (req, res) => {
  res.status(200).send('OK');
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

// Character generation endpoint (uses Inworld's LLM infrastructure)
app.post(
  '/generate-character',
  body('description').trim().isLength({ min: 1 }),
  async (req, res) => {
    try {
      const { description } = req.body;
      const result = await generateCharacterPrompt(description);
      res.json(result);
    } catch (error: any) {
      console.error('Character generation error:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to generate character' 
      });
    }
  },
);

// Voice cloning endpoint
app.post(
  '/clone-voice',
  body('audioData').isString().isLength({ min: 1 }),
  body('displayName').trim().isLength({ min: 1 }),
  async (req, res) => {
    console.log('\n🎤 VOICE CLONING');
    
    try {
      const { audioData, displayName, langCode = 'EN_US' } = req.body;

      // Use INWORLD_API_KEY (must have write permissions for voice cloning)
      const apiKey = process.env.INWORLD_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'INWORLD_API_KEY not set' });
      }

      // Workspace is required for voice cloning (no default)
      const workspace = process.env.INWORLD_WORKSPACE;
      if (!workspace || workspace.trim() === '') {
        return res.status(500).json({ 
          error: 'INWORLD_WORKSPACE is required for voice cloning. Please set it in your .env file.' 
        });
      }
      const parent = `workspaces/${workspace}`;

      console.log(`🎤 Cloning voice: "${displayName}" for workspace: ${workspace}`);

      const cloneResponse = await fetch(`https://api.inworld.ai/voices/v1/${parent}/voices:clone`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: displayName.trim(),
          langCode,
          voiceSamples: [{
            audioData,
          }],
          audioProcessingConfig: { removeBackgroundNoise: false },
        }),
      });

      if (!cloneResponse.ok) {
        const errorData = await cloneResponse.json().catch(() => ({})) as { error?: { message?: string } };
        console.error('❌ Voice clone failed:', errorData);
        return res.status(cloneResponse.status).json({ 
          error: errorData.error?.message || `Voice cloning failed (${cloneResponse.status})` 
        });
      }

      const cloneData = await cloneResponse.json() as { 
        voice?: { voiceId?: string; name?: string; displayName?: string };
        audioSamplesValidated?: Array<{ warnings?: string[]; errors?: Array<{ text: string }> }>;
      };
      
      // Check for validation errors
      const errors = cloneData.audioSamplesValidated?.[0]?.errors;
      if (errors && errors.length > 0) {
        console.error('❌ Voice clone validation errors:', errors);
        return res.status(400).json({
          error: `Voice cloning validation failed: ${errors.map(e => e.text).join(', ')}`
        });
      }

      console.log(`✅ Voice cloned: ${cloneData.voice?.voiceId}`);

      res.json({
        voiceId: cloneData.voice?.voiceId,
        voiceName: cloneData.voice?.name,
        displayName: cloneData.voice?.displayName,
        warnings: cloneData.audioSamplesValidated?.[0]?.warnings || [],
      });
    } catch (error: any) {
      console.error('❌ Error cloning voice:', error);
      res.status(500).json({ error: error.message || 'Failed to clone voice' });
    }
  },
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

function done() {
  console.log('Server is closing');

  inworldApp.shutdown();

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
