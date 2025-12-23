import { stopInworldRuntime } from '@inworld/runtime';
import { VAD } from '@inworld/runtime/primitives/vad';
import { v4 } from 'uuid';
const { validationResult } = require('express-validator');

import { SPEECH_THRESHOLD } from '../../../../constants';
import { parseEnvironmentVariables } from '../helpers';
import { Connection } from '../types';
import { InworldGraphWrapper } from './graph';
import { NativeGraphWrapper } from './native_graph_wrapper';

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

  // Assembly.AI multimodal graph that handles both audio and text input
  private assemblyAIGraph?: InworldGraphWrapper;

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

    // Always initialize the VAD client for audio processing capability
    console.log('Loading VAD model from:', this.vadModelPath);
    this.vadClient = await VAD.create({
      localConfig: {
        modelPath: this.vadModelPath,
        device: { type: 'DEVICE_TYPE_CPU', index: 0 },
        defaultConfig: { speechThreshold: SPEECH_THRESHOLD },
      },
    });

    // Create Assembly.AI multimodal graph that handles both audio and text input
    console.log('Creating Assembly.AI multimodal graph...');
    this.assemblyAIGraph = await InworldGraphWrapper.create({
      apiKey: this.apiKey,
      llmModelName: this.llmModelName,
      llmProvider: this.llmProvider,
      voiceId: this.voiceId,
      connections: this.connections,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      disableAutoInterruption: this.disableAutoInterruption,
      ttsModelId: this.ttsModelId,
      vadClient: this.vadClient,
      assemblyAIApiKey: this.env.assemblyAIApiKey,
    });

    console.log(
      '✓ Assembly.AI multimodal graph initialized (supports both audio and text)\n',
    );

    // Log available STT services
    console.log('Available STT services:');
    console.log('  - Assembly.AI (default)');
    if (this.env.useNativeGraph) {
      console.log('  - Native C++ (enabled)');
    }

    // Determine default STT service
    let defaultSTT = 'Assembly.AI';
    if (this.env.useNativeGraph) {
      defaultSTT = 'Native C++';
    }
    console.log(`\n✓ Default STT: ${defaultSTT}\n`);
  }

  /**
   * Get the appropriate graph based on the requested STT service.
   * Returns Assembly.AI multimodal graph for assemblyai service, or per-session native graph.
   *
   * @param sttService - The STT service to use (assemblyai, native)
   * @param sessionId - Optional sessionId to get system prompt from UI config (used for native graph)
   * @returns InworldGraphWrapper for DSL graphs, or NativeGraphWrapper for native graphs
   */
  async getGraphForSTTService(
    sttService?: string,
    sessionId?: string,
  ): Promise<InworldGraphWrapper | NativeGraphWrapper> {
    // Get system prompt from session state if available (for UI-configured prompts)
    // Falls back to env variable for backward compatibility
    let systemPrompt = this.env?.systemPrompt;
    console.log('this.env.systemPrompt', this.env?.systemPrompt);
    if (sessionId && this.connections[sessionId]?.state?.agent?.systemPrompt) {
      systemPrompt = this.connections[sessionId].state.agent.systemPrompt;
      console.log(
        'this.connections[sessionId].state',
        this.connections[sessionId].state,
      );
    }

    const baseGraphConfig = {
      apiKey: this.apiKey,
      llmModelName: this.llmModelName,
      llmProvider: this.llmProvider,
      voiceId: this.voiceId,
      connections: this.connections,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      disableAutoInterruption: this.disableAutoInterruption,
      ttsModelId: this.ttsModelId,
      vadClient: this.vadClient,
      vadModelPath: this.vadModelPath,
      turnDetectorModelPath: this.env.turnDetectorModelPath,
      groqApiKey: this.env.groqApiKey, // For native graph Groq STT support
      systemPrompt: systemPrompt,
    };

    switch (sttService) {
      case 'native':
        // Native C++ graph is created per-session to support different system prompts
        if (!sessionId) {
          throw new Error('sessionId is required for native graph creation');
        }

        const connection = this.connections[sessionId];
        if (!connection) {
          throw new Error(`No connection found for sessionId: ${sessionId}`);
        }

        // Check if this session already has a native graph
        if (connection.nativeGraph) {
          console.log(
            `  → Using existing Native C++ graph for session ${sessionId}`,
          );
          return connection.nativeGraph;
        }

        // Create a new native graph for this session with its specific system prompt
        console.log(
          `  → Creating Native C++ graph for session ${sessionId}...`,
        );
        console.log(
          `  → Using system prompt from ${systemPrompt !== this.env?.systemPrompt ? 'UI configuration' : 'environment variable'}`,
        );

        connection.nativeGraph =
          await NativeGraphWrapper.createWithGraphBuilder(baseGraphConfig);

        console.log(`  ✓ Native C++ graph created for session ${sessionId}`);
        return connection.nativeGraph;

      case 'assemblyai':
      default:
        // Use Assembly.AI multimodal graph (default)
        console.log('  → Using Assembly.AI multimodal graph');
        return this.assemblyAIGraph!;
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
    const sttService = req.body.sttService || 'assemblyai'; // Get STT service from request (default: assemblyai)

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
    return agent?.systemPrompt?.replace('{userName}', userName);
  }

  async unload(req: any, res: any) {
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

    const connection = this.connections[sessionId];

    // Clean up per-session native graph if it exists
    if (connection.nativeGraph) {
      console.log(`[Session ${sessionId}] Destroying per-session native graph`);
      await connection.nativeGraph.destroy();
      connection.nativeGraph = undefined;
    }

    connection.unloaded = true;

    res.end(JSON.stringify({ message: 'Session unloaded' }));
  }

  async shutdown() {
    // Clean up per-session native graphs before clearing connections
    for (const [sessionId, connection] of Object.entries(this.connections)) {
      if (connection.nativeGraph) {
        console.log(
          `[Session ${sessionId}] Destroying per-session native graph during shutdown`,
        );
        await connection.nativeGraph.destroy();
      }
    }

    this.connections = {};

    // Destroy Assembly.AI graph
    this.assemblyAIGraph?.destroy();

    stopInworldRuntime();
  }
}
