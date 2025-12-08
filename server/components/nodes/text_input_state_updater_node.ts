import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

import { ConnectionsMap, State, TextInput } from '../../types';

/**
 * TextInputStateUpdaterNode updates the connection state with the user message.
 *
 * This node:
 * - Receives TextInput
 * - Updates the connection state with the user message and interactionId
 * - Returns State (reports to client)
 */
export class TextInputStateUpdaterNode extends CustomNode {
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

  process(
    context: ProcessContext,
    textInput: TextInput,
  ): State {
    const { text, interactionId, sessionId } = textInput;

    // Get connection - this is the persistent source of truth
    const connection = this.connections[sessionId];
    if (!connection) {
      throw Error(`Failed to get connection for sessionId:${sessionId}`);
    }

    // Read state from connection (persistent across executions)
    const state = connection.state;
    if (!state) {
      throw Error(
        `Failed to read state from connection for sessionId:${sessionId}`,
      );
    }

    // Update interactionId and add user message
    state.interactionId = interactionId;
    state.messages.push({
      role: 'user',
      content: text,
      id: interactionId,
    });

    // Return state (will be reported to client)
    return state;
  }
}

