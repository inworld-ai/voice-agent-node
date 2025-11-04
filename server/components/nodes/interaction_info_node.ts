import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { InteractionInfo } from '../../types';

/**
 * InteractionInfoNode joins STT result with stream metadata.
 *
 * This node:
 * - Receives transcribed text and audio stream metadata
 * - Combines them into an InteractionInfo object
 * - Extracts interaction ID from stream metadata
 * - Returns structured interaction information for queue processing
 */
export class InteractionInfoNode extends CustomNode {
  private disableAutoInterruption: boolean;

  constructor(props: {
    id: string;
    disableAutoInterruption?: boolean;
    reportToClient?: boolean;
  }) {
    super({
      id: props.id,
      reportToClient: props.reportToClient,
    });
    this.disableAutoInterruption = props.disableAutoInterruption || false;
  }

  process(
    context: ProcessContext,
    text: string,
    streamWithMetadata: DataStreamWithMetadata,
  ): InteractionInfo {
    console.log('InteractionInfoNode with text: ', text);

    const sessionId = context.getDatastore().get('sessionId') as string;
    const metadata = streamWithMetadata.getMetadata();

    return {
      sessionId,
      interactionId: String(metadata.interactionId || metadata.iteration || 1),
      text: text,
      isInterrupted: !this.disableAutoInterruption,
    };
  }
}
