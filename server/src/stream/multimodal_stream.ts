import { AudioChunkInterface } from '@inworld/runtime/common';
import { GraphTypes } from '@inworld/runtime/graph';

/**
 * Manages a stream of multimodal content (audio and/or text) that can be fed
 * asynchronously as data arrives from websocket connections.
 *
 * @remarks
 * This mirrors the legacy `MultimodalStreamManager` but is scoped to the new server.
 */
export class MultimodalStream {
  private queue: GraphTypes.MultimodalContent[] = [];
  private waitingResolvers: Array<
    (value: IteratorResult<GraphTypes.MultimodalContent>) => void
  > = [];
  private ended = false;

  pushAudio(chunk: AudioChunkInterface): void {
    if (this.ended) return;
    const audioData = new GraphTypes.Audio({
      data: Array.isArray(chunk.data) ? chunk.data : Array.from(chunk.data),
      sampleRate: chunk.sampleRate,
    });
    this.pushContent(new GraphTypes.MultimodalContent({ audio: audioData }));
  }

  pushText(text: string): void {
    if (this.ended) return;
    this.pushContent(new GraphTypes.MultimodalContent({ text }));
  }

  end(): void {
    this.ended = true;
    while (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  async *createStream(): AsyncIterableIterator<GraphTypes.MultimodalContent> {
    while (true) {
      if (this.ended && this.queue.length === 0) return;
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.ended) return;
      const result = await new Promise<
        IteratorResult<GraphTypes.MultimodalContent>
      >((resolve) => this.waitingResolvers.push(resolve));
      if (result.done) return;
      yield result.value;
    }
  }

  private pushContent(content: GraphTypes.MultimodalContent): void {
    if (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: content, done: false });
    } else {
      this.queue.push(content);
    }
  }
}
