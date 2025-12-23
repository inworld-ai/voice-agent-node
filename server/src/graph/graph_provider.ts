import type { Graph } from '@inworld/runtime/graph';

export type GraphKind = 'realtime';

export interface GraphProviderResult {
  graph: Graph;
  kind: GraphKind;
}

export interface GraphProviderSession {
  sessionId: string;
  sttService: 'native';
  state: any;
}

export interface GraphProvider {
  getGraph(session: GraphProviderSession): Promise<GraphProviderResult>;
  destroySessionResources(sessionId: string): Promise<void>;
}
