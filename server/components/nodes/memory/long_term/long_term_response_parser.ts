import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import { MemoryRecord } from '../memory_types';

export interface LongTermResponseParserConfig {
  embedderComponentId: string;
}

export class LongTermResponseParserNode extends CustomNode {
  private embedderComponentId: string;

  constructor(config: LongTermResponseParserConfig) {
    super();
    this.embedderComponentId = config.embedderComponentId;
  }

  async process(
    context: ProcessContext,
    ...inputs: any[]
  ): Promise<{ newLongTermMemory: MemoryRecord[] }> {
    const input = inputs[0];
    const response = input?.value || input;
    const content = this.extractContent(response);

    if (!content || content.trim().length === 0) {
      return { newLongTermMemory: [] };
    }

    const newRecords: MemoryRecord[] = [
      {
        text: content.trim(),
        embedding: [],
        topics: ['conversation_summary'],
        createdAt: Date.now(),
      },
    ];

    // Embed new records
    if (newRecords.length > 0) {
      const embedder = context.getEmbedderInterface(this.embedderComponentId);
      const texts = newRecords.map((r) => r.text);
      const embeddings = await embedder.embedBatch(texts);

      newRecords.forEach((r, i) => {
        r.embedding = Array.from(embeddings[i]);
      });
    }

    if (newRecords.length > 0) {
      console.log(`\n[Long Term Memory] Created ${newRecords.length} new memory record(s):`);
      const replacer = (key: string, value: any) => {
        if (key === 'embedding' && Array.isArray(value)) {
          if (value.length > 5) {
            return [...value.slice(0, 5), `... (${value.length - 5} more)`];
          }
        }
        return value;
      };
      console.log(JSON.stringify(newRecords, replacer, 2));
    }

    return {
      newLongTermMemory: newRecords,
    };
  }

  private extractContent(response: any): string {
    if (typeof response === 'string') return response;
    if (response?.content) return response.content;
    if (response?.choices?.[0]?.message?.content)
      return response.choices[0].message.content;
    return '';
  }
}

