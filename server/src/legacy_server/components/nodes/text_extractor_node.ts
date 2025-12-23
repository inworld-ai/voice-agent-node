import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

/**
 * TextExtractorNode extracts the text content from DataStreamWithMetadata.
 *
 * This node transforms DataStreamWithMetadata output into a plain string by
 * extracting the text_content field from metadata. This is a simple transformation
 * node that unwraps the text content from the MultimodalStreamSlicerNode output.
 */
export class TextExtractorNode extends CustomNode<
  DataStreamWithMetadata,
  string
> {
  constructor(props: { id?: string } = {}) {
    super({
      id: props.id || 'text-extractor-node',
    });
  }

  /**
   * Process the DataStreamWithMetadata and extract the text content
   */
  async process(
    context: ProcessContext,
    input: DataStreamWithMetadata,
  ): Promise<string> {
    const metadata = input.getMetadata();

    // Check if the metadata has text content
    if (!metadata.text_content) {
      throw new Error(
        'TextExtractorNode received DataStreamWithMetadata without text_content in metadata',
      );
    }

    // Return the text content
    return metadata.text_content as string;
  }
}
