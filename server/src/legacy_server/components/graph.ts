import {
  Graph,
  GraphBuilder,
  ProxyNode,
  RemoteLLMChatNode,
  RemoteTTSNode,
  TextAggregatorNode,
  TextChunkingNode,
} from '@inworld/runtime/graph';
import * as os from 'os';
import * as path from 'path';

import {
  INPUT_SAMPLE_RATE,
  TEXT_CONFIG,
  TTS_SAMPLE_RATE,
} from '../../../../constants';
import { CreateGraphPropsInterface, TextInput } from '../types';
import { AssemblyAISTTWebSocketNode } from './nodes/assembly_ai_stt_ws_node';
import { DialogPromptBuilderNode } from './nodes/dialog_prompt_builder_node';
import { InteractionInfoNode } from './nodes/interaction_info_node';
import { InteractionQueueNode } from './nodes/interaction_queue_node';
import { SpeechCompleteNotifierNode } from './nodes/speech_complete_notifier_node';
import { StateUpdateNode } from './nodes/state_update_node';
import { TextInputNode } from './nodes/text_input_node';

//
// Audio pipeline with ProxyNode entry and Assembly.AI STT:
//
// clang-format off
//  ┌──────────────────────────── AUDIO STREAM PROCESSING ──────────────────────────┐
//  │                                                                               │
//  │                    ┌──────────────┐                                           │
//  │                    │ AudioInput   │ (entry point - ProxyNode)                │
//  │                    │ (ProxyNode)  │                                           │
//  │                    └──────┬───────┘                                           │
//  │                           │                                                   │
//  │  ┌────────────────────────┼────────────────────────────────────────────────┐  │
//  │  │ AUDIO PROCESSING       v                                                │  │
//  │  │                        │                                                │  │
//  │  │  ┌────────────────────────────────────────────────────────────────┐     │  │
//  │  │  │ Assembly.AI (Multimodal: Text + Audio)                         │     │  │
//  │  │  │  ┌──────────────────────┐                                      │     │  │
//  │  │  │  │AssemblyAISTTWebSocket│ (handles text & audio via AssemblyAI)│     │  │
//  │  │  │  └──┬─────────┬─────────┘                                      │     │  │
//  │  │  │     │ (loop)  │ [is_running]                                   │     │  │
//  │  │  │     │         │                                                │     │  │
//  │  │  │     │         v [is_running && (is_text_input || !interruption)]│    │  │
//  │  │  │     │    ┌───────────────┐                                     │     │  │
//  │  │  │     │    │InteractionInfo│                                     │     │  │
//  │  │  │     │    └───────┬───────┘                                     │     │  │
//  │  │  └─────┼────────────┼────────────────────────────────────────────┘     │  │
//  │  │        │(SpeechNotif)│                                                  │  │
//  │  └────────┼─────────────┼──────────────────────────────────────────────────┘  │
//  │           │             │                                                     │
//  │           │             v                                                     │
//  │           │   ┌─────────────────┐                                             │
//  │           │   │InteractionQueue │◄────────────┐                               │
//  │           │   └────────┬────────┘             │                               │
//  │           │            │ [text.length>0]      │                               │
//  └───────────┼────────────┼──────────────────────┼───────────────────────────────┘
//                    │                      │
//  ┌─────────────────┼──────────────────────┼─────────────────────────────────────┐
//  │  TEXT PROCESSING & TTS PIPELINE        │ (loop, optional)                   │
//  │                  v                     │                                     │
//  │           ┌──────────┐                 │                                     │
//  │           │TextInput │                 │                                     │
//  │           └────┬─────┘                 │                                     │
//  │                │                       │                                     │
//  │                v                       │                                     │
//  │     ┌──────────────────────┐           │                                     │
//  │     │DialogPromptBuilder   │           │                                     │
//  │     └──────────┬───────────┘           │                                     │
//  │                │                       │                                     │
//  │                v                       │                                     │
//  │            ┌─────┐                     │                                     │
//  │            │ LLM │                     │                                     │
//  │            └──┬──┘                     │                                     │
//  │               │ │                      │                                     │
//  │   ┌───────────┘ └────────┐             │                                     │
//  │   │                      │             │                                     │
//  │   v                      v             │                                     │
//  │ ┌──────────────┐  ┌──────────────┐     │                                     │
//  │ │TextChunking  │  │TextAggregator│     │                                     │
//  │ └──────┬───────┘  └──────┬───────┘     │                                     │
//  │        │                 │             │                                     │
//  │        v                 v             │                                     │
//  │    ┌─────┐        ┌──────────────┐     │                                     │
//  │    │ TTS │        │ StateUpdate  │─────┘                                     │
//  │    └─────┘        └──────────────┘                                           │
//  │    (end)          (loops back to queue)                                      │
//  │                                                                              │
//  └──────────────────────────────────────────────────────────────────────────────┘
//
// Legend:
// ───> Required edge
// <──┐
//    │ Loop edge (optional)
//    └
// clang-format on
//

