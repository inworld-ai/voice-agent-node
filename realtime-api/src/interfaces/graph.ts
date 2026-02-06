import { Graph } from '@inworld/runtime/graph';

import { CreateGraphPropsInterface } from '../types';
import { IAssemblyAINode } from './app';

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
   * AssemblyAI STT node (optional - only for AssemblyAI graph)
   */
  assemblyAINode?: IAssemblyAINode;

  /**
   * Destroy the graph and clean up resources
   */
  destroy(): Promise<void>;
}

/**
 * Available Inworld graph types
 */
export type InworldGraphType = 'assemblyai' | 'native';

/**
 * Factory function signature for creating Inworld graphs
 */
export interface IInworldGraphFactory {
  create(props: CreateGraphPropsInterface): Promise<IInworldGraph>;
}
