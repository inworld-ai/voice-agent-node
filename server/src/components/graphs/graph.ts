import {
  Graph,
  GraphBuilder,
  ProxyNode,
  RemoteTTSNode,
  FakeTTSComponent,
  TextAggregatorNode,
  TextChunkingNode,
  RemoteLLMChatRoutingNode,
  RealtimeAgentTtsFirstChunkCheckingNode
} from '@inworld/runtime/graph';
import * as os from 'os';
import * as path from 'path';
import logger from '../../logger';

import {
  INPUT_SAMPLE_RATE,
  TTS_SAMPLE_RATE,
} from '../../config';
import { CreateGraphPropsInterface, State, TextInput } from '../../types/index';
import { getAssemblyAISettingsForEagerness } from '../../types/settings';
import { AssemblyAISTTWebSocketNode } from './nodes/assembly_ai_stt_ws_node';
import { DialogPromptBuilderNode } from './nodes/dialog_prompt_builder_node';
import { InteractionQueueNode } from './nodes/interaction_queue_node';
import { StateUpdateNode } from './nodes/state_update_node';
import { TextInputNode } from './nodes/text_input_node';
import { TranscriptExtractorNode } from './nodes/transcript_extractor_node';
import { TTSRequestBuilderNode } from './nodes/tts_request_builder_node';
import { LLMChatRoutingRequestNode } from "./nodes/llm_chat_routing_request_node";

export class InworldGraphWrapper {
  graph: Graph;
  assemblyAINode: AssemblyAISTTWebSocketNode;

  private constructor({ graph, assemblyAINode }: { graph: Graph; assemblyAINode: AssemblyAISTTWebSocketNode }) {
    this.graph = graph;
    this.assemblyAINode = assemblyAINode;
  }

  async destroy() {
    await this.graph.stop();
  }

