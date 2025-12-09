import {
  Graph,
  GraphBuilder,
  KeywordMatcherNode,
  KnowledgeNode,
  ProxyNode,
  RandomCannedTextNode,
  RemoteEmbedderComponent,
  RemoteLLMChatNode,
  RemoteLLMComponent,
  RemoteTTSNode,
  SubgraphBuilder,
  SubgraphNode,
  TextAggregatorNode,
  TextChunkingNode,
  TextClassifierNode,
} from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v7 } from 'uuid';

import {
  INPUT_SAMPLE_RATE,
  TEXT_CONFIG,
  TTS_SAMPLE_RATE,
} from '../../../constants';
import { CreateGraphPropsInterface, TextInput } from '../../types';
import { AssemblyAISTTWebSocketNode } from '../nodes/stt/assembly_ai_stt_ws_node';
import { DialogPromptBuilderNode } from '../nodes/dialog_prompt_builder_node';
import { MemoryUpdateNode } from '../nodes/memory/memory_update_node';
import { InteractionQueueNode } from '../nodes/interaction_queue_node';
import { MemoryRetrievalNode } from '../nodes/memory/memory_retrieval_node';
import { SpeechCompleteNotifierNode } from '../nodes/stt/speech_complete_notifier_node';
import { SafetyAggregatorCustomNode } from '../nodes/safety/safety_aggregator_node';
import { SafetyTextExtractorNode } from '../nodes/safety/safety_text_extractor_node';
import { StateUpdateNode } from '../nodes/state_update_node';
import { SaveMemoryNode } from '../nodes/memory/save_memory_node';
import { TextInputNode } from '../nodes/text_input_node';
import { TextInputTextExtractorNode } from '../nodes/text_input_text_extractor_node';
import { TextInputSafetyMergerNode } from '../nodes/safety/text_input_safety_merger_node';
import { TextInputStateUpdaterNode } from '../nodes/text_input_state_updater_node';
import { TranscriptExtractorNode } from '../nodes/stt/transcript_extractor_node';
import { TTSRequestBuilderNode } from '../nodes/tts_request_builder_node';
import { createFlashSubgraph } from './flash_subgraph';
import { createLongTermSubgraph } from './long_term_subgraph';
import { ResultMergeNode } from '../nodes/memory/result_merge_node';
import { getDefaultMemoryStore } from '../memory_store';
import { MemorySnapshot } from '../nodes/memory/memory_types';

