import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { MemoryUpdaterRequest, LongTermMemoryConfig } from '../memory_types';

export class LongTermPromptBuilderNode extends CustomNode {
  private config: LongTermMemoryConfig;

  constructor(config: LongTermMemoryConfig) {
    super();
    this.config = config;
  }

  async process(
    _context: ProcessContext,
    ...inputs: any[]
  ): Promise<GraphTypes.LLMChatRequest> {
    const input = inputs[0];
    const request = (input?.value || input) as MemoryUpdaterRequest;

    const longTermMemoryRecords = request?.memorySnapshot?.longTermMemory || [];
    const eventHistory = request?.eventHistory || [];

    const previousLongTermText = longTermMemoryRecords
      .map((r) => r.text)
      .join('\n\n');

    const maxTurns = this.config.maxHistoryToProcess || 10;
    const historySlice = eventHistory.slice(-maxTurns);
    const dialogueContent = historySlice
      .map((e) => `${e.role}: ${e.content || e.utterance}`)
      .join('\n');

    const prompt = await renderJinja(this.config.promptTemplate, {
      topic: 'conversation_summary',
      dialogueLines: dialogueContent,
      previousLongTerm: previousLongTermText,
    });

    console.log('\n--- Rendered Prompt: Long Term Memory Prompt ---');
    console.log(prompt);
    console.log('------------------------------\n');

    return new GraphTypes.LLMChatRequest({
      messages: [{ role: 'user', content: prompt }],
    });
  }
}

