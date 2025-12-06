import { stopInworldRuntime } from '@inworld/runtime';
import { VADFactory } from '@inworld/runtime/primitives/vad';
import { v4 } from 'uuid';
const { validationResult } = require('express-validator');

import { parseEnvironmentVariables } from '../helpers';
import { Connection } from '../types';
import { InworldGraphWrapper } from './graph';

export class InworldApp {
  apiKey: string;
  llmModelName: string;
  llmProvider: string;
  voiceId: string;
  vadModelPath: string;
  graphVisualizationEnabled: boolean;
  disableAutoInterruption: boolean; // Flag to disable graph-based auto-interruptions (default: false, meaning auto-interruptions are enabled)
  ttsModelId: string;
  connections: {
    [sessionId: string]: Connection;
  } = {};

  vadClient: any;

  // Cached graphs by voiceId (created lazily on first use)
  private textGraphs: Map<string, InworldGraphWrapper> = new Map();
  private audioGraphs: Map<string, InworldGraphWrapper> = new Map();

  // Environment configuration for lazy graph creation
  private env: ReturnType<typeof parseEnvironmentVariables>;

  promptTemplate: string;

  async initialize() {
    this.connections = {};

    // Parse the environment variables
    this.env = parseEnvironmentVariables();

    this.apiKey = this.env.apiKey;
    this.llmModelName = this.env.llmModelName;
    this.llmProvider = this.env.llmProvider;
    this.voiceId = this.env.voiceId;
    this.vadModelPath = this.env.vadModelPath;
    this.graphVisualizationEnabled = this.env.graphVisualizationEnabled;
    this.disableAutoInterruption = this.env.disableAutoInterruption;
    this.ttsModelId = this.env.ttsModelId;

    // Initialize the VAD client for Assembly.AI
    console.log('Loading VAD model from:', this.vadModelPath);
    this.vadClient = await VADFactory.createLocal({
      modelPath: this.vadModelPath,
    });

    console.log(
      '\n✓ Graphs will be created lazily per voice on first use\n',
    );

    console.log('✓ STT service: Assembly.AI\n');
  }

  /**
   * Get the text graph for a specific voice.
   * Graph is created lazily on first request for this voice.
   */
  async getTextGraph(voiceId: string): Promise<InworldGraphWrapper> {
    if (!this.textGraphs.has(voiceId)) {
      console.log(`  → Creating text graph for voice: ${voiceId}...`);
      const graph = await InworldGraphWrapper.create({
        apiKey: this.apiKey,
        llmModelName: this.llmModelName,
        llmProvider: this.llmProvider,
        voiceId: voiceId,
        connections: this.connections,
        graphVisualizationEnabled: this.graphVisualizationEnabled,
        disableAutoInterruption: this.disableAutoInterruption,
        ttsModelId: this.ttsModelId,
        vadClient: this.vadClient,
      });
      this.textGraphs.set(voiceId, graph);
      console.log(`  ✓ Text graph created for voice: ${voiceId}`);
    }
    return this.textGraphs.get(voiceId)!;
  }

  /**
   * Get the audio graph for a specific voice.
   * Graph is created lazily on first request for this voice.
   */
  async getAudioGraph(voiceId: string): Promise<InworldGraphWrapper> {
    if (!this.env.assemblyAIApiKey) {
      throw new Error(
        `Assembly.AI STT requested but ASSEMBLY_AI_API_KEY is not configured. This should have been caught during session load.`,
      );
    }

    if (!this.audioGraphs.has(voiceId)) {
      console.log(`  → Creating audio graph for voice: ${voiceId}...`);
      const graph = await InworldGraphWrapper.create({
        apiKey: this.apiKey,
        llmModelName: this.llmModelName,
        llmProvider: this.llmProvider,
        voiceId: voiceId,
        connections: this.connections,
        withAudioInput: true,
        graphVisualizationEnabled: this.graphVisualizationEnabled,
        disableAutoInterruption: this.disableAutoInterruption,
        ttsModelId: this.ttsModelId,
        vadClient: this.vadClient,
        useAssemblyAI: true,
        assemblyAIApiKey: this.env.assemblyAIApiKey,
      });
      this.audioGraphs.set(voiceId, graph);
      console.log(`  ✓ Audio graph created for voice: ${voiceId}`);
    }
    return this.audioGraphs.get(voiceId)!;
  }

  async load(req: any, res: any) {
    res.setHeader('Content-Type', 'application/json');

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const agent = {
      ...req.body.agent,
      id: v4(),
    };

    const sessionId = req.query.sessionId;
    const systemMessageId = v4();
    const sttService = req.body.sttService || 'assemblyai'; // Default to Assembly.AI

    // Validate STT service availability BEFORE creating session
    if (sttService !== 'assemblyai') {
      return res.status(400).json({
        error: `Only Assembly.AI STT is supported`,
        availableServices: ['assemblyai'],
        requestedService: sttService,
      });
    }

    if (!this.env.assemblyAIApiKey) {
      return res.status(400).json({
        error: `Assembly.AI STT requested but ASSEMBLY_AI_API_KEY is not configured`,
        availableServices: ['assemblyai'],
        requestedService: sttService,
      });
    }

    // Get voice from client request (set by template selection)
    // Falls back to DEFAULT_VOICE_ID if client doesn't send one
    const sessionVoiceId = req.body.voiceId || this.voiceId;

    console.log(
      `\n[Session ${sessionId}] Creating new session with STT: ${sttService}, Voice: ${sessionVoiceId}`,
    );

    this.connections[sessionId] = {
      state: {
        interactionId: systemMessageId, // Initialize with system message ID
        messages: [
          {
            role: 'system',
            content: this.createSystemMessage(agent, req.body.userName),
            id: 'system' + systemMessageId,
          },
        ],
        agent,
        userName: req.body.userName,
        voiceId: sessionVoiceId, // Use request voiceId or default
      },
      ws: null,
      sttService, // Store STT service choice for this session
    };

    res.end(JSON.stringify({ agent }));
  }

  private createSystemMessage(agent: any, userName: string) {
    return agent.systemPrompt.replace('{userName}', userName);
  }

  unload(req: any, res: any) {
    res.setHeader('Content-Type', 'application/json');

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const sessionId = req.query.sessionId;

    // Check if connection exists before trying to set property
    if (!this.connections[sessionId]) {
      return res
        .status(404)
        .json({ error: `Session not found for sessionId: ${sessionId}` });
    }

    this.connections[sessionId].unloaded = true;

    res.end(JSON.stringify({ message: 'Session unloaded' }));
  }

  async shutdown() {
    this.connections = {};

    // Destroy all text graphs
    for (const graph of this.textGraphs.values()) {
      await graph.destroy();
    }
    this.textGraphs.clear();

    // Destroy all audio graphs
    for (const graph of this.audioGraphs.values()) {
      await graph.destroy();
    }
    this.audioGraphs.clear();

    stopInworldRuntime();
  }
}
