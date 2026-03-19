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
   * Normalize audio buffer by finding max absolute value and dividing all samples.
   * Audio data is stored as float32 samples in a Buffer.
   */
  private normalizeAudio(audioBuffer: Buffer): Buffer {
    const float32 = new Float32Array(
      audioBuffer.buffer,
      audioBuffer.byteOffset,
      audioBuffer.byteLength / 4,
    );

    let maxVal = 0;
    for (let i = 0; i < float32.length; i++) {
      maxVal = Math.max(maxVal, Math.abs(float32[i]));
    }

    if (maxVal === 0) {
      return audioBuffer;
    }

    const normalized = new Float32Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      normalized[i] = float32[i] / maxVal;
    }

    return Buffer.from(normalized.buffer);
  }
}
