import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

import { ConnectionsMap } from '../../types';

/**
 * TTSRequestBuilderNode creates TTS requests with dynamic voice selection.
 *
 * This node:
 * - Receives text chunks from the LLM
 * - Reads the session's voiceId from connection state
 * - Creates a TTSRequest with the appropriate voice
 * - Allows voice selection per session without multiple graphs
 */
export class TTSRequestBuilderNode extends CustomNode {
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
    textStream: GraphTypes.TextStream,
  ): GraphTypes.TTSRequest {
    // Get sessionId from context
    const sessionId = context.getDatastore().get('sessionId') as string;
    
    // Get voice from session state
    const connection = this.connections[sessionId];
    const voiceId = connection?.state?.voiceId || 'Alex';

    console.log(`TTSRequestBuilder: Using voice ${voiceId} for session ${sessionId}`);

    // Create TTS request with dynamic voice
    return GraphTypes.TTSRequest.withStream(textStream, {
      speakerId: voiceId,
    });
  }
}

