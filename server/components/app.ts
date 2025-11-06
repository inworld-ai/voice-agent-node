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

  graphWithTextInput: InworldGraphWrapper;

  // Lazily-created graphs for different STT services
  private graphWithAudioInputInworld?: InworldGraphWrapper;
  private graphWithAudioInputGroq?: InworldGraphWrapper;
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
    this.voiceId = this.env.voiceId;
    this.vadModelPath = this.env.vadModelPath;
    this.graphVisualizationEnabled = this.env.graphVisualizationEnabled;
    this.disableAutoInterruption = this.env.disableAutoInterruption;
    this.ttsModelId = this.env.ttsModelId;

    // Always initialize the VAD client
    // Needed for VAD-based pipelines (default Remote STT and Groq STT)
    // Assembly.AI doesn't use VAD, but we initialize it anyway to allow dynamic STT selection
    console.log('Loading VAD model from:', this.vadModelPath);
    this.vadClient = await VADFactory.createLocal({
      modelPath: this.vadModelPath,
    });

    // Create text-only graph
    this.graphWithTextInput = await InworldGraphWrapper.create({
      apiKey: this.apiKey,
      llmModelName: this.llmModelName,
      llmProvider: this.llmProvider,
      voiceId: this.voiceId,
      connections: this.connections,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      disableAutoInterruption: this.disableAutoInterruption,
      ttsModelId: this.ttsModelId,
      vadClient: this.vadClient,
    });

    console.log('\n✓ Text input graph initialized');
    console.log(
      '✓ Audio input graphs will be created lazily when first requested\n',
    );

    // Log available STT services
    console.log('Available STT services:');
    console.log('  - Inworld Remote STT (always available)');
    if (this.env.groqApiKey) {
      console.log('  - Groq Whisper (API key configured)');
    }
    if (this.env.assemblyAIApiKey) {
      console.log('  - Assembly.AI (API key configured)');
    }

    // Determine default STT service
    let defaultSTT = 'Inworld Remote STT';
    if (this.env.useAssemblyAI && this.env.assemblyAIApiKey) {
      defaultSTT = 'Assembly.AI';
    } else if (this.env.useGroq && this.env.groqApiKey) {
      defaultSTT = 'Groq Whisper';
    }
    console.log(`\n✓ Default STT: ${defaultSTT}\n`);
  }

  /**
   * Get the appropriate audio graph based on the requested STT service.
   * Graphs are created lazily on first request.
   */
  async getGraphForSTTService(
    sttService?: string,
  ): Promise<InworldGraphWrapper> {
    const baseAudioConfig = {
      apiKey: this.apiKey,
      llmModelName: this.llmModelName,
      llmProvider: this.llmProvider,
      voiceId: this.voiceId,
      connections: this.connections,
      withAudioInput: true,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      disableAutoInterruption: this.disableAutoInterruption,
      ttsModelId: this.ttsModelId,
      vadClient: this.vadClient,
    };

    switch (sttService) {
      case 'groq':
        if (!this.env.groqApiKey) {
          // This should not happen since we validate at load time, but defensive check
          throw new Error(
            `Groq STT requested but GROQ_API_KEY is not configured. This should have been caught during session load.`,
          );
        }

        if (!this.graphWithAudioInputGroq) {
          console.log('  → Creating Groq Whisper STT graph (first use)...');
          this.graphWithAudioInputGroq = await InworldGraphWrapper.create({
            ...baseAudioConfig,
            useGroq: true,
            groqApiKey: this.env.groqApiKey,
            groqModel: this.env.groqModel,
          });
          console.log('  ✓ Groq Whisper STT graph created');
        } else {
          console.log(`  → Using Groq Whisper STT graph`);
        }
        return this.graphWithAudioInputGroq;

      case 'assemblyai':
        if (!this.env.assemblyAIApiKey) {
          // This should not happen since we validate at load time, but defensive check
          throw new Error(
            `Assembly.AI STT requested but ASSEMBLY_AI_API_KEY is not configured. This should have been caught during session load.`,
          );
        }

        if (!this.graphWithAudioInputAssemblyAI) {
          console.log('  → Creating Assembly.AI STT graph (first use)...');
          this.graphWithAudioInputAssemblyAI = await InworldGraphWrapper.create(
            {
              ...baseAudioConfig,
              useAssemblyAI: true,
              assemblyAIApiKey: this.env.assemblyAIApiKey,
            },
          );
          console.log('  ✓ Assembly.AI STT graph created');
        } else {
          console.log(`  → Using Assembly.AI STT graph`);
        }
        return this.graphWithAudioInputAssemblyAI;

      case 'inworld':
      default:
        if (!this.graphWithAudioInputInworld) {
          console.log('  → Creating Inworld Remote STT graph (first use)...');
          this.graphWithAudioInputInworld = await InworldGraphWrapper.create({
            ...baseAudioConfig,
          });
          console.log('  ✓ Inworld Remote STT graph created');
        } else {
          console.log(`  → Using Inworld Remote STT graph`);
        }
        return this.graphWithAudioInputInworld;
    }
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
    const sttService = req.body.sttService || 'inworld'; // Get STT service from request

    // Validate STT service availability BEFORE creating session
    if (sttService === 'groq' && !this.env.groqApiKey) {
      const availableServices = ['inworld'];
      if (this.env.assemblyAIApiKey) availableServices.push('assemblyai');

      return res.status(400).json({
        error: `Groq STT requested but GROQ_API_KEY is not configured`,
        availableServices,
        requestedService: sttService,
      });
    }

    if (sttService === 'assemblyai' && !this.env.assemblyAIApiKey) {
      const availableServices = ['inworld'];
      if (this.env.groqApiKey) availableServices.push('groq');

      return res.status(400).json({
        error: `Assembly.AI STT requested but ASSEMBLY_AI_API_KEY is not configured`,
        availableServices,
        requestedService: sttService,
      });
    }

    console.log(
      `\n[Session ${sessionId}] Creating new session with STT: ${sttService}`,
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
        voiceId: req.body.voiceId || this.voiceId, // Use request voiceId or default
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

    // Destroy all pre-created audio graphs
    this.graphWithAudioInputInworld?.destroy();
    this.graphWithAudioInputGroq?.destroy();
    this.graphWithAudioInputAssemblyAI?.destroy();

    stopInworldRuntime();
  }
}
