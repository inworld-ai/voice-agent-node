import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { InteractionInfo } from '../../types';

/**
 * InteractionInfoNode joins STT result (or text input) with stream metadata.
 *
 * This node:
 * - Receives transcribed text from STT (audio path) OR text stream (text path)
 * - Receives stream metadata from the slicer or STT node
 * - Combines them into an InteractionInfo object
 * - Extracts interaction ID from stream metadata
 * - Returns structured interaction information for queue processing
 *
 * Supports multiple input paths:
 * - Audio (Inworld): STT node provides text string + slicer provides metadata
 * - Text (Inworld): Slicer provides text in metadata.text_content
 * - Audio/Text (AssemblyAI): AssemblyAI node provides transcript in metadata.transcript or metadata.text_content
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
    streamWithMetadata: DataStreamWithMetadata,
    recognizedText?: string,
  ): InteractionInfo {
    const sessionId = context.getDatastore().get('sessionId') as string;
    console.log('InteractionInfoNode with recognizedText: ', recognizedText);
    console.log(
      'InteractionInfoNode with streamWithMetadata: ',
      streamWithMetadata,
    );

    const metadata = streamWithMetadata.getMetadata();

    // Use recognizedText if provided (from STT or TextExtractor nodes)
    if (recognizedText) {
      return {
        type: 'InteractionInfo',
        data: {
          sessionId,
          interactionId: String(
            metadata.interactionId || metadata.iteration || 1,
          ),
          text: recognizedText,
          isInterrupted: !this.disableAutoInterruption,
        },
      };
    }

    // Otherwise extract text from metadata
    // Check both text_content (from MultimodalSlicer) and transcript (from AssemblyAI)
    const text = String(metadata.text_content || metadata.transcript || '');

    console.log('InteractionInfoNode with text: ', text);

    return {
      type: 'InteractionInfo',
      data: {
        sessionId,
        interactionId: String(metadata.interactionId),
        text: text,
        isInterrupted: !this.disableAutoInterruption,
      },
    };
  }
}