//
// A complete audio-to-speech pipeline with stream slicer, LLM, safety checks, and memory:
//
// clang-format off
//
//  Graph Structure (based on actual edges in code):
//
//  ┌─────────────────────────────────────────────────────────────────────────────┐
//  │                   AUDIO INPUT PATH (withAudioInput=true)                    │
//  └─────────────────────────────────────────────────────────────────────────────┘
//
//  audioInputNode
//      │
//      └──> assemblyAISTTNode
//              │
//              ├──<──┐ [stream_exhausted !== true] (loop, optional)
//              │     │
//              ├──> [interaction_complete === true] speechCompleteNotifierNode (terminal)
//              │
//              └──> [interaction_complete === true] transcriptExtractorNode
//                      │
//                      └──> interactionQueueNode
//                              │
//                              └──> [text exists] textInputNode
//                                      │
//                                      └──> (joins TEXT INPUT PATH below)
//
//  ┌─────────────────────────────────────────────────────────────────────────────┐
//  │              TEXT INPUT PATH (common for both audio and text)               │
//  └─────────────────────────────────────────────────────────────────────────────┘
//
//  textInputNode
//      │
//      ├──> textInputTextExtractorNode
//      │       │
//      │       ├──> inputSafetySubgraph.subgraphNode
//      │       │       │
//      │       │       └──> textInputSafetyMergerNode
//      │       │
//      │       ├──> memoryRetrievalNode
//      │       │       │
//      │       │       └──> dialogPromptBuilderNode
//      │       │
//      │       └──> knowledgeNode (if knowledge enabled)
//      │               │
//      │               └──> dialogPromptBuilderNode
//      │
//      ├──> textInputStateUpdaterNode
//      │       │
//      │       └──> textInputSafetyMergerNode
//      │               │
//      │               ├──> [isSafe === true] dialogPromptBuilderNode
//      │               │
//      │               └──> [isSafe === false] inputSafetyFailureCannedResponseNode
//      │                       │
//      │                       └──> responseAggregatorProxyNode
//
//  dialogPromptBuilderNode
//      │
//      └──> llmNode
//              │
//              └──> textAggregatorNode
//                      │
//                      └──> outputSafetySubgraph.subgraphNode
//                              │
//                              ├──> [isSafe === true] safetyTextExtractorNode
//                              │       │
//                              │       └──> responseAggregatorProxyNode
//                              │
//                              └──> [isSafe === false] outputSafetyFailureCannedResponseNode
//                                      │
//                                      └──> responseAggregatorProxyNode
//
//  ┌─────────────────────────────────────────────────────────────────────────────┐
//  │                        COMMON OUTPUT PATH                                   │
//  └─────────────────────────────────────────────────────────────────────────────┘
//
//  responseAggregatorProxyNode
//      │
//      ├──> textChunkingNode
//      │       │
//      │       └──> ttsNode (END NODE)
//      │
//      └──> stateUpdateNode
//              │
//              └──> memoryUpdateNode
//                      │
//                      ├──> flashSubgraphNode [runFlash === true] (every 2 turns, optional)
//                      │       │
//                      │       └──> resultMergeNode
//                      │
//                      ├──> longTermSubgraphNode [runLongTerm === true] (every 10 turns, optional)
//                      │       │
//                      │       └──> resultMergeNode
//                      │
//                      └──> resultMergeNode
//                              │
//                              └──> saveMemoryNode (optional)
//
//  ┌─────────────────────────────────────────────────────────────────────────────┐
//  │                        AUDIO LOOP PATH (withAudioInput=true)                │
//  └─────────────────────────────────────────────────────────────────────────────┘
//
//  stateUpdateNode
//      │
//      └──<──┐ [loop, optional]
//            │
//            └──> interactionQueueNode
//
//  Legend:
//  ───> Required edge
//  <──┐
//     │ Loop edge (optional)
//     └
//  [condition] Conditional edge (optional)
// clang-format on
//

/**
 * Creates a safety subgraph that checks text for unsafe content using
 * text classification and keyword matching.
 * The subgraph takes Text as input and returns SafetyResult.
 */
