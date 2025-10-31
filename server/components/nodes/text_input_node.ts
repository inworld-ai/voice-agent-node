import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { ConnectionsMap, State, TextInput } from '../../types';

/**
 * TextInputNode updates the state with the user's input this turn.
 *
 * This node:
 * - Receives user text input with interaction and session IDs
 * - Updates the connection state with the user message
 * - Returns the updated state for downstream processing
 */
export class TextInputNode extends CustomNode {
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

  process(context: ProcessContext, input: TextInput): State {
    console.log('TextInputNode', { context, input });

    // TODO: Use this when DataStore will allow to modify state
    // const state = context.getDatastore().get('state') as State;
    // if (!state) {
    //   throw Error(`Failed to read state from dataStore`);
    // }
    // state.messages.push({
    //   role: 'user',
    //   content: text,
    //   id: interactionId,
    // });
    // return state;

    const { text, interactionId, sessionId } = input;

    const connection = this.connections[sessionId];
    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId:${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId:${sessionId}`);
    }
    const state = connection.state;
    if (!state) {
      throw Error(
        `Failed to read state from connection for sessionId:${sessionId}`,
      );
    }

    // Update interactionId and add user message
    connection.state.interactionId = interactionId;
    connection.state.messages.push({
      role: 'user',
      content: text,
      id: interactionId,
    });

    return connection.state;
  }
}
