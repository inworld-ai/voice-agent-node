import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { ConnectionsMap, State } from '../../types';

/**
 * StateUpdateNode updates the state with the LLM's response.
 *
 * This node:
 * - Receives the LLM output text
 * - Updates the connection state with the assistant message
 * - Marks the interaction as completed in the datastore
 * - Returns the updated state
 */
export class StateUpdateNode extends CustomNode {
  private connections: ConnectionsMap;

  constructor(props: {
    id: string;
    connections: ConnectionsMap;
    reportToClient?: boolean;
  }) {
    super({
      id: props.id,
      reportToClient: props.reportToClient,
    });
    this.connections = props.connections;
  }

  process(context: ProcessContext, llmOutput: string): State {
    console.log('StateUpdateNode', { llmOutput });

    // TODO: Use this when DataStore will allow to modify state
    // const state = context.getDatastore().get('state') as State;
    // if (!state) {
    //   throw Error(`Failed to read state from dataStore`);
    // }
    // state.messages.push({
    //   role: 'assistant',
    //   content: llmOutput,
    //   id: state.messages.at(-1).id,
    // });
    // return state;

    // Get sessionId from dataStore (constant for graph execution)
    const sessionId = context.getDatastore().get('sessionId') as string;

    const connection = this.connections[sessionId];
    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId:${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId:${sessionId}`);
    }

    // Add assistant message with the same interactionId (already set by TextInputNode)
    connection.state.messages.push({
      role: 'assistant',
      content: llmOutput,
      id: connection.state.interactionId,
    });

    const dataStore = context.getDatastore();
    dataStore.add('c' + connection.state.interactionId, '');
    console.log(
      'StateUpdateNode: Marking interaction as completed',
      connection.state.interactionId,
    );

    return connection.state;
  }
}