  static async create(props: CreateGraphPropsInterface) {
    const {
      voiceId,
      connections,
      ttsModelId,
      useMocks = false,
    } = props;

    const postfix = `-multimodal`;

    const llmChatRoutingRequestNode = new LLMChatRoutingRequestNode({
      id: `llm-chat-routing-request-node${postfix}`,
    })


    const textInputNode = new TextInputNode({
      id: `text-input-node${postfix}`,
      connections,
      reportToClient: true,
    });


    const llmRouterNode = new RemoteLLMChatRoutingNode({
      id: `llm-router-node${postfix}`,
      defaultTimeout: 90,
      defaults: {
        textGenerationConfig:{
          maxNewTokens: 320
        }
      }
    })

    const textChunkingNode = new TextChunkingNode({
      id: `text-chunking-node${postfix}`,
      reportToClient:false,
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
      defaultVoiceId: voiceId,
      reportToClient: false,
    });

    const ttsNode = new RemoteTTSNode({
      id: `tts-node${postfix}`,
      speakerId: voiceId,
      modelId: ttsModelId,
      sampleRate: TTS_SAMPLE_RATE,
      temperature: 1.1,
      speakingRate: 1,
      reportToClient: true,
      ...(useMocks && {
        ttsComponent: new FakeTTSComponent({
          id: `tts-component-${postfix}`,
          loadTestConfig: {
            firstChunkDelay: 200,
            sampleRate: 48000,
            errorProbability: 0.0,
            chunksPerRequest: 20,
            interChunkDelay: 100,
            collectMetrics: true,
          },
        }),
      }),
    });

    const ttsFirstNode = new RealtimeAgentTtsFirstChunkCheckingNode({
      id: 'tts_first_chunk_checking_node',
      reportToClient: true,
    });

    // A second branch that only executes text chunking - we will not execute TTS when output_modality doesn't contain audio

    const textChunkingNodeTextOnly = new TextChunkingNode({
      id: `text-chunking-node-text-only${postfix}`,
      reportToClient: true,
    });

    const llmRouterNodeTextOnly = new RemoteLLMChatRoutingNode({
      id: `llm-router-node-text-only${postfix}`,
      defaultTimeout: 90,
      defaults: {
        textGenerationConfig:{
          maxNewTokens: 320
        }
      }
    })

    const llmChatRoutingRequestNodeTextOnly = new LLMChatRoutingRequestNode({
      id: `llm-chat-routing-request-node-text-only${postfix}`,
    })

    const textAggregatorNodeTextOnly = new TextAggregatorNode({
      id: `text-aggregator-node-text-only${postfix}`,
    });

    const stateUpdateNodeTextOnly = new StateUpdateNode({
      id: `state-update-node-text-only${postfix}`,
      connections,
      reportToClient: true,
    });
    // End of the text only branch

    const graphName = `voice-agent${postfix}`;
    const graphBuilder = new GraphBuilder({
      id: graphName,
      enableRemoteConfig: true,
    });

    graphBuilder
      .addNode(textInputNode)
      .addNode(llmChatRoutingRequestNode)
      .addNode(llmRouterNode)
      .addNode(textChunkingNode)
      .addNode(textAggregatorNode)
      .addNode(ttsRequestBuilderNode)
      .addNode(ttsNode)
      .addNode(stateUpdateNode)
      .addEdge(textInputNode, llmChatRoutingRequestNode, {
        condition: async (input: State) => {
          return input?.output_modalities.includes("audio")
        },
      })
      .addEdge(llmChatRoutingRequestNode, llmRouterNode)
      .addEdge(llmRouterNode, textChunkingNode)
      .addEdge(textInputNode, ttsRequestBuilderNode, {
        condition: async (input: State) => {
          return input?.output_modalities.includes("audio")
        },
      })
      .addEdge(textChunkingNode, ttsRequestBuilderNode)
      .addEdge(ttsRequestBuilderNode, ttsNode)
      .addEdge(llmRouterNode, textAggregatorNode)
      .addEdge(textAggregatorNode, stateUpdateNode)
      // Text-only outputs nodes/edges
      .addNode(llmChatRoutingRequestNodeTextOnly)
      .addNode(textChunkingNodeTextOnly)
      .addNode(llmRouterNodeTextOnly)
      .addNode(textAggregatorNodeTextOnly)
      .addNode(stateUpdateNodeTextOnly)
      .addEdge(textInputNode, llmChatRoutingRequestNodeTextOnly, {
        condition: async (input: State) => {
          return !input?.output_modalities.includes("audio") && input?.output_modalities.includes("text")
        },
      })
      .addEdge(llmChatRoutingRequestNodeTextOnly, llmRouterNodeTextOnly)
      .addEdge(llmRouterNodeTextOnly, textChunkingNodeTextOnly)
      .addEdge(llmRouterNodeTextOnly, textAggregatorNodeTextOnly)
      .addEdge(textAggregatorNodeTextOnly, stateUpdateNodeTextOnly);


    // Validate configuration
    if (!props.assemblyAIApiKey) {
      throw new Error('Assembly.AI API key is required for audio input');
    }

    logger.info('Building graph with Multimodal pipeline');

    // Start node to pass the audio input to Assembly.AI STT
    const audioInputNode = new ProxyNode();
    const interactionQueueNode = new InteractionQueueNode({
      id: `interaction-queue-node${postfix}`,
      connections,
      reportToClient: false,
    });

    // Get eagerness settings from connection state, default to 'medium'
    const connection = connections[Object.keys(connections)[0]];
    const eagerness = connection?.state?.eagerness || 'medium';
    const turnDetectionSettings = getAssemblyAISettingsForEagerness(eagerness);

    logger.info({
      eagerness,
      profile: turnDetectionSettings.description,
      endOfTurnConfidenceThreshold: turnDetectionSettings.endOfTurnConfidenceThreshold,
      minEndOfTurnSilenceWhenConfident: turnDetectionSettings.minEndOfTurnSilenceWhenConfident,
      maxTurnSilence: turnDetectionSettings.maxTurnSilence,
    }, `Configured eagerness: ${eagerness} (${turnDetectionSettings.description})`);

    const assemblyAISTTNode = new AssemblyAISTTWebSocketNode({
      id: `assembly-ai-stt-ws-node${postfix}`,
      config: {
        apiKey: props.assemblyAIApiKey!,
        connections: connections,
        sampleRate: INPUT_SAMPLE_RATE,
        formatTurns: false,
        endOfTurnConfidenceThreshold: turnDetectionSettings.endOfTurnConfidenceThreshold,
        minEndOfTurnSilenceWhenConfident: turnDetectionSettings.minEndOfTurnSilenceWhenConfident,
        maxTurnSilence: turnDetectionSettings.maxTurnSilence,
      },
    });

    const transcriptExtractorNode = new TranscriptExtractorNode({
      id: `transcript-extractor-node${postfix}`,
      reportToClient: true,
    });

    graphBuilder
      .addNode(audioInputNode)
      .addNode(assemblyAISTTNode)
      .addNode(transcriptExtractorNode)
      .addNode(interactionQueueNode)
      .addEdge(audioInputNode, assemblyAISTTNode)
      .addEdge(assemblyAISTTNode, assemblyAISTTNode, {
        condition: async (input: any) => {
          return input?.stream_exhausted !== true;
        },
        loop: true,
        optional: true,
      })
      // When interaction is complete, send to transcriptExtractorNode for processing
      .addEdge(assemblyAISTTNode, transcriptExtractorNode, {
        condition: async (input: any) => {
          return input?.interaction_complete === true;
        },
      })
      .addEdge(transcriptExtractorNode, interactionQueueNode)
      .addEdge(interactionQueueNode, textInputNode, {
        condition: (input: TextInput) => {
          logger.debug({ text: input.text?.substring(0, 100) }, `InteractionQueueNode checking condition: "${input.text?.substring(0, 50)}..."`);
          return input.text && input.text.trim().length > 0;
        },
      })
      .addEdge(stateUpdateNode, interactionQueueNode, {
        loop: true,
        optional: true,
      })
      .setStartNode(audioInputNode);

    graphBuilder.setEndNode(ttsNode);

    const graph = graphBuilder.build();
    if (props.graphVisualizationEnabled) {
      const graphPath = path.join(os.tmpdir(), `${graphName}.png`);
      logger.info(
        { graphPath },
        'The Graph visualization will be saved to this path. If you see any fatal error after this message, pls disable graph visualization'
      );
    }

    // Return wrapper with assemblyAI node reference
    return new InworldGraphWrapper({
      graph,
      assemblyAINode: assemblyAISTTNode,
    });
  }
}
