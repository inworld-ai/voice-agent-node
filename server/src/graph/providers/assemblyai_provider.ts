import { Graph } from '@inworld/runtime/graph';

import type {
  GraphProvider,
  GraphProviderResult,
  GraphProviderSession,
} from '../graph_provider';

/**
 * AssemblyAI provider.
 *
 * @remarks
 * This provider keeps a single shared AssemblyAI graph instance and relies on a
 * connections map (keyed by sessionId) inside the AssemblyAI custom nodes.
 */
export class AssemblyAIProvider implements GraphProvider {
  constructor(private readonly createGraph: () => Promise<Graph>) {}

  private graph?: Graph;

  async getGraph(_session: GraphProviderSession): Promise<GraphProviderResult> {
    if (!this.graph) {
      this.graph = await this.createGraph();
    }
    return { graph: this.graph, kind: 'assemblyai' };
  }

  async destroySessionResources(_sessionId: string): Promise<void> {
    // Legacy AssemblyAI graph is shared across sessions in the old server.
  }
}
