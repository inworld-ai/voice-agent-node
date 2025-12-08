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

  process(context: ProcessContext, ...inputs: any[]): State {
    // Input: LLM output text (string)

    let llmOutput: string | undefined;

    for (const input of inputs) {
      const val = input?.value || input;
      if (!val) continue;

      // Check for string (LLM output)
      if (typeof val === 'string') {
        llmOutput = val;
        break; // Use the first string we find
      }
    }

    // Get sessionId from datastore
    const sessionId = context.getDatastore().get('sessionId') as string;
    if (!sessionId) {
      throw Error(`Failed to get sessionId`);
    }

    const connection = this.connections[sessionId];
    if (!connection) {
      throw Error(`Failed to get connection for sessionId:${sessionId}`);
    }

    // Read state from connection (persistent across executions)
    const state = connection.state;
    if (!state) {
      throw Error(`Failed to read state from connection`);
    }

    if (!llmOutput) {
      // Return current state if no LLM output
      return state;
    }

    // Add assistant message with the same interactionId (already set by TextInputNode)
    state.messages.push({
      role: 'assistant',
      content: llmOutput,
      id: state.interactionId,
    });

    // Mark interaction as completed in datastore (only used within this execution for interaction queue)
    const dataStore = context.getDatastore();
    dataStore.add('c' + state.interactionId, '');

    return state;
  }
}
