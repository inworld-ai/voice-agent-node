import {
  Graph,
  GraphBuilder,
  LocalTurnDetectorComponent,
  LocalVADComponent,
  RealtimeAgentAudioExtractorNode,
  RealtimeAgentInputSlicerNode,
  RealtimeAgentInteractionInfoNode,
  RealtimeAgentInteractionQueueNode,
  RealtimeAgentPromptVariablesNode,
  RealtimeAgentStateUpdaterNode,
  RealtimeAgentTtsFirstChunkCheckingNode,
  RemoteLLMChatNode,
  RemoteLLMComponent,
  RemoteSTTComponent,
  RemoteSTTNode,
  RemoteTTSNode,
  TextChunkingNode,
  TransformNode,
} from '@inworld/runtime/graph';

import type {
  GraphProvider,
  GraphProviderResult,
  GraphProviderSession,
} from '../graph_provider';

const DEFAULT_VAD_COMPONENT_ID = 'local_vad';
const DEFAULT_TURN_DETECTOR_COMPONENT_ID = 'local_turn_detector';
const DEFAULT_INWORLD_STT_COMPONENT_ID = 'inworld_stt';
const DEFAULT_GROQ_STT_COMPONENT_ID = 'groq_stt';
const DEFAULT_LLM_COMPONENT_ID = 'inworld_llm';

const DEFAULT_AGENT_PROMPT_SUB_KEY = 'AGENT_PROMPT';
const DEFAULT_VAD_MODEL_PATH_SUB_KEY = 'VAD_MODEL_PATH';
const DEFAULT_TURN_DETECTOR_MODEL_PATH_SUB_KEY = 'TURN_DETECTOR_MODEL_PATH';
const DEFAULT_GROQ_API_KEY_SUB_KEY = 'GROQ_API_KEY';

/**
 * Provides per-session realtime agent graphs assembled from SDK graph primitives.
 */
export class RealtimeAgentProvider implements GraphProvider {
  private graphsBySession = new Map<string, Graph>();

  constructor(
    private readonly apiKey: string,
    private readonly defaults: {
      voiceId: string;
      vadModelPath?: string;
      turnDetectorModelPath?: string;
      groqApiKey?: string;
    },
  ) {}

  async getGraph(session: GraphProviderSession): Promise<GraphProviderResult> {
    const existing = this.graphsBySession.get(session.sessionId);
    if (existing) {
      return { graph: existing, kind: 'realtime' };
    }

    const systemPrompt = session.state?.agent?.systemPrompt ?? '';
    const promptTemplate =
      '\n\n\n\n{% if history and history|length > 0 %}\n\n# Previous conversation:\n\n{%- for turn in history %}\n\n{{ turn[\"role\"] }}: {{ turn[\"text\"] }}\n\n{%- endfor %}\n\n{% endif %}\n\n# Current User message:\n\nUser: {{user_query}}\n\n\n\nA:\n\n';

    const substitutions = buildVoiceAgentSubstitutions({
      agentPrompt: systemPrompt + promptTemplate,
      vadModelPath: this.defaults.vadModelPath,
      turnDetectorModelPath: this.defaults.turnDetectorModelPath,
      groqApiKey: this.defaults.groqApiKey,
    });

    const sttComponentId =
      substitutions[DEFAULT_GROQ_API_KEY_SUB_KEY] !== undefined
        ? DEFAULT_GROQ_STT_COMPONENT_ID
        : DEFAULT_INWORLD_STT_COMPONENT_ID;

    const graph = buildRealtimeVoiceAgentGraph({
      graphId: `voice-agent-native-${session.sessionId}`,
      apiKey: this.apiKey,
      substitutions,
      sttComponentId,
      voiceId: this.defaults.voiceId,
      voiceLanguageCode: 'en-US',
      interruptionEventOutputTemplate:
        "{'isInterrupted': input.is_interruption, 'interactionId': input.interaction_id}",
    });

    this.graphsBySession.set(session.sessionId, graph);
    return { graph, kind: 'realtime' };
  }

  async destroySessionResources(sessionId: string): Promise<void> {
    const graph = this.graphsBySession.get(sessionId);
    if (graph) {
      await graph.stop();
      this.graphsBySession.delete(sessionId);
    }
  }
}

