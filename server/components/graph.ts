import {
  Graph,
  GraphBuilder,
  ProxyNode,
  RemoteLLMChatNode,
  RemoteSTTNode,
  RemoteTTSNode,
  TextAggregatorNode,
  TextChunkingNode,
} from '@inworld/runtime/graph';
import * as os from 'os';
import * as path from 'path';

import {
  INPUT_SAMPLE_RATE,
  PAUSE_DURATION_THRESHOLD_MS,
  SPEECH_THRESHOLD,
  TEXT_CONFIG,
  TTS_SAMPLE_RATE,
} from '../../constants';
import { CreateGraphPropsInterface, TextInput } from '../types';
//import { AssemblyAISTTNode } from './nodes/assembly_ai_stt_node';
import { AssemblyAISTTWebSocketNode } from './nodes/assembly_ai_stt_ws_node';
import { AudioExtractorNode } from './nodes/audio_extractor_node';
import { AudioNormalizerNode } from './nodes/audio_normalizer_node';
import { AudioStreamSlicerNode } from './nodes/audio_stream_slicer_node';
import { DialogPromptBuilderNode } from './nodes/dialog_prompt_builder_node';
import { GroqSTTNode } from './nodes/groq_stt_node';
import { InteractionInfoNode } from './nodes/interaction_info_node';
import { InteractionQueueNode } from './nodes/interaction_queue_node';
import { SpeechCompleteNotifierNode } from './nodes/speech_complete_notifier_node';
import { StateUpdateNode } from './nodes/state_update_node';
import { TextInputNode } from './nodes/text_input_node';
import { TranscriptExtractorNode } from './nodes/transcript_extractor_node';

