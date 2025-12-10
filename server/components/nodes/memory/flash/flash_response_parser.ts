import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import { TextEmbedder } from '@inworld/runtime/primitives/embedder';
import { FlashMemoryConfig, MemoryRecord } from '../memory_types';

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const FACT_TOPIC_REGEX =
  /Fact:\s*([\s\S]*?)\s*\.?\s*Topic:\s*(.*?)(?=\s-\sFact:|\n|$)/gi;

export interface FlashResponseParserConfig extends FlashMemoryConfig {
  embedder: TextEmbedder;
}

export class FlashResponseParserNode extends CustomNode {
  private config: FlashResponseParserConfig;

  constructor(config: FlashResponseParserConfig) {
    super();
    this.config = config;
  }

  async process(
    context: ProcessContext,
    ...inputs: any[]
  ): Promise<{ memoryRecords: MemoryRecord[] }> {
    const input = inputs[0];
    const response = input?.value || input;

    const content = this.extractContent(response);

    if (!content || content.includes('NO_OP_SKIP_TURN')) {
      return { memoryRecords: [] };
    }

    const parsed = this.parseOutput(content);
    if (parsed.length === 0) return { memoryRecords: [] };

    // Embed using shared embedder
    let records: MemoryRecord[];
    try {
      const texts = parsed.map((p) => p.text);
      const embeddings = await this.config.embedder.embedBatch(texts);

      records = parsed.map((p, i) => ({
        text: p.text,
        embedding: Array.from(embeddings[i]),
        topics: p.topics,
        createdAt: Date.now(),
      }));
    } catch (error: any) {
      // If embedding fails, return no records
      console.warn(
        `[Flash Memory] Failed to generate embeddings: ${error.message || error}. ` +
        `Skipping memory storage for this turn.`,
      );
      return { memoryRecords: [] };
    }

    // Deduplicate
    const filtered = this.filterBySimilarity(records);

    if (filtered.length > 0) {
      console.log(`\n[Flash Memory] Created ${filtered.length} new memory record(s):`);
      const replacer = (key: string, value: any) => {
        if (key === 'embedding' && Array.isArray(value)) {
          if (value.length > 5) {
            return [...value.slice(0, 5), `... (${value.length - 5} more)`];
          }
        }
        return value;
      };
      console.log(JSON.stringify(filtered, replacer, 2));
    } else if (records.length > 0) {
      console.log(`[Flash Memory] Parsed ${records.length} record(s) but all were filtered out as duplicates`);
    }

    return { memoryRecords: filtered };
  }

  private extractContent(response: any): string {
    if (typeof response === 'string') return response;
    if (response?.content) return response.content;
    return '';
  }

  private parseOutput(
    output: string,
  ): Array<{ text: string; topics: string[] }> {
    const records: Array<{ text: string; topics: string[] }> = [];
    const normalized = output.replace(/\s+/g, ' ').trim();

    // First, try to extract JSON from the output
    // Remove markdown code blocks and any prefix text
    let cleanOutput = output
      .replace(/```json|```/g, '') // Remove markdown code blocks
      .replace(/^[^[{]*/, '') // Remove any text before first [ or {
      .replace(/[^}\]]*$/, '') // Remove any text after last } or ]
      .trim();
    
    // Try to fix common JSON issues: unquoted string values
    // Look for patterns like "memory": text without quotes (can span multiple lines)
    // Match until we find a comma followed by } or ], or just } or ]
    cleanOutput = cleanOutput.replace(
      /"memory"\s*:\s*([\s\S]+?)(?=\s*[,}\]])/g,
      (match, value) => {
        // Quote the value if it's not already quoted
        const trimmed = value.trim();
        if (trimmed.length > 0 && !trimmed.startsWith('"') && !trimmed.startsWith("'")) {
          // Escape any quotes and newlines in the value
          const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
          return `"memory": "${escaped}"`;
        }
        return match;
      }
    );
    
    try {
      const jsonOutput = JSON.parse(cleanOutput);
      const items = Array.isArray(jsonOutput) ? jsonOutput : [jsonOutput];
      
      for (const item of items) {
        // Only accept memories marked as important
        if (item.important && item.memory && item.memory.length > 0) {
          records.push({
            text: item.memory,
            topics: item.topic && item.topic !== 'n/a' ? [item.topic] : [],
          });
        }
      }
      
      return records;
    } catch (e: any) {
      // Try to extract JSON objects/arrays manually using regex
      // Look for JSON-like structures: { "important": ..., "topic": ..., "memory": ... }
      const jsonObjectRegex = /\{\s*"important"\s*:\s*(true|false)\s*,\s*"topic"\s*:\s*"([^"]*)"\s*,\s*"memory"\s*:\s*"([^"]*)"\s*\}/g;
      // For unquoted memory values, match until we see a comma followed by } or ], or just } or ]
      // This handles multi-line and punctuation in the memory text
      // Use [\s\S] instead of . to match newlines
      const jsonObjectRegexUnquoted = /\{\s*"important"\s*:\s*(true|false)\s*,\s*"topic"\s*:\s*"([^"]*)"\s*,\s*"memory"\s*:\s*([\s\S]+?)(?=\s*[,}\]])/g;
      
      let match;
      
      // Try quoted memory values first
      jsonObjectRegex.lastIndex = 0;
      while ((match = jsonObjectRegex.exec(cleanOutput)) !== null) {
        const important = match[1] === 'true';
        const memory = match[3].trim();
        // Only accept memories marked as important
        if (important && memory.length > 0) {
          records.push({
            text: memory,
            topics: match[2] && match[2] !== 'n/a' ? [match[2]] : [],
          });
        }
      }
      
      // If no matches, try unquoted memory values
      if (records.length === 0) {
        jsonObjectRegexUnquoted.lastIndex = 0;
        while ((match = jsonObjectRegexUnquoted.exec(cleanOutput)) !== null) {
          const important = match[1] === 'true';
          const memory = match[3].trim();
          // Only accept memories marked as important
          if (important && memory.length > 0) {
            records.push({
              text: memory,
              topics: match[2] && match[2] !== 'n/a' ? [match[2]] : [],
            });
          }
        }
      }
      
      // If still no matches, try the original regex fallback
      if (records.length === 0) {
        FACT_TOPIC_REGEX.lastIndex = 0;
        while (
          (match = FACT_TOPIC_REGEX.exec(normalized)) !== null &&
          records.length < (this.config.maxFlashMemory || 4)
        ) {
          records.push({
            text: match[1].trim(),
            topics: [match[2].trim()],
          });
        }
      }
    }
    return records;
  }

  private filterBySimilarity(records: MemoryRecord[]): MemoryRecord[] {
    if (records.length === 0) return records;
    const filtered: MemoryRecord[] = [];

    for (let i = 0; i < records.length; i++) {
      let shouldInclude = true;
      for (let j = i + 1; j < records.length; j++) {
        if (
          cosineSimilarity(records[i].embedding, records[j].embedding) >=
          (this.config.similarityThreshold || 0.85)
        ) {
          shouldInclude = false;
          break;
        }
      }
      if (shouldInclude) filtered.push(records[i]);
    }
    return filtered;
  }
}

