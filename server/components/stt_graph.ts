import { Graph, GraphBuilder, RemoteSTTNode } from '@inworld/runtime/graph';

/**
 * A simple wrapper for a dedicated STT graph
 * This graph contains only an STT node and processes audio streams
 */
export class STTGraphWrapper {
  graph: Graph;

  private constructor({ graph }: { graph: Graph }) {
    this.graph = graph;
  }

  /**
   * Create a new STT graph with a single STT node
   */
  static async create(props: { apiKey: string }): Promise<STTGraphWrapper> {
    const { apiKey } = props;

    // Create STT node with default configuration
    const sttNode = new RemoteSTTNode({
      id: 'stt-node',
      sttConfig: {},
    });

    // Build a simple graph with just the STT node
    const graphBuilder = new GraphBuilder({
      id: 'stt-graph',
      apiKey,
      enableRemoteConfig: false,
    });

    graphBuilder.addNode(sttNode).setStartNode(sttNode).setEndNode(sttNode);

    const graph = graphBuilder.build();

    return new STTGraphWrapper({ graph });
  }
}
