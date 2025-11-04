import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { InteractionInfo } from '../../types';

/**
 * TranscriptExtractorNode extracts transcript information from
 * DataStreamWithMetadata (typically output from AssemblyAISTTNode)
 * and converts it to InteractionInfo for downstream processing.
 *
 * This is a helper node to bridge Assembly.AI STT output with
 * the rest of the graph that expects InteractionInfo.
 */
export class TranscriptExtractorNode extends CustomNode {
  private disableAutoInterruption: boolean;

  constructor(props?: {
    id?: string;
    reportToClient?: boolean;
    disableAutoInterruption?: boolean;
  }) {
    super({
      id: props?.id || 'transcript-extractor-node',
      reportToClient: props?.reportToClient,
    });
    this.disableAutoInterruption = props?.disableAutoInterruption ?? false;
  }

  /**
   * Extract transcript from metadata and return as InteractionInfo
   */
  process(
    context: ProcessContext,
    streamWithMetadata: DataStreamWithMetadata,
  ): InteractionInfo {
    const metadata = streamWithMetadata.getMetadata();
    const sessionId = context.getDatastore().get('sessionId') as string;

    // Extract transcript and related info from metadata
    const transcript = (metadata.transcript as string) || '';
    const interactionComplete =
      (metadata.interaction_complete as boolean) || false;
    const iteration = (metadata.iteration as number) || 1;
    const interactionId = String(metadata.interactionId || iteration);

    console.log(
      `[TranscriptExtractor] Session: ${sessionId}, InteractionId: ${interactionId}, Iteration: ${iteration}, ` +
        `Complete: ${interactionComplete}, Transcript: "${transcript}"`,
    );

    // Return InteractionInfo
    // Set isInterrupted based on auto-interruption config (matches InteractionInfoNode behavior)
    return {
      sessionId,
      interactionId: interactionId,
      text: transcript,
      isInterrupted: !this.disableAutoInterruption,
    };
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }
}
