import { CustomNode, ProcessContext, GraphTypes } from '@inworld/runtime/graph';
import {
  MemoryUpdaterRequest,
  InteractionEvent,
  MemorySnapshot,
} from './memory_types';
import { ConnectionsMap, State } from '../../../types';
import { getDefaultMemoryStore } from '../../memory_store';

export interface MemoryUpdateConfig {
  flashInterval?: number;
  longTermInterval?: number;
  connections: ConnectionsMap;
}

export class MemoryUpdateNode extends CustomNode {
  private config: MemoryUpdateConfig;
  private memoryStore = getDefaultMemoryStore();

  constructor(config: MemoryUpdateConfig) {
    super();
    this.config = {
      flashInterval: 2,
      longTermInterval: 10,
      ...config,
    };
  }

  async process(
    context: ProcessContext,
    ...inputs: any[]
  ): Promise<
    MemoryUpdaterRequest & { response: string; runFlash: boolean; runLongTerm: boolean }
  > {
    // Get sessionId from datastore
    const sessionId = context.getDatastore().get('sessionId') as string;
    if (!sessionId) {
      throw new Error('MemoryUpdateNode: Missing sessionId');
    }

    // Get connection - this is the persistent source of truth
    const connection = this.config.connections[sessionId];
    if (!connection) {
      throw new Error(`MemoryUpdateNode: Missing connection for sessionId: ${sessionId}`);
    }

    // Read state from connection (persistent across executions)
    const currentState = connection.state;
    
    if (!currentState || !currentState.messages) {
      throw new Error('MemoryUpdateNode: Missing state or messages in connection');
    }

    // Get memory snapshot from connection or load from store
    let snapshot: MemorySnapshot;
    if (connection.memorySnapshot) {
      snapshot = connection.memorySnapshot;
    } else {
      snapshot = this.memoryStore.loadOrCreateMemorySnapshot(sessionId);
      // Store in connection for future use
      connection.memorySnapshot = snapshot;
    }

    // Convert ChatMessage[] to InteractionEvent[] format for memory processing
    // Filter out system messages as they shouldn't be part of dialogue turns
    const eventHistory: InteractionEvent[] = currentState.messages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        agentName: msg.role === 'user' ? 'User' : 'Assistant',
      }));

    // Extract the latest assistant response for the return value
    const lastMessage = currentState.messages[currentState.messages.length - 1];
    const responseContent = lastMessage?.role === 'assistant' ? lastMessage.content : undefined;

    // Decide if we should run memory updates
    // Turn count should only include user messages (not system messages)
    const turnCount = eventHistory.filter((e) => e.role === 'user').length;

    const flashInterval = this.config.flashInterval || 2;
    const longTermInterval = this.config.longTermInterval || 10;

    const runFlash = turnCount > 0 && turnCount % flashInterval === 0;
    const runLongTerm = turnCount > 0 && turnCount % longTermInterval === 0;

    return {
      eventHistory,
      memorySnapshot: snapshot,
      forceLongTerm: runLongTerm,
      response: responseContent,
      runFlash,
      runLongTerm,
    };
  }
}

