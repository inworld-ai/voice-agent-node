import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

import { State } from '../../types';

/**
 * DialogPromptBuilderNode builds a LLM chat request from the state.
 *
 * This node:
 * - Receives the current conversation state (may include isSafe property from safety checks)
 * - Optionally receives KnowledgeRecords as a second input
 * - Optionally receives relevantMemories from RAG node
 * - Converts state messages to LLM message format
 * - Adds knowledge records as a system message if they exist
 * - Adds memory context as a system message if memories exist
 * - Returns a formatted LLMChatRequest for the LLM node
 */
export class DialogPromptBuilderNode extends CustomNode {
  process(
    _context: ProcessContext,
    state: State | (State & { isSafe?: boolean }),
    knowledgeRecords?: GraphTypes.KnowledgeRecords,
    memoryContext?: { relevantMemories: string[] },
  ): GraphTypes.LLMChatRequest {
    // Convert state messages to LLMMessageInterface format
    // Note: isSafe property is ignored, only messages are used
    const conversationMessages = state.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Build messages array in the correct order:
    // 1. Primary system prompt (from state.messages)
    // 2. Knowledge system message (if available)
    // 3. Memory system message (if available)
    // 4. Rest of conversation messages (user/assistant)
    const messages: Array<{ role: string; content: string }> = [];
    
    // Find and add the primary system prompt first (it should be the first message)
    const primarySystemMessage = conversationMessages.find((msg) => msg.role === 'system');
    if (primarySystemMessage) {
      messages.push(primarySystemMessage);
    }

    // Add knowledge records as a system message if they exist
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

    // Add memory context if available
    if (memoryContext && memoryContext.relevantMemories && memoryContext.relevantMemories.length > 0) {
      const count = memoryContext.relevantMemories.length;
      console.log(`DialogPromptBuilderNode: Using ${count} relevant ${count === 1 ? 'memory' : 'memories'}`);
      const memoryContextText = `Here is what you remember about the user based on the current conversation topic:\n\n${memoryContext.relevantMemories.map((m, index) => `${index + 1}. ${m}`).join('\n')}\n\nUse this context naturally in your responses. Do not explicitly mention "your memories" or "records" - just use the information as if you recall it.`;
      messages.push({
        role: 'system',
        content: memoryContextText,
      });
    }

    // Add remaining conversation messages (excluding the primary system message we already added)
    const remainingMessages = conversationMessages.filter((msg) => 
      !(msg.role === 'system' && msg === primarySystemMessage)
    );
    messages.push(...remainingMessages);

    return new GraphTypes.LLMChatRequest({
      messages,
    });
  }
}
