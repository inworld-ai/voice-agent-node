import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import { MemorySnapshot } from './memory_types';
import { ConnectionsMap } from '../../../types';
import { getDefaultMemoryStore } from '../../memory_store';

// Define locally
interface EmbeddedRecord {
  text: string;
  embedding: number[];
}

export interface MemoryRetrievalConfig {
  embedderComponentId: string;
  similarityThreshold: number;
  maxContextItems: number;
  connections: ConnectionsMap;
}

/**
 * MemoryRetrievalNode retrieves relevant memories from the memory snapshot
 * based on semantic similarity to the user's query.
 * 
 * This node:
 * - Takes the user's text input
 * - Searches through flash and long-term memories using embeddings
 * - Returns the most relevant memories based on cosine similarity
 */
export class MemoryRetrievalNode extends CustomNode {
  private config: MemoryRetrievalConfig;
  private memoryStore = getDefaultMemoryStore();

  constructor(config: MemoryRetrievalConfig) {
    super();
    this.config = config;
  }

  async process(
    context: ProcessContext,
    text: string,
  ): Promise<{ relevantMemories: string[] }> {
    if (!text) {
      return { relevantMemories: [] };
    }

    // Get sessionId from datastore
    const sessionId = context.getDatastore().get('sessionId') as string;
    if (!sessionId) {
      return { relevantMemories: [] };
    }

    // Get memory snapshot from connection or load from store
    const connection = this.config.connections[sessionId];
    let snapshot: MemorySnapshot;

    if (connection?.memorySnapshot) {
      snapshot = connection.memorySnapshot;
    } else {
      snapshot = this.memoryStore.loadOrCreateMemorySnapshot(sessionId);
      // Store in connection for future use
      if (connection) {
        connection.memorySnapshot = snapshot;
      }
    }

    if (!snapshot) {
      return { relevantMemories: [] };
    }

    const allMemories: EmbeddedRecord[] = [
      ...(snapshot.flashMemory || []),
      ...(snapshot.longTermMemory || []),
    ]
      .filter((m) => Array.isArray(m.embedding) && m.embedding.length > 0)
      .map((m) => ({ text: m.text, embedding: m.embedding }));

    if (allMemories.length === 0) {
      console.log('No existing memories to search');
      return { relevantMemories: [] };
    }

    // Use the embedder to embed the query
    const embedder = context.getEmbedderInterface(
      this.config.embedderComponentId,
    );
    const queryEmbedding = await embedder.embed(text);

    // Cosine similarity logic
    const queryVector = Array.from(queryEmbedding || []);
    if (!queryVector.length) {
      return { relevantMemories: [] };
    }

    const matches = allMemories.map((record) => {
      const similarity = this.cosineSimilarity(queryVector, record.embedding);
      return { record, similarity };
    });

    // Filter and sort
    const relevant = matches
      .filter((m) => m.similarity >= this.config.similarityThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.config.maxContextItems)
      .map((m) => m.record.text);

    if (relevant.length > 0) {
      console.log(`Found ${relevant.length} relevant memories`);
      console.log('\n[Retrieval Memory]');
      console.log(JSON.stringify(relevant, null, 2));
    } else {
      console.log('No relevant memories found');
    }

    return { relevantMemories: relevant };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
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
}

