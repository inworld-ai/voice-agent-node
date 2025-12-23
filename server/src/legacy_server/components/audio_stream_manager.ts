import { AudioChunkInterface } from '@inworld/runtime/common';
import { GraphTypes } from '@inworld/runtime/graph';

/**
 * Manages a stream of audio chunks that can be fed asynchronously
 * as data arrives from websocket connections.
 *
 * This allows the graph to consume audio in a streaming fashion
 * rather than executing once per chunk.
 */

export class AudioStreamManager {
  private queue: GraphTypes.Audio[] = [];
  private waitingResolvers: Array<
    (value: IteratorResult<GraphTypes.Audio>) => void
  > = [];
  private ended = false;

  /**
   * Add an audio chunk to the stream
   */
  pushChunk(chunk: AudioChunkInterface): void {
    if (this.ended) {
      return;
    }

    // Create GraphTypes.Audio object matching framework expectations
    const audioData = new GraphTypes.Audio({
      data: Array.isArray(chunk.data) ? chunk.data : Array.from(chunk.data),
      sampleRate: chunk.sampleRate,
    });

    // If there are waiting consumers, resolve immediately
    if (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: audioData, done: false });
    } else {
      // Otherwise, queue the chunk
      this.queue.push(audioData);
    }
  }

  /**
   * Mark the stream as ended
   */
  end(): void {
    console.log('[AudioStreamManager] Ending stream');
    this.ended = true;
    // Resolve all waiting consumers with done: true
    while (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  /**
   * Create an async generator that consumes from this stream
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
        console.log('[AudioStreamManager] Stream ended, queue is empty');
        break;
      }

      // Wait for next chunk
      const result = await new Promise<IteratorResult<GraphTypes.Audio>>(
        (resolve) => {
          this.waitingResolvers.push(resolve);
        },
      );

      if (result.done) {
        console.log('[AudioStreamManager] Stream ended, result is done');
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
   * Get the number of queued chunks
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}
