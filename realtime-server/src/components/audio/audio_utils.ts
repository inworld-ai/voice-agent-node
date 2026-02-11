/**
 * Audio utility functions for converting between audio formats
 */
import logger from '../../logger';

/**
 * Convert PCM16 Buffer (Int16, -32768 to 32767) to Float32Array (-1.0 to 1.0)
 * @param pcm16Buffer - Raw bytes of 16-bit signed PCM
 * @returns Float32Array normalized to -1.0 to 1.0
 */
export function pcm16ToFloat32(pcm16Buffer: Buffer): Float32Array {
  const int16Array = new Int16Array(
    pcm16Buffer.buffer,
    pcm16Buffer.byteOffset,
    pcm16Buffer.length / 2,
  );
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  return float32Array;
}

/**
 * Downsample Float32 audio from 24kHz to 16kHz using linear interpolation (2:3 ratio).
 * @param float32Array - Input samples at 24kHz
 * @returns Float32Array at 16kHz
 */
export function resample24kTo16k(float32Array: Float32Array): Float32Array {
  const targetLength = Math.floor((float32Array.length * 2) / 3);
  const resampled = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const sourceIndex = i * 1.5;
    const index0 = Math.floor(sourceIndex);
    const index1 = Math.min(index0 + 1, float32Array.length - 1);
    const frac = sourceIndex - index0;
    resampled[i] = float32Array[index0] * (1 - frac) + float32Array[index1] * frac;
  }
  return resampled;
}

/**
 * Convert Float32Array (-1.0 to 1.0) to Int16Array PCM16 (-32768 to 32767)
 * @param float32Data - Input audio data as Float32Array
 * @returns Int16Array containing PCM16 audio data
 */
export function float32ToPCM16(float32Data: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    // Clamp values to [-1, 1] range
    const clamped = Math.max(-1, Math.min(1, float32Data[i]));
    // Convert to 16-bit PCM
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm16;
}

/**
 * Convert audio data to PCM16 base64 format for OpenAI Realtime API
 * @param audioData - Audio data in various formats (array, Buffer, Float32Array, base64 string)
 * @param sampleRate - Sample rate of the audio (for logging purposes)
 * @param debugLabel - Label for debug logging
 * @returns Base64 encoded PCM16 audio data, or null if conversion fails
 */
export function convertToPCM16Base64(audioData: any, sampleRate?: number, debugLabel: string = 'Audio'): string | null {
  if (!audioData) {
    logger.error({ debugLabel }, 'Audio Utils - No audio data provided');
    return null;
  }

  // Convert audio data to Float32Array based on its actual type
  let floatSamples: Float32Array;

  if (Array.isArray(audioData)) {
    // The array contains byte values from a Buffer, not float values
    // Interpret these bytes as Float32 data (4 bytes per float)
    // console.log(`[${debugLabel}] Converting byte array to Float32Array`);
    const byteBuffer = Buffer.from(audioData);
    floatSamples = new Float32Array(byteBuffer.buffer, byteBuffer.byteOffset, byteBuffer.length / 4);
  } else if (Buffer.isBuffer(audioData)) {
    // If it's already a Buffer
    logger.debug({ debugLabel }, 'Audio Utils - Converting Buffer to Float32Array');
    floatSamples = new Float32Array(audioData.buffer, audioData.byteOffset, audioData.length / 4);
  } else if (audioData instanceof Float32Array) {
    // Already Float32Array
    logger.debug({ debugLabel }, 'Audio Utils - Using existing Float32Array');
    floatSamples = audioData;
  } else if (typeof audioData === 'string') {
    // If it's a base64 string (legacy format)
    logger.debug({ debugLabel }, 'Audio Utils - Decoding base64 string to Float32Array');
    const decodedData = Buffer.from(audioData, 'base64');
    floatSamples = new Float32Array(decodedData.buffer, decodedData.byteOffset, decodedData.length / 4);
  } else {
    logger.error(
      { debugLabel, dataType: typeof audioData },
      `Audio Utils - Unsupported audio data type: ${typeof audioData}`,
    );
    return null;
  }

  // Validate Float32Array has data
  if (floatSamples.length === 0) {
    logger.warn({ debugLabel }, 'Audio Utils - Skipping zero-length audio samples');
    return null;
  }

  // Convert Float32 (-1.0 to 1.0) to PCM16 (-32768 to 32767)
  const pcm16 = float32ToPCM16(floatSamples);

  const audioBase64 = Buffer.from(pcm16.buffer).toString('base64');
  logger.debug({ debugLabel, length: audioBase64.length }, 'Audio Utils - Sending base64 audio');

  return audioBase64;
}
