import { Graph } from '@inworld/runtime/graph';

import { CreateGraphPropsInterface } from '../types';
import { InworldGraphType, ISTTNode } from './app';

// Re-export for backward compatibility
export { InworldGraphType, ISTTNode };

/**
 * Interface for Inworld graph implementations.
 * Both AssemblyAI and Native graphs should implement this interface.
 */
export interface IInworldGraph {
  /**
   * The underlying runtime graph
   */
  graph: Graph | undefined;

  /**
   * @deprecated Use sttNode instead
   * AssemblyAI STT node (optional - only for AssemblyAI graph)
   */
  assemblyAINode?: ISTTNode;

  /**
   * The STT node used in this graph (optional - supports both AssemblyAI and Primitive nodes)
   */
  sttNode?: ISTTNode;

  /**
   * Destroy the graph and clean up resources
   */
  destroy(): Promise<void>;
}

/**
 * Factory function signature for creating Inworld graphs
 */
export interface IInworldGraphFactory {
  create(props: CreateGraphPropsInterface): Promise<IInworldGraph>;
}
