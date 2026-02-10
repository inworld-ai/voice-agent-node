import { IInworldGraph, InworldGraphType } from '../../interfaces/graph';
import { CreateGraphPropsInterface } from '../../types';
import { InworldRealtimeAssemblyAIGraph } from './assemblyai';
import { InworldRealtimeNativeGraph } from './native';

/**
 * Factory function to create the appropriate Inworld graph based on graph type.
 *
 * @param graphType - The type of graph to create ('assemblyai' or 'native')
 * @param props - Configuration for the graph
 * @returns A Promise resolving to an IInworldGraph instance
 */
export function createInworldGraph(
  graphType: InworldGraphType,
  props: CreateGraphPropsInterface,
): Promise<IInworldGraph> {
  switch (graphType) {
    case 'assemblyai':
      return InworldRealtimeAssemblyAIGraph.create(props);
    case 'native':
      return InworldRealtimeNativeGraph.create(props);
    default:
      throw new Error(`Unknown Inworld graph type: ${graphType}. Valid types are: 'assemblyai', 'native'`);
  }
}

/**
 * Parse Inworld graph type from string with validation.
 *
 * @param value - The string value to parse
 * @param defaultValue - Default value if not provided (defaults to 'assemblyai')
 * @returns A valid InworldGraphType
 */
export function parseInworldGraphType(
  value: string | undefined,
  defaultValue: InworldGraphType = 'assemblyai',
): InworldGraphType {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.toLowerCase().trim();
  if (normalized === 'assemblyai' || normalized === 'native') {
    return normalized;
  }

  throw new Error(`Invalid INWORLD_GRAPH_TYPE: '${value}'. Valid types are: 'assemblyai', 'native'`);
}