interface VoiceAgentSubstitutionOptions {
  agentPrompt: string;
  vadModelPath?: string;
  turnDetectorModelPath?: string;
  groqApiKey?: string;
}

function buildVoiceAgentSubstitutions(
  opts: VoiceAgentSubstitutionOptions,
): Record<string, string> {
  const substitutions: Record<string, string> = {
    [DEFAULT_AGENT_PROMPT_SUB_KEY]: opts.agentPrompt,
  };

  if (opts.vadModelPath) {
    substitutions[DEFAULT_VAD_MODEL_PATH_SUB_KEY] = opts.vadModelPath;
  }
  if (opts.turnDetectorModelPath) {
    substitutions[DEFAULT_TURN_DETECTOR_MODEL_PATH_SUB_KEY] =
      opts.turnDetectorModelPath;
  }
  if (opts.groqApiKey) {
    substitutions[DEFAULT_GROQ_API_KEY_SUB_KEY] = opts.groqApiKey;
  }

  return substitutions;
}

interface BuildVoiceAgentGraphOptions {
  graphId: string;
  apiKey: string;
  substitutions: Record<string, string>;
  sttComponentId: string;
  voiceId: string;
  voiceLanguageCode: string;
  interruptionEventOutputTemplate: string;
}

function buildRealtimeVoiceAgentGraph(
  opts: BuildVoiceAgentGraphOptions,
): Graph {
  const builder = new GraphBuilder({
    id: opts.graphId,
    apiKey: opts.apiKey,
    enableRemoteConfig: false,
    substitutions: opts.substitutions,
  });

  builder
    .addComponent(
      new LocalVADComponent({
        id: DEFAULT_VAD_COMPONENT_ID,
        modelPath: `{{${DEFAULT_VAD_MODEL_PATH_SUB_KEY}}}`,
        speechThreshold: 0.5,
      }),
    )
    .addComponent(
      new LocalTurnDetectorComponent({
        id: DEFAULT_TURN_DETECTOR_COMPONENT_ID,
        modelPath: `{{${DEFAULT_TURN_DETECTOR_MODEL_PATH_SUB_KEY}}}`,
        threshold: 0.5,
      }),
    );

  const groqSttComponent = new RemoteSTTComponent({
    id: DEFAULT_GROQ_STT_COMPONENT_ID,
    service: 'groq',
    modelId: 'whisper-large-v3',
    sttConfig: {
      languageCode: 'en-US',
    },
  });
  const inworldSttComponent = new RemoteSTTComponent({
    id: DEFAULT_INWORLD_STT_COMPONENT_ID,
    service: 'inworld',
    modelId: 'groq/whisper-large-v3',
    sttConfig: {
      languageCode: 'en-US',
    },
  });

  builder.addComponent(groqSttComponent).addComponent(inworldSttComponent);

  const llmComponent = new RemoteLLMComponent({
    id: DEFAULT_LLM_COMPONENT_ID,
    provider: 'groq',
    modelName: 'llama-3.3-70b-versatile',
    defaultConfig: {
      maxNewTokens: 160,
      maxPromptLength: 8000,
      temperature: 0.7,
      topP: 0.95,
      repetitionPenalty: 1.0,
      frequencyPenalty: 0.0,
      presencePenalty: 0.0,
      stopSequences: ['\n\n'],
    },
  });
  builder.addComponent(llmComponent);

  const inputProxyNode = {
    id: 'input_proxy_node',
    type: 'ProxyNode',
  };
  builder.addNode(inputProxyNode);

  const interruptionEventNode = new TransformNode({
    id: 'interruption_event_node',
    reportToClient: true,
    outputType: 'Json',
    outputTemplate: opts.interruptionEventOutputTemplate,
  });
  builder.addNode(interruptionEventNode);

  const slicerNode = new RealtimeAgentInputSlicerNode({
    id: 'input_slicer_node',
    vadComponentId: DEFAULT_VAD_COMPONENT_ID,
    turnDetectorComponentId: DEFAULT_TURN_DETECTOR_COMPONENT_ID,
  });
  builder.addNode(slicerNode);

  const audioExtractorNode = new RealtimeAgentAudioExtractorNode({
    id: 'audio_extractor_node',
  });
  builder.addNode(audioExtractorNode);

  const textExtractorNode = new TransformNode({
    id: 'text_extractor_node',
    outputType: 'Text',
    outputTemplate: {
      value: 'input.text_input',
    },
  });
  builder.addNode(textExtractorNode);

  const sttComponent =
    opts.sttComponentId === DEFAULT_GROQ_STT_COMPONENT_ID
      ? groqSttComponent
      : inworldSttComponent;

  const sttNode = new RemoteSTTNode({
    id: 'stt_node',
    sttComponent,
  });
  builder.addNode(sttNode);

  const interactionInfoNode = new RealtimeAgentInteractionInfoNode({
    id: 'interaction_info_node',
    reportToClient: true,
  });
  builder.addNode(interactionInfoNode);

  const interactionQueueNode = new RealtimeAgentInteractionQueueNode({
    id: 'interaction_queue_node',
  });
  builder.addNode(interactionQueueNode);

  const promptVariablesNode = new RealtimeAgentPromptVariablesNode({
    id: 'prompt_variables_node',
  });
  builder.addNode(promptVariablesNode);

  const llmNode = new RemoteLLMChatNode({
    id: 'llm_node',
    llmComponent,
    stream: true,
    textGenerationConfig: {
      maxNewTokens: 160,
      maxPromptLength: 200,
      temperature: 0.75,
      topP: 0.9,
      repetitionPenalty: 1.01,
      frequencyPenalty: 0.0,
      presencePenalty: 0.0,
      stopSequences: ['\n\n'],
    },
    messageTemplates: [
      {
        role: 'user',
        content: {
          type: 'template',
          template: `{{${DEFAULT_AGENT_PROMPT_SUB_KEY}}}`,
        },
      },
    ],
  });
  builder.addNode(llmNode);

  const stateUpdaterNode = new RealtimeAgentStateUpdaterNode({
    id: 'state_updater_node',
  });
  builder.addNode(stateUpdaterNode);

  const textChunkingNode = new TextChunkingNode({
    id: 'text_chunking_node',
  });
  builder.addNode(textChunkingNode);

  const ttsNode = new RemoteTTSNode({
    id: 'tts_node',
    speakerId: opts.voiceId,
    languageCode: opts.voiceLanguageCode,
    modelId: 'inworld-tts-1',
    temperature: 1.1,
    speakingRate: 1.0,
    sampleRate: 24000,
  });
  builder.addNode(ttsNode);

  const ttsFirstChunkNode = new RealtimeAgentTtsFirstChunkCheckingNode({
    id: 'tts_first_chunk_checking_node',
    reportToClient: true,
  });
  builder.addNode(ttsFirstChunkNode);

  builder
    .addEdge(inputProxyNode, slicerNode)
    .addEdge(slicerNode, slicerNode, {
      optional: true,
      loop: true,
      conditionExpression: 'input.is_running == true',
    })
    .addEdge(slicerNode, interruptionEventNode, {
      conditionExpression: 'input.is_interruption == true',
    })
    .addEdge(slicerNode, audioExtractorNode, {
      conditionExpression:
        'input.is_running == true && !input.is_interruption && input.is_text_input == false',
    })
    .addEdge(slicerNode, textExtractorNode, {
      conditionExpression: 'input.is_text_input == true',
    })
    .addEdge(audioExtractorNode, sttNode)
    .addEdge(slicerNode, interactionInfoNode, {
      conditionExpression:
        'input.is_running && (input.is_text_input || !input.is_interruption)',
    })
    .addEdge(textExtractorNode, interactionInfoNode, {
      optional: true,
    })
    .addEdge(sttNode, interactionInfoNode, {
      optional: true,
    })
    .addEdge(interactionInfoNode, interactionQueueNode)
    .addEdge(interactionQueueNode, promptVariablesNode, {
      conditionExpression: "has(input.value) && input.value != ''",
    })
    .addEdge(promptVariablesNode, llmNode)
    .addEdge(llmNode, textChunkingNode)
    .addEdge(textChunkingNode, ttsNode)
    .addEdge(textChunkingNode, stateUpdaterNode)
    .addEdge(ttsNode, ttsFirstChunkNode)
    .addEdge(ttsFirstChunkNode, stateUpdaterNode)
    .addEdge(stateUpdaterNode, interactionQueueNode, {
      loop: true,
      optional: true,
    });

  builder.setStartNode(inputProxyNode);
  builder.setEndNode(stateUpdaterNode);

  return builder.build();
}