function createSafetySubgraph(
  subgraphId: string,
  apiKey: string,
  postfix: string,
): {
  subgraph: SubgraphBuilder;
  subgraphNode: SubgraphNode;
  textEmbedderComponent: RemoteEmbedderComponent;
} {
  // Default location: server/config/safety_classifier_model_weights.json
  // Users can override via SAFETY_CLASSIFIER_MODEL_PATH environment variable
  // Use __dirname to get path relative to this file location (more reliable than process.cwd())
  const DEFAULT_TEXT_CLASSIFIER_WEIGHTS_MODEL_PATH = path.resolve(
    __dirname,
    '../..',
    'config',
    'safety_classifier_model_weights.json',
  );
  const classifierModelPath =
    process.env.SAFETY_CLASSIFIER_MODEL_PATH ||
    DEFAULT_TEXT_CLASSIFIER_WEIGHTS_MODEL_PATH;
  // Load keywords from a single combined profanity.json file
  // Default location: server/config/profanity.json
  // Users can override via SAFETY_KEYWORDS_PATH environment variable
  const DEFAULT_KEYWORD_MATCHER_CONFIG_PATH = path.resolve(
    __dirname,
    '../..',
    'config',
    'profanity.json',
  );
  const keywordConfigPath =
    process.env.SAFETY_KEYWORDS_PATH || DEFAULT_KEYWORD_MATCHER_CONFIG_PATH;

  let keywordGroups: Array<{ name: string; keywords: string[] }> = [];

  try {
    const keywords = JSON.parse(fs.readFileSync(keywordConfigPath, 'utf8'));
    if (Array.isArray(keywords)) {
      // Use a single group name for all keywords
      keywordGroups.push({ name: 'safety_keywords', keywords });
    }
  } catch (error: any) {
    console.warn(
      `Could not load keywords from ${keywordConfigPath}: ${error.message}. ` +
        `Safety filtering will be disabled. Please create ${keywordConfigPath} or set SAFETY_KEYWORDS_PATH environment variable.`,
    );
  }

  const textEmbedderComponent = new RemoteEmbedderComponent({
    id: `bge_embedder_component${postfix}`,
    provider: 'inworld',
  });

  const inputNode = new ProxyNode({ id: `input_node${postfix}` });

  const textClassifierNode = new TextClassifierNode({
    id: `text_classifier_node${postfix}`,
    embedderComponentId: `bge_embedder_component${postfix}`,
    modelWeightsPath: classifierModelPath,
    supportedClasses: [
      'hategroup',
      'selfharm',
      'sexual',
      'sexualminors',
      'substance',
    ],
    classifierConfig: {
      classes: [
        { label: 'hategroup', threshold: 0.8 },
        { label: 'selfharm', threshold: 0.9 },
        { label: 'sexual', threshold: 0.8 },
        { label: 'sexualminors', threshold: 0.9 },
        { label: 'substance', threshold: 0.7 },
      ],
    },
    reportToClient: false,
  });

  const keywordMatcherNode = new KeywordMatcherNode({
    id: `keyword_matcher_node${postfix}`,
    keywords: keywordGroups as any,
    reportToClient: false,
  });

  const safetyAggregatorNode = new SafetyAggregatorCustomNode();

  const safetySubgraph = new SubgraphBuilder(subgraphId)
    .addNode(inputNode)
    .addNode(textClassifierNode)
    .addNode(keywordMatcherNode)
    .addNode(safetyAggregatorNode)
    .addEdge(inputNode, textClassifierNode)
    .addEdge(inputNode, keywordMatcherNode)
    .addEdge(inputNode, safetyAggregatorNode)
    .addEdge(textClassifierNode, safetyAggregatorNode)
    .addEdge(keywordMatcherNode, safetyAggregatorNode)
    .setStartNode(inputNode)
    .setEndNode(safetyAggregatorNode);

  const safetySubgraphNode = new SubgraphNode({
    subgraphId: subgraphId,
  });

  return {
    subgraph: safetySubgraph,
    subgraphNode: safetySubgraphNode,
    textEmbedderComponent,
  };
}

export class InworldGraphWrapper {
  graph: Graph;

  private constructor({ graph }: { graph: Graph }) {
    this.graph = graph;
  }

  async destroy() {
    await this.graph.stop();
  }

