import { stopInworldRuntime } from '@inworld/runtime';
import { VADFactory } from '@inworld/runtime/primitives/vad';
import { v4 } from 'uuid';
const { validationResult } = require('express-validator');

import { DEFAULT_VOICE_ID } from '../../constants';
import { parseEnvironmentVariables } from '../helpers';
import { Connection } from '../types';
import { InworldGraphWrapper } from './graph';

export class InworldApp {
  apiKey: string;
  llmModelName: string;
  llmProvider: string;
  vadModelPath: string;
  graphVisualizationEnabled: boolean;
  disableAutoInterruption: boolean; // Flag to disable graph-based auto-interruptions (default: false, meaning auto-interruptions are enabled)
  ttsModelId: string;
  connections: {
    [sessionId: string]: Connection;
  } = {};

  vadClient: any;

  // Shared graphs for all sessions (voice selected dynamically via TTSRequestBuilderNode)
  graphWithTextInput: InworldGraphWrapper;
  private graphWithAudioInputAssemblyAI?: InworldGraphWrapper;

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
    this.vadModelPath = this.env.vadModelPath;
    this.graphVisualizationEnabled = this.env.graphVisualizationEnabled;
    this.disableAutoInterruption = this.env.disableAutoInterruption;
    this.ttsModelId = this.env.ttsModelId;

    // Initialize the VAD client for Assembly.AI
    console.log('Loading VAD model from:', this.vadModelPath);
    this.vadClient = await VADFactory.createLocal({
      modelPath: this.vadModelPath,
    });

    // Create shared text-only graph
    // Voice is selected dynamically per session via TTSRequestBuilderNode
    this.graphWithTextInput = await InworldGraphWrapper.create({
      apiKey: this.apiKey,
      llmModelName: this.llmModelName,
      llmProvider: this.llmProvider,
      voiceId: DEFAULT_VOICE_ID, // Default voice (overridden by TTSRequestBuilderNode)
      connections: this.connections,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      disableAutoInterruption: this.disableAutoInterruption,
      ttsModelId: this.ttsModelId,
      vadClient: this.vadClient,
    });

    console.log('\n✓ Text input graph initialized');
    console.log(
      '✓ Audio input graph will be created lazily when first requested\n',
    );

    console.log('✓ STT service: Assembly.AI\n');
  }

  /**
   * Get the Assembly.AI audio graph.
   * Graph is created lazily on first request.
   * Voice is selected dynamically per session via TTSRequestBuilderNode.
   */
  async getGraphForSTTService(
    _sttService?: string,
  ): Promise<InworldGraphWrapper> {
    if (!this.env.assemblyAIApiKey) {
      throw new Error(
        `Assembly.AI STT requested but ASSEMBLY_AI_API_KEY is not configured. This should have been caught during session load.`,
      );
    }

    if (!this.graphWithAudioInputAssemblyAI) {
      console.log('  → Creating Assembly.AI STT graph (first use)...');
      this.graphWithAudioInputAssemblyAI = await InworldGraphWrapper.create({
        apiKey: this.apiKey,
        llmModelName: this.llmModelName,
        llmProvider: this.llmProvider,
        voiceId: DEFAULT_VOICE_ID, // Default voice (overridden by TTSRequestBuilderNode)
        connections: this.connections,
        withAudioInput: true,
        graphVisualizationEnabled: this.graphVisualizationEnabled,
        disableAutoInterruption: this.disableAutoInterruption,
        ttsModelId: this.ttsModelId,
        vadClient: this.vadClient,
        useAssemblyAI: true,
        assemblyAIApiKey: this.env.assemblyAIApiKey,
      });
      console.log('  ✓ Assembly.AI STT graph created');
    } else {
      console.log(`  → Using Assembly.AI STT graph`);
    }
    return this.graphWithAudioInputAssemblyAI;
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
    // Falls back to DEFAULT_VOICE_ID only if client doesn't send one
    // The client should always send a voiceId from template selection
    // Store voice in session state for TTSRequestBuilderNode to use
    const sessionVoiceId = req.body.voiceId !== undefined && req.body.voiceId !== null 
      ? req.body.voiceId 
      : DEFAULT_VOICE_ID;

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
        voiceId: sessionVoiceId, // TTSRequestBuilderNode reads this for dynamic voice selection
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

  shutdown() {
    this.connections = {};
    this.graphWithTextInput.destroy();

    // Destroy audio graph if it was created
    this.graphWithAudioInputAssemblyAI?.destroy();

    stopInworldRuntime();
  }
}