export class InworldGraphWrapper {
  graph: Graph;

  private constructor({ graph }: { graph: Graph }) {
    this.graph = graph;
  }

  async destroy() {
    await this.graph.stop();
  }

  static async create(props: CreateGraphPropsInterface) {
    // Use GraphBuilder DSL approach to construct the graph
    // All graphs now support both audio and text input via entry node routing
    const {
      llmModelName,
      llmProvider,
      voiceId,
      connections,
      ttsModelId,
      vadClient,
    } = props;

    // Validate VAD client is present for audio capability
    if (!vadClient) {
      throw new Error('VAD client is required for audio processing capability');
    }

    // Validate Assembly.AI API key is provided
    if (!props.assemblyAIApiKey) {
      throw new Error('Assembly.AI API key is required');
    }

    const postfix = '-multimodal-assembly-ai';

    const dialogPromptBuilderNode = new DialogPromptBuilderNode({
      id: `dialog-prompt-builder-node${postfix}`,
    });

    const textInputNode = new TextInputNode({
      id: `text-input-node${postfix}`,
      connections,
      reportToClient: true,
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
      reportToClient: true,
    });

    const graphName = `voice-agent${postfix}`;
    const graphBuilder = new GraphBuilder({
      id: graphName,
      enableRemoteConfig: false,
    });

    // Create common nodes
    // Create audio input node (entry point)
    const audioInputNode = new ProxyNode();

    const interactionQueueNode = new InteractionQueueNode();
    const interactionInfoNode = new InteractionInfoNode({
      id: `interaction-info-node${postfix}`,
      disableAutoInterruption: props.disableAutoInterruption,
      reportToClient: true,
    });

    const speechCompleteNotifierNode = new SpeechCompleteNotifierNode({
      id: `speech-complete-notifier-node${postfix}`,
    });

    // Assembly.AI STT node
    console.log('Building graph with Assembly.AI STT pipeline');

    const assemblyAISTTNode = new AssemblyAISTTWebSocketNode({
      id: `assembly-ai-stt-ws-node${postfix}`,
      config: {
        apiKey: props.assemblyAIApiKey!,
        connections: connections,
        vadClient: props.vadClient,
        sampleRate: INPUT_SAMPLE_RATE,
        formatTurns: false,
        endOfTurnConfidenceThreshold: 0.7,
        minEndOfTurnSilenceWhenConfident: 400,
        maxTurnSilence: 2000,
      },
    });

    graphBuilder
      .addNode(audioInputNode)
      .addNode(textInputNode)
      .addNode(speechCompleteNotifierNode)
      .addNode(dialogPromptBuilderNode)
      .addNode(llmNode)
      .addNode(textChunkingNode)
      .addNode(textAggregatorNode)
      .addNode(ttsNode)
      .addNode(stateUpdateNode)
      .addNode(interactionQueueNode)
      .addNode(interactionInfoNode)
      .addNode(assemblyAISTTNode)
      // Common edges for LLM processing
      .addEdge(dialogPromptBuilderNode, llmNode)
      .addEdge(llmNode, textChunkingNode)
      .addEdge(textChunkingNode, ttsNode)
      .addEdge(llmNode, textAggregatorNode)
      .addEdge(textAggregatorNode, stateUpdateNode)
      // Connect audio input to AssemblyAI STT
      .addEdge(audioInputNode, assemblyAISTTNode)
      // Loop edge: continue processing while stream is running
      .addEdge(assemblyAISTTNode, assemblyAISTTNode, {
        condition: async (input: any) => {
          return input?.is_running === true;
        },
        loop: true,
        optional: true,
      })
      // Speech complete notification: from AssemblyAI when interaction is complete
      .addEdge(assemblyAISTTNode, speechCompleteNotifierNode, {
        condition: async (input: any) => {
          return (
            input?.is_running &&
            (input?.is_text_input || !input?.is_interruption)
          );
        },
      })
      // AssemblyAI → InteractionInfoNode when interaction is complete
      .addEdge(assemblyAISTTNode, interactionInfoNode, {
        condition: async (input: any) => {
          return (
            input?.is_running &&
            (input?.is_text_input || !input?.is_interruption)
          );
        },
      });

    // Common path: InteractionInfo -> Queue -> TextInput -> ... -> TTS
    graphBuilder
      .addEdge(interactionInfoNode, interactionQueueNode)
      .addEdge(interactionQueueNode, textInputNode, {
        condition: (input: TextInput) => {
          console.log('InteractionQueueNode: condition', input);
          return input.text && input.text.trim().length > 0;
        },
      })
      .addEdge(textInputNode, dialogPromptBuilderNode)
      .addEdge(stateUpdateNode, interactionQueueNode, {
        loop: true,
        optional: true,
      })
      .setStartNode(audioInputNode)
      .setEndNode(ttsNode);

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