  static async create(props: CreateGraphPropsInterface) {
    const {
      apiKey,
      llmModelName,
      llmProvider,
      voiceId,
      connections,
      withAudioInput = false,
      ttsModelId,
      knowledgeRecords = [],
      sessionId,
    } = props;

    // Create unique postfix based on audio input, STT provider, and session ID
    // Voice is now handled dynamically by TTSRequestBuilderNode
    // Session ID ensures node IDs are unique per session to avoid CallbackRegistry conflicts
    let postfix = withAudioInput ? '-with-audio-input' : '-with-text-input';
    if (withAudioInput) {
      postfix += '-assembly-ai';
    }
    // Add session ID to make node IDs unique per session
    if (sessionId) {
      // Use a short hash of sessionId to keep node IDs readable
      const sessionHash = sessionId.substring(0, 8);
      postfix += `-${sessionHash}`;
    }

    const dialogPromptBuilderNode = new DialogPromptBuilderNode({
      id: `dialog-prompt-builder-node${postfix}`,
    });

    const llmNode = new RemoteLLMChatNode({
      id: `llm-node${postfix}`,
      provider: llmProvider,
      modelName: llmModelName,
      stream: true,
      textGenerationConfig: TEXT_CONFIG,
    });

    const textChunkingNode = new TextChunkingNode({
      id: `text-chunking-node${postfix}`,
    });

    const textAggregatorNode = new TextAggregatorNode({
      id: `text-aggregator-node${postfix}`,
    });

    const stateUpdateNode = new StateUpdateNode({
      id: `state-update-node${postfix}`,
      connections,
      reportToClient: true,
    });

    const ttsRequestBuilderNode = new TTSRequestBuilderNode({
      id: `tts-request-builder-node${postfix}`,
      connections,
    });

    const ttsNode = new RemoteTTSNode({
      id: `tts-node${postfix}`,
      speakerId: voiceId, // Default voice, overridden by TTSRequest
      modelId: ttsModelId,
      sampleRate: TTS_SAMPLE_RATE,
      temperature: 0.8,
      speakingRate: 1,
    });

    const inputSafetyCannedPhrases = [
      "I'm sorry, but I can't respond to that kind of content.",
      "That topic makes me uncomfortable. Let's talk about something else.",
      "I'd prefer not to discuss that. Could we change the subject?",
      "I'm not able to help with that. Is there something else I can assist you with?",
      "Let's keep our conversation appropriate. What else can I help you with?",
    ];

    const outputSafetyCannedPhrases = [
      "I lost my train of thought. Let me try again.",
      "Sorry, I got sidetracked. What were we talking about?",
      "I'm having trouble formulating a response. Could you rephrase that?",
      "Let me start over. What can I help you with?",
      "I apologize, but I'm having difficulty with that. Can we try a different approach?",
    ];

    const outputSafetyFailureCannedResponseNode = new RandomCannedTextNode({
      id: `output-safety-failure-canned-response-node${postfix}`,
      cannedPhrases: outputSafetyCannedPhrases,
    });

    const inputSafetySubgraph = createSafetySubgraph(
      `input_safety_subgraph${postfix}`,
      apiKey,
      postfix,
    );
    const outputSafetySubgraph = createSafetySubgraph(
      `output_safety_subgraph${postfix}`,
      apiKey,
      postfix,
    );

    // Initialize memory store
    const memoryStore = getDefaultMemoryStore();

    // Load memory templates
    const FLASH_TEMPLATE_PATH = path.resolve(
      __dirname,
      '../../',
      'templates',
      'flash_memory_prompt.jinja',
    );
    const LONG_TERM_TEMPLATE_PATH = path.resolve(
      __dirname,
      '../../',
      'templates',
      'long_term_prompt.jinja',
    );

    const flashTemplate = fs.readFileSync(FLASH_TEMPLATE_PATH, 'utf-8');
    const longTermTemplate = fs.readFileSync(LONG_TERM_TEMPLATE_PATH, 'utf-8');

    // Memory configuration
    const memoryEmbedderComponentId = `memory_embedder_component${postfix}`;
    const memoryLLMComponentId = `memory_llm_component${postfix}`;
    const memoryLLMProvider =
      process.env.MEMORY_LLM_PROVIDER || llmProvider;
    const memoryLLMModel =
      process.env.MEMORY_LLM_MODEL || llmModelName;

    // Create memory embedder component
    const memoryEmbedderComponent = new RemoteEmbedderComponent({
      id: memoryEmbedderComponentId,
      provider: 'inworld',
      modelName: 'BAAI/bge-large-en-v1.5',
    });

    // Create memory LLM component
    const memoryLLMComponent = new RemoteLLMComponent({
      id: memoryLLMComponentId,
      provider: memoryLLMProvider,
      modelName: memoryLLMModel,
      defaultConfig: { maxNewTokens: 800, temperature: 0.7 },
    });

    // Create memory subgraphs
    const flashSubgraph = createFlashSubgraph(
      `flash_memory_subgraph${postfix}`,
      {
        promptTemplate: flashTemplate,
        maxHistoryToProcess:
          parseInt(process.env.FLASH_MEMORY_INTERVAL || '2', 10),
        embedderComponentId: memoryEmbedderComponentId,
        llmProvider: memoryLLMProvider,
        llmModelName: memoryLLMModel,
      },
    );

    const longTermSubgraph = createLongTermSubgraph(
      `long_term_memory_subgraph${postfix}`,
      {
        promptTemplate: longTermTemplate,
        maxHistoryToProcess:
          parseInt(process.env.LONG_TERM_MEMORY_INTERVAL || '10', 10),
        embedderComponentId: memoryEmbedderComponentId,
        llmComponentId: memoryLLMComponentId,
        llmProvider: memoryLLMProvider,
        llmModelName: memoryLLMModel,
      },
    );

    const flashSubgraphNode = new SubgraphNode({
      subgraphId: `flash_memory_subgraph${postfix}`,
    });

    const longTermSubgraphNode = new SubgraphNode({
      subgraphId: `long_term_memory_subgraph${postfix}`,
    });

    // Create memory retrieval node
    const memoryRetrievalNode = new MemoryRetrievalNode({
      embedderComponentId: memoryEmbedderComponentId,
      similarityThreshold: parseFloat(
        process.env.MEMORY_SIMILARITY_THRESHOLD || '0.3',
      ),
      maxContextItems: parseInt(
        process.env.MAX_RETURNED_MEMORIES || '3',
        10,
      ),
      connections,
    });

    // Create memory update node
    const memoryUpdateNode = new MemoryUpdateNode({
      flashInterval: parseInt(process.env.FLASH_MEMORY_INTERVAL || '2', 10),
      longTermInterval: parseInt(
        process.env.LONG_TERM_MEMORY_INTERVAL || '10',
        10,
      ),
      connections,
    });

    // Create result merge node
    const resultMergeNode = new ResultMergeNode({
      similarityThreshold: parseFloat(
        process.env.RESULT_MERGE_SIMILARITY_THRESHOLD || '0.9',
      ),
      maxFlashMemories: parseInt(
        process.env.RESULT_MERGE_MAX_FLASH_MEMORIES || '200',
        10,
      ),
      maxLongTermMemories: parseInt(
        process.env.RESULT_MERGE_MAX_LONG_TERM_MEMORIES || '200',
        10,
      ),
    });

    // Create save memory node (separate from stateUpdateNode to break the cycle)
    const saveMemoryNode = new SaveMemoryNode({
      id: `save-memory-node${postfix}`,
      connections,
    });

    const graphName = `voice-agent${postfix}`;
    const graphBuilder = new GraphBuilder({
      id: graphName,
      apiKey,
      enableRemoteConfig: false,
    });

    graphBuilder
      .addComponent(inputSafetySubgraph.textEmbedderComponent)
      .addComponent(outputSafetySubgraph.textEmbedderComponent)
      .addComponent(memoryEmbedderComponent)
      .addComponent(memoryLLMComponent)
      .addSubgraph(inputSafetySubgraph.subgraph)
      .addSubgraph(outputSafetySubgraph.subgraph)
      .addSubgraph(flashSubgraph)
      .addSubgraph(longTermSubgraph);

    const textInputNode = new TextInputNode({
      id: `text-input-node${postfix}`,
    });

    const textInputTextExtractorNode = new TextInputTextExtractorNode({
      id: `text-input-text-extractor-node${postfix}`,
    });

    const textInputStateUpdaterNode = new TextInputStateUpdaterNode({
      id: `text-input-state-updater-node${postfix}`,
      connections,
      reportToClient: true,
    });

    const textInputSafetyMergerNode = new TextInputSafetyMergerNode({
      id: `text-input-safety-merger-node${postfix}`,
    });

    // Knowledge records are passed from the client configuration per session
    // Create knowledge node with the provided knowledge records
    const knowledgeNode = new KnowledgeNode({
      id: `knowledge-node${postfix}`,
      knowledgeId: `knowledge/${v7()}`,
      knowledgeRecords: knowledgeRecords,
      maxCharsPerChunk: 1000,
      maxChunksPerDocument: 10,
      retrievalConfig: {
        threshold: 0.8, // Lower threshold to retrieve more results
        topK: 5, // Return up to 5 most relevant records
      },
    });


    const inputSafetyFailureCannedResponseNode = new RandomCannedTextNode({
      id: `input-safety-failure-canned-response-node${postfix}`,
      cannedPhrases: inputSafetyCannedPhrases,
    });

    const safetyTextExtractorNode = new SafetyTextExtractorNode({
      id: `safety-text-extractor-node${postfix}`,
    });

    const responseAggregatorProxyNode = new ProxyNode({
      id: `response-aggregator-proxy-node${postfix}`,
    });

    graphBuilder
      .addNode(textInputNode)
      .addNode(textInputTextExtractorNode)
      .addNode(textInputStateUpdaterNode)
      .addNode(textInputSafetyMergerNode)
      .addNode(inputSafetySubgraph.subgraphNode)
      .addNode(inputSafetyFailureCannedResponseNode)
      .addNode(memoryRetrievalNode)
      .addNode(dialogPromptBuilderNode)
      .addNode(llmNode)
      .addNode(outputSafetySubgraph.subgraphNode)
      .addNode(safetyTextExtractorNode)
      .addNode(outputSafetyFailureCannedResponseNode)
      .addNode(responseAggregatorProxyNode)
      .addNode(textChunkingNode)
      .addNode(textAggregatorNode)
      .addNode(memoryUpdateNode)
      .addNode(flashSubgraphNode)
      .addNode(longTermSubgraphNode)
      .addNode(resultMergeNode)
      .addNode(saveMemoryNode)
      .addNode(ttsRequestBuilderNode)
      .addNode(ttsNode)
      .addNode(stateUpdateNode);

    // Add knowledge node only if knowledge records are available
    if (knowledgeRecords.length > 0) {
      graphBuilder.addNode(knowledgeNode);
    }

    graphBuilder
      .addEdge(textInputNode, textInputTextExtractorNode)
      .addEdge(textInputTextExtractorNode, inputSafetySubgraph.subgraphNode)
      .addEdge(textInputNode, textInputStateUpdaterNode)
      .addEdge(textInputStateUpdaterNode, textInputSafetyMergerNode)
      .addEdge(inputSafetySubgraph.subgraphNode, textInputSafetyMergerNode)
      // Memory: Retrieve relevant memories from extracted text
      .addEdge(textInputTextExtractorNode, memoryRetrievalNode);

    // Add knowledge edges only if knowledge records are available
    if (knowledgeRecords.length > 0) {
      graphBuilder
        // Knowledge: Connect knowledge retrieval to extracted text
        .addEdge(textInputTextExtractorNode, knowledgeNode)
        .addEdge(textInputSafetyMergerNode, dialogPromptBuilderNode, {
          condition: async (input: any) => {
            return input?.isSafe === true;
          },
        })
        .addEdge(knowledgeNode, dialogPromptBuilderNode)
        // Memory: Connect memory retrieval to dialog prompt builder (alongside knowledge)
        .addEdge(memoryRetrievalNode, dialogPromptBuilderNode);
    } else {
      // If no knowledge, connect safety merger directly to dialog prompt builder
      graphBuilder
        .addEdge(textInputSafetyMergerNode, dialogPromptBuilderNode, {
          condition: async (input: any) => {
            return input?.isSafe === true;
          },
        })
        // Memory: Connect memory retrieval to dialog prompt builder
        .addEdge(memoryRetrievalNode, dialogPromptBuilderNode);
    }

    graphBuilder
      .addEdge(textInputSafetyMergerNode, inputSafetyFailureCannedResponseNode, {
        condition: async (input: any) => {
          return input?.isSafe === false;
        },
      })
      .addEdge(inputSafetyFailureCannedResponseNode, responseAggregatorProxyNode, {
        optional: true,
      })
      .addEdge(dialogPromptBuilderNode, llmNode)
      .addEdge(llmNode, textAggregatorNode)
      .addEdge(textAggregatorNode, outputSafetySubgraph.subgraphNode)
      .addEdge(
        outputSafetySubgraph.subgraphNode,
        safetyTextExtractorNode,
        {
          condition: async (input: any) => {
            return input?.isSafe === true;
          },
        },
      )
      .addEdge(safetyTextExtractorNode, responseAggregatorProxyNode, {
        optional: true,
      })
      .addEdge(
        outputSafetySubgraph.subgraphNode,
        outputSafetyFailureCannedResponseNode,
        {
          condition: async (input: any) => {
            return input?.isSafe === false;
          },
        },
      )
      .addEdge(outputSafetyFailureCannedResponseNode, responseAggregatorProxyNode, {
        optional: true,
      })
      .addEdge(responseAggregatorProxyNode, textChunkingNode)
      .addEdge(responseAggregatorProxyNode, stateUpdateNode)
      // Memory: Connect stateUpdateNode to memoryUpdateNode (state now has assistant message)
      .addEdge(stateUpdateNode, memoryUpdateNode)
      // Memory: Connect memory update to memory subgraphs
      .addEdge(memoryUpdateNode, flashSubgraphNode, {
        condition: async (input: any) => {
          const val = input?.value || input;
          return val?.runFlash === true;
        },
        optional: true,
      })
      .addEdge(memoryUpdateNode, longTermSubgraphNode, {
        condition: async (input: any) => {
          return input?.runLongTerm === true;
        },
        optional: true,
      })
      // Memory: Merge memory results
      .addEdge(memoryUpdateNode, resultMergeNode)
      .addEdge(flashSubgraphNode, resultMergeNode, { optional: true })
      .addEdge(longTermSubgraphNode, resultMergeNode, { optional: true })
      // Memory: Save snapshot in saveMemoryNode (separate node to break cycle)
      .addEdge(resultMergeNode, saveMemoryNode, { optional: true })
      .addEdge(textChunkingNode, ttsRequestBuilderNode)
      .addEdge(ttsRequestBuilderNode, ttsNode);

    if (withAudioInput) {
      if (!props.assemblyAIApiKey) {
        throw new Error(
          'Assembly.AI API key is required for audio processing pipeline',
        );
      }
      if (!props.vadClient) {
        throw new Error('VAD client is required for audio processing pipeline');
      }

      const audioInputNode = new ProxyNode();
      const interactionQueueNode = new InteractionQueueNode();

      console.log('Building graph with Assembly.AI STT pipeline');

      const assemblyAISTTNode = new AssemblyAISTTWebSocketNode({
        id: `assembly-ai-stt-ws-node${postfix}`,
        config: {
          apiKey: props.assemblyAIApiKey!,
          connections: connections,
          vadClient: props.vadClient,
          sampleRate: INPUT_SAMPLE_RATE,
          formatTurns: false,
          endOfTurnConfidenceThreshold: 0.4,
          minEndOfTurnSilenceWhenConfident: 160,
          maxTurnSilence: 1280,
        },
      });

      const transcriptExtractorNode = new TranscriptExtractorNode({
        id: `transcript-extractor-node${postfix}`,
        reportToClient: true,
        disableAutoInterruption: props.disableAutoInterruption,
      });

      const speechCompleteNotifierNode = new SpeechCompleteNotifierNode({
        id: `speech-complete-notifier-node${postfix}`,
      });

      graphBuilder
        .addNode(audioInputNode)
        .addNode(assemblyAISTTNode)
        .addNode(transcriptExtractorNode)
        .addNode(speechCompleteNotifierNode)
        .addNode(interactionQueueNode)
        .addEdge(audioInputNode, assemblyAISTTNode)
        .addEdge(assemblyAISTTNode, assemblyAISTTNode, {
          condition: async (input: any) => {
            return input?.stream_exhausted !== true;
          },
          loop: true,
          optional: true,
        })
        .addEdge(assemblyAISTTNode, speechCompleteNotifierNode, {
          condition: async (input: any) => {
            return input?.interaction_complete === true;
          },
        })
        .addEdge(assemblyAISTTNode, transcriptExtractorNode, {
          condition: async (input: any) => {
            return input?.interaction_complete === true;
          },
        })
        .addEdge(transcriptExtractorNode, interactionQueueNode)
        .addEdge(interactionQueueNode, textInputNode, {
          condition: (input: TextInput) => {
            console.log('InteractionQueueNode: condition', input);
            return input.text && input.text.trim().length > 0;
          },
        })
        .addEdge(stateUpdateNode, interactionQueueNode, {
          loop: true,
          optional: true,
        })
        .setStartNode(audioInputNode);
    } else {
      graphBuilder.setStartNode(textInputNode);
    }

    graphBuilder.setEndNode(ttsNode);

    const graph = graphBuilder.build();
    if (props.graphVisualizationEnabled) {
      const graphPath = path.join(os.tmpdir(), `${graphName}.png`);
      console.log(
        `The Graph visualization will be saved to ${graphPath}. If you see any fatal error after this message, pls disable graph visualization.`,
      );
    }

    return new InworldGraphWrapper({
      graph,
    });
  }
}
