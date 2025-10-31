import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

/**
 * AudioNormalizerNode normalizes audio data to ensure consistent volume levels.
 *
 * This node normalizes audio to the range [-1.0, 1.0] by finding the maximum
 * absolute value and dividing all samples by it. This ensures consistent input
 * to STT regardless of microphone volume levels.
 *
 * Note: Normalization should happen AFTER VAD to avoid amplifying quiet ambient
 * sounds that could trigger false positives.
 */
export class AudioNormalizerNode extends CustomNode<
  GraphTypes.Audio,
  GraphTypes.Audio
> {
  constructor(props: { id?: string } = {}) {
    super({
      id: props.id || 'audio-normalizer-node',
    });
  }

  /**
   * Normalize the audio data to [-1.0, 1.0] range
   */
  async process(
    context: ProcessContext,
    audio: GraphTypes.Audio,
  ): Promise<GraphTypes.Audio> {
    const normalizedData = this.normalizeAudio(audio.data);

    return new GraphTypes.Audio({
      data: normalizedData,
      sampleRate: audio.sampleRate,
    });
  }

  /**
   * Normalize audio buffer by finding max absolute value and dividing all samples
   */
  private normalizeAudio(audioBuffer: number[]): number[] {
    let maxVal = 0;

    // Find maximum absolute value
    for (let i = 0; i < audioBuffer.length; i++) {
      maxVal = Math.max(maxVal, Math.abs(audioBuffer[i]));
    }

    // If all samples are zero, return as-is
    if (maxVal === 0) {
      return audioBuffer;
    }

    // Create normalized copy
    const normalizedBuffer = [];
    for (let i = 0; i < audioBuffer.length; i++) {
      normalizedBuffer.push(audioBuffer[i] / maxVal);
    }

    return normalizedBuffer;
  }
}
