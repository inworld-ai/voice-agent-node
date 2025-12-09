import { stopInworldRuntime } from '@inworld/runtime';
import { VADFactory } from '@inworld/runtime/primitives/vad';
import { v4 } from 'uuid';
const { validationResult } = require('express-validator');

import { parseEnvironmentVariables } from '../helpers';
import { Connection } from '../types';
import { InworldGraphWrapper } from './graphs/graph';

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

  // Environment configuration
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

    console.log('\n✓ VAD client initialized');
    console.log('✓ Graphs will be created per session when "Create Agent" is pressed\n');
    console.log('✓ STT service: Assembly.AI\n');
  }

  /**
   * Get the Assembly.AI audio graph for a specific session.
   * Graph is created per session when the session is loaded.
   */
  async getGraphForSTTService(
    sessionId: string,
    _sttService?: string,
  ): Promise<InworldGraphWrapper> {
    const connection = this.connections[sessionId];
    if (!connection) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!connection.graphWithAudioInput) {
      if (!this.env.assemblyAIApiKey) {
        throw new Error(
          `Assembly.AI STT requested but ASSEMBLY_AI_API_KEY is not configured. This should have been caught during session load.`,
        );
      }

      // Get knowledge records from session
      const knowledgeRecords = connection.state.agent.knowledge || [];

      console.log(`  → Creating Assembly.AI STT graph for session ${sessionId}...`);
      connection.graphWithAudioInput = await InworldGraphWrapper.create({
        apiKey: this.apiKey,
        llmModelName: this.llmModelName,
        llmProvider: this.llmProvider,
        voiceId: connection.state.voiceId || this.voiceId,
        connections: this.connections,
        withAudioInput: true,
        graphVisualizationEnabled: this.graphVisualizationEnabled,
        disableAutoInterruption: this.disableAutoInterruption,
        ttsModelId: this.ttsModelId,
        vadClient: this.vadClient,
        useAssemblyAI: true,
        assemblyAIApiKey: this.env.assemblyAIApiKey,
        knowledgeRecords,
        sessionId, // Pass sessionId to make node IDs unique
      });
      console.log(`  ✓ Assembly.AI STT graph created for session ${sessionId}`);
    }
    return connection.graphWithAudioInput;
  }

  async load(req: any, res: any) {
    res.setHeader('Content-Type', 'application/json');

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Parse knowledge if it's a JSON string (sent from client)
    let knowledge: string[] | undefined;
    if (req.body.agent?.knowledge) {
      if (typeof req.body.agent.knowledge === 'string') {
        try {
          knowledge = JSON.parse(req.body.agent.knowledge);
          if (!Array.isArray(knowledge)) {
            knowledge = undefined;
          }
        } catch {
          // If parsing fails, treat as empty
          knowledge = undefined;
        }
      } else if (Array.isArray(req.body.agent.knowledge)) {
        knowledge = req.body.agent.knowledge;
      }
    }

    const agent = {
      ...req.body.agent,
      id: v4(),
      knowledge, // Store parsed knowledge array
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
    // Store voice in session state for TTSRequestBuilderNode to use
    const sessionVoiceId = req.body.voiceId || this.voiceId;

    console.log(
      `\n[Session ${sessionId}] Creating new session with STT: ${sttService}, Voice: ${sessionVoiceId}`,
    );

    // Clean up existing graphs if session already exists (e.g., user went back to settings)
    const existingConnection = this.connections[sessionId];
    if (existingConnection) {
      console.log(`[Session ${sessionId}] Cleaning up existing graphs...`);
      if (existingConnection.graphWithTextInput) {
        await existingConnection.graphWithTextInput.destroy();
      }
      if (existingConnection.graphWithAudioInput) {
        await existingConnection.graphWithAudioInput.destroy();
      }
    }

    // Create or update connection
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
      ws: existingConnection?.ws || null, // Preserve WebSocket if it exists
      sttService, // Store STT service choice for this session
    };

    // Create graphs for this session with knowledge records
    const knowledgeRecords = knowledge || [];
    console.log(
      `[Session ${sessionId}] Creating graphs with ${knowledgeRecords.length} knowledge record(s)`,
    );

    // Create text input graph for this session
    const graphWithTextInput = await InworldGraphWrapper.create({
      apiKey: this.apiKey,
      llmModelName: this.llmModelName,
      llmProvider: this.llmProvider,
      voiceId: sessionVoiceId,
      connections: this.connections,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      disableAutoInterruption: this.disableAutoInterruption,
      ttsModelId: this.ttsModelId,
      vadClient: this.vadClient,
      knowledgeRecords,
      sessionId, // Pass sessionId to make node IDs unique
    });

    this.connections[sessionId].graphWithTextInput = graphWithTextInput;
    console.log(`[Session ${sessionId}] ✓ Text input graph created`);

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

    const connection = this.connections[sessionId];
    connection.unloaded = true;

    // Destroy session graphs
    if (connection.graphWithTextInput) {
      connection.graphWithTextInput.destroy();
    }
    if (connection.graphWithAudioInput) {
      connection.graphWithAudioInput.destroy();
    }

    // Remove connection
    delete this.connections[sessionId];

    res.end(JSON.stringify({ message: 'Session unloaded' }));
  }

  shutdown() {
    // Destroy all session graphs
    for (const [sessionId, connection] of Object.entries(this.connections)) {
      if (connection.graphWithTextInput) {
        connection.graphWithTextInput.destroy();
      }
      if (connection.graphWithAudioInput) {
        connection.graphWithAudioInput.destroy();
      }
    }
    this.connections = {};
    stopInworldRuntime();
  }
}
