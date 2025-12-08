import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

import { State } from '../../types';

/**
 * DialogPromptBuilderNode builds a LLM chat request from the state.
 *
 * This node:
 * - Receives the current conversation state (may include isSafe property from safety checks)
 * - Optionally receives KnowledgeRecords as a second input
 * - Converts state messages to LLM message format
 * - Adds knowledge records as a system message if they exist
 * - Returns a formatted LLMChatRequest for the LLM node
 */
export class DialogPromptBuilderNode extends CustomNode {
  process(
    _context: ProcessContext,
    state: State | (State & { isSafe?: boolean }),
    knowledgeRecords?: GraphTypes.KnowledgeRecords,
  ): GraphTypes.LLMChatRequest {
    // Convert state messages to LLMMessageInterface format
    // Note: isSafe property is ignored, only messages are used
    const conversationMessages = state.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Add knowledge records as a system message if they exist
    const messages: Array<{ role: string; content: string }> = [];
    
    if (knowledgeRecords && knowledgeRecords.records && knowledgeRecords.records.length > 0) {
      console.log(`DialogPromptBuilderNode: Fetched ${knowledgeRecords.records.length} knowledge record(s):`);
      knowledgeRecords.records.forEach((record, index) => {
        console.log(`  [${index + 1}]: ${record}`);
      });
      const knowledgeContext = `You have access to the following knowledge:\n\n${knowledgeRecords.records.map((record, index) => `${index + 1}. ${record}`).join('\n')}\n\nUse this knowledge to provide accurate and helpful responses.`;
      messages.push({
        role: 'system',
        content: knowledgeContext,
      });
    } else {
      console.log('DialogPromptBuilderNode: No knowledge records fetched');
    }

    // Add conversation messages
    messages.push(...conversationMessages);

    return new GraphTypes.LLMChatRequest({
      messages,
    });
  }
}
