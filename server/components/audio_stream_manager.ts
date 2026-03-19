import { GraphTypes } from '@inworld/runtime/graph';
import { AudioChunk } from '@inworld/runtime/primitives/speech';

/**
 * Manages a stream of audio chunks (wrapped as MultimodalContent) that can be
 * fed asynchronously as data arrives from websocket connections.
 *
 * This allows the graph to consume audio in a streaming fashion
 * rather than executing once per chunk.
 */
export class AudioStreamManager {
  private queue: GraphTypes.MultimodalContent[] = [];
  private waitingResolvers: Array<
    (value: IteratorResult<GraphTypes.MultimodalContent>) => void
  > = [];
  private ended = false;

  /**
   * Add an audio chunk to the stream (wrapped in MultimodalContent)
   */
  pushChunk(chunk: AudioChunk): void {
    if (this.ended) {
      return;
    }

    const content = new GraphTypes.MultimodalContent(
      new GraphTypes.Audio({
        data: Buffer.isBuffer(chunk.data)
          ? chunk.data
          : Buffer.from(chunk.data),
        sampleRate: chunk.sampleRate,
      }),
    );

    if (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: content, done: false });
    } else {
      this.queue.push(content);
    }
  }

  /**
   * Mark the stream as ended
   */
  end(): void {
    console.log('[AudioStreamManager] Ending stream');
    this.ended = true;
    while (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  /**
   * Create an async iterator that consumes from this stream
   */
  async *createStream(): AsyncIterableIterator<GraphTypes.MultimodalContent> {
    while (true) {
      if (this.queue.length > 0) {
        const content = this.queue.shift()!;
        yield content;
        continue;
      }

      if (this.ended) {
        console.log('[AudioStreamManager] Stream ended, queue is empty');
        break;
      }

      const result = await new Promise<
        IteratorResult<GraphTypes.MultimodalContent>
      >((resolve) => {
        this.waitingResolvers.push(resolve);
      });

      if (result.done) {
        console.log('[AudioStreamManager] Stream ended, result is done');
        break;
      }

      yield result.value;
    }
  }

  isEnded(): boolean {
    return this.ended;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
