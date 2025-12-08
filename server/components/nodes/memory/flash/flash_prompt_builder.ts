import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import {
  MemoryUpdaterRequest,
  FlashMemoryConfig,
  InteractionEvent,
} from '../memory_types';

function getDialogueHistorySlice(
  history: InteractionEvent[],
  fromTurn: number,
  toTurn: number,
): string {
  const start = Math.max(0, fromTurn);
  const end = Math.min(history.length, toTurn);
  const slice = history.slice(start, end);
  return slice.map((e) => `${e.role}: ${e.content || e.utterance}`).join('\n');
}

export class FlashPromptBuilderNode extends CustomNode {
  private config: FlashMemoryConfig;

  constructor(config: FlashMemoryConfig) {
    super();
    this.config = {
      maxHistoryToProcess: 10,
      ...config,
    };
  }

  async process(
    _context: ProcessContext,
    ...inputs: any[]
  ): Promise<GraphTypes.LLMChatRequest> {
    const input = inputs[0];
    const request = (input?.value || input) as MemoryUpdaterRequest;

    const eventHistory = request?.eventHistory;

    if (!eventHistory || !Array.isArray(eventHistory)) {
      return new GraphTypes.LLMChatRequest({ messages: [] });
    }

    // Prepare prompt
    // maxTurns represents the number of complete dialogue turns (user + assistant pairs)
    // So we need maxTurns * 2 events (one user + one assistant per turn)
    const maxTurns = this.config.maxHistoryToProcess || 10;
    const maxEvents = maxTurns * 2;
    
    // Take the last N events, but ensure we start from a user message to get complete turns
    let recentHistory = eventHistory.slice(-maxEvents);
    
    // If the first event is not a user message, find the first user message
    // This ensures we always have complete turns (user -> assistant pairs)
    if (recentHistory.length > 0 && recentHistory[0].role !== 'user') {
      const firstUserIndex = recentHistory.findIndex((e) => e.role === 'user');
      if (firstUserIndex > 0) {
        recentHistory = recentHistory.slice(firstUserIndex);
      }
    }
    
    if (recentHistory.length === 0) {
      return new GraphTypes.LLMChatRequest({
        messages: [{ role: 'user', content: 'NO_OP_SKIP_TURN' }],
      });
    }

    const dialogueHistory = getDialogueHistorySlice(
      recentHistory,
      0,
      recentHistory.length,
    );

    const prompt = await renderJinja(this.config.promptTemplate, {
      dialogue_history: dialogueHistory,
    });

    return new GraphTypes.LLMChatRequest({
      messages: [{ role: 'user', content: prompt }],
    });
  }
}