//
// A complete audio-to-speech pipeline with stream slicer and LLM:
//
// clang-format off
//  ┌──────────────────────────── AUDIO INPUT PIPELINE ────────────────────────────┐
//  │                                                                              │
//  │                         ┌──────────┐                                         │
//  │                         │AudioInput│                                         │
//  │                         └────┬─────┘                                         │
//  │                              │                                               │
//  │                              v                                               │
//  │  ┌───────────────────────────────────────────────────────────────────────┐   │
//  │  │ OPTION 1: VAD-based (useAssemblyAI=false, default)                    │   │
//  │  │                    ┌─────────────────┐                                │   │
//  │  │                 ┌──┤AudioStreamSlicer│◄───┐                           │   │
//  │  │                 │  └────────┬────────┘    │                           │   │
//  │  │                 │           │             │ [stream_exhausted!=true]  │   │
//  │  │                 │           │             │ (loop)                    │   │
//  │  │                 │    [interaction_complete]                           │   │
//  │  │                 │           ├─────────────────────┐                   │   │
//  │  │                 │           │                     │                   │   │
//  │  │                 │           v                     v                   │   │
//  │  │                 │    ┌──────────────┐    ┌──────────────────┐         │   │
//  │  │                 │    │AudioExtractor│    │SpeechCompleteNoti│         │   │
//  │  │                 │    └──────┬───────┘    │ (terminal node)  │         │   │
//  │  │                 │           │            │ reports to client│         │   │
//  │  │                 │           │            └──────────────────┘         │   │
//  │  │                 │           │                                         │   │
//  │  │                 │  ┌────────┴─────────┐                               │   │
//  │  │                 │  │ useGroq?         │                               │   │
//  │  │                 │  └────┬─────────┬───┘                               │   │
//  │  │                 │       │ No      │ Yes                               │   │
//  │  │                 │       │ (Inw.)  │ (Groq)                            │   │
//  │  │                 │       v         v                                   │   │
//  │  │                 │ ┌───────────┐  │                                    │   │
//  │  │                 │ │AudioNorm. │  │ (skip norm.)                       │   │
//  │  │                 │ └─────┬─────┘  │                                    │   │
//  │  │                 │       └────┬───┘                                    │   │
//  │  │                 │            v                                        │   │
//  │  │                 │        ┌─────┐                                      │   │
//  │  │                 │        │ STT │                                      │   │
//  │  │                 │        └──┬──┘                                      │   │
//  │  │                 │           │ [text.length>0]                         │   │
//  │  │                 │           │                                         │   │
//  │  │                 │           v                                         │   │
//  │  │                 │    ┌───────────────┐                                │   │
//  │  │                 └───>│InteractionInfo│◄──────────────────────────┐    │   │
//  │  │                      └───────┬───────┘                           │    │   │
//  │  │                              │                             (metadata) │   │
//  │  │                              ├───────────────────────────────────┘    │   │
//  │  │                              │                                        │   │
//  │  │                              v                                        │   │
//  │  └──────────────────────────────┼────────────────────────────────────────┘   │
//  │                                 │                                            │
//  │                                 │                                            │
//  │  ┌──────────────────────────────┼────────────────────────────────────────┐   │
//  │  │ OPTION 2: Assembly.AI (useAssemblyAI=true)                            │   │
//  │  │                    ┌────────────────┐                                 │   │
//  │  │                    │ AssemblyAISTT  │◄───┐                            │   │
//  │  │                    └────────┬───────┘    │                            │   │
//  │  │                             │            │ [stream_exhausted!=true]   │   │
//  │  │                             │            │ (loop)                     │   │
//  │  │                      [interaction_complete]                           │   │
//  │  │                             ├─────────────────────┐                   │   │
//  │  │                             │                     │                   │   │
//  │  │                             v                     v                   │   │
//  │  │                    ┌───────────────────┐  ┌──────────────────┐        │   │
//  │  │                    │TranscriptExtractor│  │SpeechCompleteNoti│        │   │
//  │  │                    └────────┬──────────┘  │ (terminal node)  │        │   │
//  │  │                             │             │ reports to client│        │   │
//  │  │                             │             └──────────────────┘        │   │
//  │  │                             v                                         │   │
//  │  └─────────────────────────────┼─────────────────────────────────────────┘   │
//  │                                │                                             │
//  │                                v                                             │
//  │                      ┌─────────────────┐                                     │
//  │                      │InteractionQueue │◄────────────┐                       │
//  │                      └────────┬────────┘             │                       │
//  │                               │ [text.length>0]      │                       │
//  └───────────────────────────────┼──────────────────────┼───────────────────────┘
//                                  │                      │
//  ┌───────────────────────────────┼──────────────────────┼──────────────────────┐
//  │  TEXT PROCESSING & TTS PIPELINE                      │ (loop, optional)     │
//  │                                v                     │                      │
//  │                         ┌──────────┐                 │                      │
//  │                         │TextInput │                 │                      │
//  │                         └────┬─────┘                 │                      │
//  │                              │                       │                      │
//  │                              v                       │                      │
//  │                   ┌──────────────────────┐           │                      │
//  │                   │DialogPromptBuilder   │           │                      │
//  │                   └──────────┬───────────┘           │                      │
//  │                              │                       │                      │
//  │                              v                       │                      │
//  │                          ┌─────┐                     │                      │
//  │                          │ LLM │                     │                      │
//  │                          └──┬──┘                     │                      │
//  │                             │ │                      │                      │
//  │                 ┌───────────┘ └────────┐             │                      │
//  │                 │                      │             │                      │
//  │                 v                      v             │                      │
//  │         ┌──────────────┐      ┌──────────────┐       │                      │
//  │         │TextChunking  │      │TextAggregator│       │                      │
//  │         └──────┬───────┘      └──────┬───────┘       │                      │
//  │                │                     │               │                      │
//  │                v                     v               │                      │
//  │            ┌─────┐            ┌──────────────┐       │                      │
//  │            │ TTS │            │ StateUpdate  │───────┘                      │
//  │            └─────┘            └──────────────┘                              │
//  │            (end)              (loops back to queue)                         │
//  │                                                                             │
//  └─────────────────────────────────────────────────────────────────────────────┘
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
    const {
      apiKey,
      llmModelName,
      llmProvider,
      voiceId,
      connections,
      withAudioInput = false,
      ttsModelId,
    } = props;

    // Create unique postfix based on audio input and STT provider
    let postfix = withAudioInput ? '-with-audio-input' : '-with-text-input';
    if (withAudioInput) {
      if (props.useAssemblyAI) {
        postfix += '-assembly-ai';
      } else if (props.useGroq) {
        postfix += '-groq';
      } else {
        postfix += '-inworld';
      }
    }

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
      //minChunkLength: 40,
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
      apiKey,
      enableRemoteConfig: false,
    });

    graphBuilder
      .addNode(textInputNode)
      .addNode(dialogPromptBuilderNode)
      .addNode(llmNode)
      .addNode(textChunkingNode)
      .addNode(textAggregatorNode)
      .addNode(ttsNode)
      .addNode(stateUpdateNode)
      .addEdge(textInputNode, dialogPromptBuilderNode)
      .addEdge(dialogPromptBuilderNode, llmNode)
      .addEdge(llmNode, textChunkingNode)
      .addEdge(textChunkingNode, ttsNode)
      .addEdge(llmNode, textAggregatorNode)
      .addEdge(textAggregatorNode, stateUpdateNode);

    if (withAudioInput) {
      // Validate configuration
      if (props.useAssemblyAI && !props.assemblyAIApiKey) {
        throw new Error(
          'Assembly.AI API key is required when useAssemblyAI is enabled',
        );
      }
      if (!props.vadClient) {
        throw new Error('VAD client is required for audio processing pipeline');
      }

      // Start node to pass the audio input to both metadata path and audio processing path
      // When input is DataStream, ProxyNode passes it to both AudioStreamSlicerNode and InteractionQueueNode
      const audioInputNode = new ProxyNode();
      const interactionQueueNode = new InteractionQueueNode();
      const interactionInfoNode = new InteractionInfoNode({
        id: `interaction-info-node${postfix}`,
        disableAutoInterruption: props.disableAutoInterruption,
        reportToClient: true,
      });

      if (props.useAssemblyAI) {
        // ========================================================================
        // OPTION 2: Assembly.AI Pipeline
        // ========================================================================
        console.log('Building graph with Assembly.AI STT pipeline');

        // const assemblyAISTTNode = new AssemblyAISTTNode({
        //   id: `assembly-ai-stt-node${postfix}`,
        //   config: {
        //     apiKey: props.assemblyAIApiKey!,
        //     connections: connections,
        //     vadClient: props.vadClient,
        //     sampleRate: INPUT_SAMPLE_RATE,
        //     formatTurns: false,
        //     endOfTurnConfidenceThreshold: 0.4,
        //     minEndOfTurnSilenceWhenConfident: 160, // milliseconds (AssemblyAI "Balanced" preset)
        //     maxTurnSilence: 1280, // milliseconds (AssemblyAI "Balanced" preset)
        //   },
        // });

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
          // Two separate edges from assemblyAISTTNode when interaction is complete:
          // 1. To speechCompleteNotifierNode for client notification (terminal node)
          .addEdge(assemblyAISTTNode, speechCompleteNotifierNode, {
            condition: async (input: any) => {
              return input?.interaction_complete === true;
            },
          })
          // 2. To transcriptExtractorNode for continued processing
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
        // ========================================================================
        // OPTION 1: VAD-based Pipeline (Default)
        // ========================================================================
        const sttType = props.useGroq ? 'Groq Whisper' : 'Inworld Remote STT';
        console.log(
          `Building graph with VAD-based audio processing pipeline (STT: ${sttType})`,
        );

        const audioStreamSlicerNode = new AudioStreamSlicerNode({
          id: `audio-stream-slicer-node${postfix}`,
          config: {
            vadClient: props.vadClient,
            connections: connections,
            speechThreshold: SPEECH_THRESHOLD,
            pauseDurationMs: PAUSE_DURATION_THRESHOLD_MS,
            sampleRate: INPUT_SAMPLE_RATE,
          },
        });
        const speechCompleteNotifierNode = new SpeechCompleteNotifierNode({
          id: `speech-complete-notifier-node${postfix}`,
        });
        const audioExtractorNode = new AudioExtractorNode({
          id: `audio-extractor-node${postfix}`,
        });

        // Choose STT node based on configuration
        const sttNode = props.useGroq
          ? new GroqSTTNode({
              id: `groq-stt-node${postfix}`,
              config: {
                apiKey: props.groqApiKey!,
                sampleRate: INPUT_SAMPLE_RATE,
                model: props.groqModel || 'whisper-large-v3-turbo',
                language: 'en',
              },
            })
          : new RemoteSTTNode();

        // Build graph with nodes
        graphBuilder
          .addNode(audioInputNode)
          .addNode(audioStreamSlicerNode)
          .addNode(speechCompleteNotifierNode)
          .addNode(audioExtractorNode)
          .addNode(sttNode)
          .addNode(interactionQueueNode)
          .addNode(interactionInfoNode);

        // Add AudioNormalizerNode only for Inworld STT (not Groq)
        let audioNormalizerNode;
        if (!props.useGroq) {
          audioNormalizerNode = new AudioNormalizerNode({
            id: `audio-normalizer-node${postfix}`,
          });
          graphBuilder.addNode(audioNormalizerNode);
        }

        // Add edges
        graphBuilder
          .addEdge(audioInputNode, audioStreamSlicerNode)
          .addEdge(audioStreamSlicerNode, audioStreamSlicerNode, {
            condition: async (input: any) => {
              return input?.stream_exhausted !== true;
            },
            loop: true,
            optional: true,
          })
          // Two separate edges from audioStreamSlicerNode when interaction is complete:
          // 1. To speechCompleteNotifierNode for client notification (terminal node)
          .addEdge(audioStreamSlicerNode, speechCompleteNotifierNode, {
            condition: async (input: any) => {
              return input?.interaction_complete === true;
            },
          })
          // 2. To audioExtractorNode for continued audio processing
          .addEdge(audioStreamSlicerNode, audioExtractorNode, {
            condition: async (input: any) => {
              return input?.interaction_complete === true;
            },
          });

        // Conditional audio processing path based on STT provider
        if (props.useGroq) {
          // Groq: Direct path from extractor to STT
          graphBuilder.addEdge(audioExtractorNode, sttNode);
        } else {
          // Inworld STT: Use normalizer between extractor and STT
          graphBuilder
            .addEdge(audioExtractorNode, audioNormalizerNode!)
            .addEdge(audioNormalizerNode!, sttNode);
        }

        // Continue with common edges
        graphBuilder
          .addEdge(sttNode, interactionInfoNode, {
            condition: async (input: string) => {
              return input.trim().length > 0;
            },
          })
          .addEdge(audioStreamSlicerNode, interactionInfoNode)
          .addEdge(interactionInfoNode, interactionQueueNode)
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
      }
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
