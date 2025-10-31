import { GraphTypes } from '@inworld/runtime/graph';

/**
 * Manages a stream of audio chunks that can be fed to an STT graph
 * Provides an async generator interface that yields audio chunks and can be marked as complete
 */
export class AudioChunkStreamManager {
  private queue: GraphTypes.Audio[] = [];
  private ended: boolean = false;
  private waitingResolvers: Array<
    (value: IteratorResult<GraphTypes.Audio>) => void
  > = [];

  /**
   * Add an audio chunk to the stream
   */
  addChunk(chunk: GraphTypes.Audio): void {
    if (this.ended) {
      console.warn(
        '[AudioChunkStreamManager] Attempted to add chunk after stream ended',
      );
      return;
    }

    // If there's a waiting resolver, resolve it immediately
    if (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: chunk, done: false });
    } else {
      // Otherwise, queue the chunk
      this.queue.push(chunk);
    }
  }

  /**
   * Mark the stream as ended - no more chunks will be accepted
   */
  end(): void {
    this.ended = true;
    console.log('[AudioChunkStreamManager] Stream marked as ended');

    // Resolve all waiting promises with done
    while (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  /**
   * Create an async generator that yields audio chunks
   */
  async *createStream(): AsyncGenerator<GraphTypes.Audio> {
    while (true) {
      // If we have queued chunks, yield them immediately
      if (this.queue.length > 0) {
        const chunk = this.queue.shift()!;
        yield chunk;
        continue;
      }

      // If stream has ended and queue is empty, we're done
      if (this.ended) {
        console.log('[AudioChunkStreamManager] Stream ended, queue is empty');
        break;
      }

      // Wait for next chunk
      const result = await new Promise<IteratorResult<GraphTypes.Audio>>(
        (resolve) => {
          this.waitingResolvers.push(resolve);
        },
      );

      if (result.done) {
        console.log('[AudioChunkStreamManager] Stream ended via done signal');
        break;
      }

      yield result.value;
    }
  }

  /**
   * Check if the stream has ended
   */
  isEnded(): boolean {
    return this.ended;
  }

  /**
   * Reset the stream manager for reuse
   */
  reset(): void {
    this.queue = [];
    this.ended = false;
    this.waitingResolvers = [];
  }
}
