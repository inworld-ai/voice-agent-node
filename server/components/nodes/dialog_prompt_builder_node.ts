import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

import { State } from '../../types';

/**
 * DialogPromptBuilderNode builds a LLM chat request from the state.
 *
 * This node:
 * - Receives the current conversation state (may include isSafe property from safety checks)
 * - Converts state messages to LLM message format
 * - Returns a formatted LLMChatRequest for the LLM node
 */
export class DialogPromptBuilderNode extends CustomNode {
  process(
    _context: ProcessContext,
    state: State | (State & { isSafe: boolean }),
  ): GraphTypes.LLMChatRequest {
    console.log('DialogPromptBuilderNode');
    // Convert state messages to LLMMessageInterface format
    // Note: isSafe property is ignored, only messages are used
    const conversationMessages = state.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    return new GraphTypes.LLMChatRequest({
      messages: conversationMessages,
    });
  }
}
