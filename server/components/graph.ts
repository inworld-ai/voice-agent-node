import {
  Graph,
  GraphBuilder,
  KeywordMatcherNode,
  ProxyNode,
  RandomCannedTextNode,
  RemoteEmbedderComponent,
  RemoteLLMChatNode,
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

import {
  INPUT_SAMPLE_RATE,
  TEXT_CONFIG,
  TTS_SAMPLE_RATE,
} from '../../constants';
import { CreateGraphPropsInterface, TextInput } from '../types';
import { AssemblyAISTTWebSocketNode } from './nodes/assembly_ai_stt_ws_node';
import { DialogPromptBuilderNode } from './nodes/dialog_prompt_builder_node';
import { InteractionQueueNode } from './nodes/interaction_queue_node';
import { SpeechCompleteNotifierNode } from './nodes/speech_complete_notifier_node';
import { SafetyAggregatorCustomNode } from './nodes/safety_aggregator_node';
import { SafetyTextExtractorNode } from './nodes/safety_text_extractor_node';
import { StateUpdateNode } from './nodes/state_update_node';
import { TextInputNode } from './nodes/text_input_node';
import { TextInputSafetyExtractorNode } from './nodes/text_input_safety_extractor_node';
import { TextInputSafetyMergerNode } from './nodes/text_input_safety_merger_node';
import { TextInputStateUpdaterNode } from './nodes/text_input_state_updater_node';
import { TranscriptExtractorNode } from './nodes/transcript_extractor_node';

//
// A complete audio-to-speech pipeline with stream slicer, LLM, and safety checks:
//
// clang-format off
//
//  Graph Structure (based on actual edges in code):
//
//  ┌─────────────────────────────────────────────────────────────────────────────┐
//  │                        AUDIO INPUT PATH (withAudioInput=true)                │
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
//  │                        TEXT INPUT PATH (common for both audio and text)      │
//  └─────────────────────────────────────────────────────────────────────────────┘
//
//  textInputNode
//      │
//      ├──> textInputSafetyExtractorNode
//      │       │
//      │       └──> inputSafetySubgraph
//      │               │
//      │               └──> textInputSafetyMergerNode
//      │
//      └──> textInputStateUpdaterNode
//              │
//              └──> textInputSafetyMergerNode
//                      │
//                      ├──> [isSafe === true] dialogPromptBuilderNode
//                      │       │
//                      │       └──> llmNode
//                      │               │
//                      │               └──> textAggregatorNode
//                      │                       │
//                      │                       └──> outputSafetySubgraph
//                      │                               │
//                      │                               ├──> [isSafe === true] safetyTextExtractorNode
//                      │                               │       │
//                      │                               │       └──> responseAggregatorProxyNode
//                      │                               │
//                      │                               └──> [isSafe === false] outputSafetyFailureCannedResponseNode
//                      │                                       │
//                      │                                       └──> responseAggregatorProxyNode
//                      │
//                      └──> [isSafe === false] inputSafetyFailureCannedResponseNode
//                              │
//                              └──> responseAggregatorProxyNode
//
//  ┌─────────────────────────────────────────────────────────────────────────────┐
//  │                        COMMON OUTPUT PATH                                    │
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
//              └──<──┐ [loop, optional] (when withAudioInput=true)
//                    │
//                    └──> interactionQueueNode
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
  const DEFAULT_TEXT_CLASSIFIER_WEIGHTS_MODEL_PATH = path.resolve(
    process.cwd(),
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
    process.cwd(),
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
    } = props;

    let postfix = withAudioInput ? '-with-audio-input' : '-with-text-input';
    if (withAudioInput) {
      postfix += '-assembly-ai';
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

    const ttsNode = new RemoteTTSNode({
      id: `tts-node${postfix}`,
      speakerId: voiceId,
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

    const graphName = `voice-agent${postfix}`;
    const graphBuilder = new GraphBuilder({
      id: graphName,
      apiKey,
      enableRemoteConfig: false,
    });

    graphBuilder
      .addComponent(inputSafetySubgraph.textEmbedderComponent)
      .addComponent(outputSafetySubgraph.textEmbedderComponent)
      .addSubgraph(inputSafetySubgraph.subgraph)
      .addSubgraph(outputSafetySubgraph.subgraph);

    const textInputNode = new TextInputNode({
      id: `text-input-node${postfix}`,
    });

    const textInputSafetyExtractorNode = new TextInputSafetyExtractorNode({
      id: `text-input-safety-extractor-node${postfix}`,
    });

    const textInputStateUpdaterNode = new TextInputStateUpdaterNode({
      id: `text-input-state-updater-node${postfix}`,
      connections,
      reportToClient: true,
    });

    const textInputSafetyMergerNode = new TextInputSafetyMergerNode({
      id: `text-input-safety-merger-node${postfix}`,
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
      .addNode(textInputSafetyExtractorNode)
      .addNode(textInputStateUpdaterNode)
      .addNode(textInputSafetyMergerNode)
      .addNode(inputSafetySubgraph.subgraphNode)
      .addNode(inputSafetyFailureCannedResponseNode)
      .addNode(dialogPromptBuilderNode)
      .addNode(llmNode)
      .addNode(outputSafetySubgraph.subgraphNode)
      .addNode(safetyTextExtractorNode)
      .addNode(outputSafetyFailureCannedResponseNode)
      .addNode(responseAggregatorProxyNode)
      .addNode(textChunkingNode)
      .addNode(textAggregatorNode)
      .addNode(ttsNode)
      .addNode(stateUpdateNode);

    graphBuilder
      .addEdge(textInputNode, textInputSafetyExtractorNode)
      .addEdge(textInputSafetyExtractorNode, inputSafetySubgraph.subgraphNode)
      .addEdge(textInputNode, textInputStateUpdaterNode)
      .addEdge(textInputStateUpdaterNode, textInputSafetyMergerNode)
      .addEdge(inputSafetySubgraph.subgraphNode, textInputSafetyMergerNode)
      .addEdge(textInputSafetyMergerNode, dialogPromptBuilderNode, {
        condition: async (input: any) => {
          return input?.isSafe === true;
        }
      })
      .addEdge(textInputSafetyMergerNode, inputSafetyFailureCannedResponseNode, {
        condition: async (input: any) => {
          return input?.isSafe === false;
        }
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
      .addEdge(textChunkingNode, ttsNode);

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
