import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { ConnectionsMap } from '../../../types';
import { MemorySnapshot } from './memory_types';
import { getDefaultMemoryStore } from '../../memory_store';

/**
 * SaveMemoryNode saves the memory snapshot to connection and disk.
 *
 * This node:
 * - Receives a MemorySnapshot from resultMergeNode
 * - Saves it to the connection and disk
 * - Does not output anything (breaks the cycle)
 */
export class SaveMemoryNode extends CustomNode {
  private connections: ConnectionsMap;
  private memoryStore = getDefaultMemoryStore();

  constructor(props: {
    id: string;
    connections: ConnectionsMap;
  }) {
    super({
      id: props.id,
    });
    this.connections = props.connections;
  }

  process(context: ProcessContext, ...inputs: any[]): void {
    // Input: MemorySnapshot from resultMergeNode

    let memorySnapshot: MemorySnapshot | undefined;

    for (const input of inputs) {
      const val = input?.value || input;
      if (!val) continue;

      // Check for MemorySnapshot
      if (val.flashMemory || val.longTermMemory) {
        memorySnapshot = val as MemorySnapshot;
        break; // Use the first snapshot we find
      }
    }

    if (!memorySnapshot) {
      // No snapshot to save, just return
      return;
    }

    // Get sessionId from datastore
    const sessionId = context.getDatastore().get('sessionId') as string;
    if (!sessionId) {
      console.warn('SaveMemoryNode: Missing sessionId, skipping memory save');
      return;
    }

    const connection = this.connections[sessionId];
    if (connection) {
      connection.memorySnapshot = memorySnapshot;
    }

    // Persist to disk
    this.memoryStore.saveMemorySnapshot(sessionId, memorySnapshot);
  }
}

