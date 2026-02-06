import { Graph } from '@inworld/runtime/graph';

import { IInworldGraph } from '../../../interfaces/graph';
import logger from '../../../logger';
import { CreateGraphPropsInterface } from '../../../types/index';

/**
 * Inworld Realtime Graph implementation using native/built-in STT.
 * This is a stub implementation for future development.
 *
 * TODO: Implement native STT integration when available.
 */
export class InworldRealtimeNativeGraph implements IInworldGraph {
  graph: Graph | undefined;
  // No assemblyAINode - native implementation will use different STT

  private constructor({ graph }: { graph?: Graph }) {
    this.graph = graph;
  }

  async destroy(): Promise<void> {
    if (!this.graph) {
      logger.warn('InworldRealtimeNativeGraph.destroy() called but graph is undefined - skipping stop');
      return;
    }
    await this.graph.stop();
  }

  /**
   * Factory method to create the native graph.
   * Currently throws an error as this is a stub implementation.
   */
  static async create(_props: CreateGraphPropsInterface): Promise<InworldRealtimeNativeGraph> {
    // Stub implementation - throw error until native STT is implemented
    throw new Error(
      'InworldRealtimeNativeGraph is not yet implemented. ' +
        'Please use INWORLD_GRAPH_TYPE=assemblyai (default) instead.',
    );
  }
}
