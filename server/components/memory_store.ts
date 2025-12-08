import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemorySnapshot } from './nodes/memory/memory_types';

/**
 * Simple file-based memory storage.
 */
export interface MemoryStoreConfig {
  storageDir: string;
}

export class MemoryStore {
  private storageDir: string;

  constructor(config: MemoryStoreConfig) {
    this.storageDir = config.storageDir;
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private getFilePath(sessionId: string): string {
    return path.join(this.storageDir, `${sessionId}.json`);
  }

  loadOrCreateMemorySnapshot(sessionId: string): MemorySnapshot {
    const filePath = this.getFilePath(sessionId);

    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const snapshot = JSON.parse(data);
        // Ensure fields exist
        return {
          flashMemory: snapshot.flashMemory || [],
          longTermMemory: snapshot.longTermMemory || [],
        };
      } catch (error) {
        console.error(
          `Failed to load memory for session ${sessionId}:`,
          error,
        );
      }
    }

    return {
      flashMemory: [],
      longTermMemory: [],
    };
  }

  saveMemorySnapshot(sessionId: string, snapshot: MemorySnapshot): void {
    const filePath = this.getFilePath(sessionId);
    try {
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch (error) {
      console.error(
        `Failed to save memory for session ${sessionId}:`,
        error,
      );
    }
  }

  deleteMemorySnapshot(sessionId: string): void {
    const filePath = this.getFilePath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export function getDefaultMemoryStore(
  config: MemoryStoreConfig = {
    storageDir: process.env.MEMORY_STORAGE_DIR || 
      path.join(os.tmpdir(), 'voice-agent-memory'),
  },
): MemoryStore {
  return new MemoryStore(config);
}

