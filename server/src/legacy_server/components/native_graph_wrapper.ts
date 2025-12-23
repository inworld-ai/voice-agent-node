import { Graph, RealtimeAgentGraphBuilder } from '@inworld/runtime/graph';

import { CreateGraphPropsInterface } from '../types';

// ============================================================================
// NativeGraphWrapper
// ============================================================================

/**
 * Wrapper for native C++ graphs that use JSON configuration.
 *
 * Native graphs are different from GraphBuilder DSL graphs:
 * - Created per-session to support different system prompts
 * - Use JSON configuration instead of programmatic DSL
 * - Don't need initialization via start() - ready after construction
 * - Start processing when start() is called with actual input data
 */
export class NativeGraphWrapper {
  graph: Graph;

  private constructor({ graph }: { graph: Graph }) {
    this.graph = graph;
  }

  async destroy() {
    await this.graph.stop();
  }

  static async createWithGraphBuilder(
    props: CreateGraphPropsInterface,
  ): Promise<NativeGraphWrapper> {
    console.log('Creating native C++ graph with GraphBuilder DSL');

    const promptTemplate =
      '\n\n\n\n{% if history and history|length > 0 %}\n\n# Previous conversation:\n\n{%- for turn in history %}\n\n{{ turn["role"] }}: {{ turn["text"] }}\n\n{%- endfor %}\n\n{% endif %}\n\n# Current User message:\n\nUser: {{user_query}}\n\n\n\nA:\n\n';

    const agentPrompt = (props.systemPrompt || '') + promptTemplate;

    const substitutions: Record<string, string> = {
      AGENT_PROMPT: agentPrompt,
    };
    if (props.vadModelPath) {
      substitutions.VAD_MODEL_PATH = props.vadModelPath;
    }
    if (props.turnDetectorModelPath) {
      substitutions.TURN_DETECTOR_MODEL_PATH = props.turnDetectorModelPath;
    }
    if (props.groqApiKey) {
      substitutions.GROQ_API_KEY = props.groqApiKey;
    }

    const sttComponentId = props.groqApiKey ? 'groq_stt' : 'inworld_stt';

    const graph = new RealtimeAgentGraphBuilder({
      id: 'voice-agent-native',
      apiKey: props.apiKey,
      enableRemoteConfig: false,
      substitutions,
      sttComponentId,
      voiceId: props.voiceId || 'Dennis',
      voiceLanguageCode: 'en-US',
      overrides: {
        interruptionEventOutputTemplate:
          "{'isInterrupted': input.is_interruption, 'interactionId': input.interaction_id}",
      },
    }).build();

    return new NativeGraphWrapper({ graph });
  }
}
