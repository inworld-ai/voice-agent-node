import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

/**
 * AudioExtractorNode extracts the completed audio from DataStreamWithMetadata.
 *
 * This node transforms DataStreamWithMetadata output into a plain Audio object by
 * extracting the completed_audio field from metadata. This is a simple transformation
 * node that unwraps the completed audio interaction from the AudioStreamSlicerNode output.
 */
export class AudioExtractorNode extends CustomNode<
  DataStreamWithMetadata,
  GraphTypes.Audio
> {
  constructor(props: { id?: string } = {}) {
    super({
      id: props.id || 'audio-extractor-node',
    });
  }

  /**
   * Process the DataStreamWithMetadata and extract the completed audio
   */
  async process(
    context: ProcessContext,
    input: DataStreamWithMetadata,
  ): Promise<GraphTypes.Audio> {
    const metadata = input.getMetadata();

    // Check if the metadata has a completed audio interaction
    if (!metadata.completed_audio) {
      throw new Error(
        'AudioExtractorNode received DataStreamWithMetadata without completed_audio in metadata',
      );
    }

    if (!metadata.interaction_complete) {
      throw new Error(
        'AudioExtractorNode received DataStreamWithMetadata with incomplete interaction',
      );
    }

    // Return the completed audio interaction
    return metadata.completed_audio as GraphTypes.Audio;
  }
}
