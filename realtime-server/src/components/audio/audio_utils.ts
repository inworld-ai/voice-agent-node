/**
 * Audio utility functions for converting between audio formats
 */
import * as fs from 'fs';
import * as path from 'path';

import logger from '../../logger';

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
 * Audio dumper for debugging purposes
 * Accumulates PCM16 audio chunks and writes them to a WAV file
 */
export class AudioDumper {
  private chunks: Int16Array[] = [];
  private totalSamples: number = 0;
  private readonly sampleRate: number;
  private readonly sessionId: string;
  private readonly label: string;
  private startTime: number = Date.now();

  constructor(sessionId: string, sampleRate: number = 16000, label: string = 'audio') {
    this.sessionId = sessionId;
    this.sampleRate = sampleRate;
    this.label = label;
    logger.info(
      { sessionId, sampleRate, label },
      `AudioDumper initialized for ${label} at ${sampleRate}Hz`,
    );
  }

  /**
   * Add a PCM16 audio chunk to the buffer
   */
  addChunk(pcm16Data: Int16Array): void {
    this.chunks.push(new Int16Array(pcm16Data)); // Make a copy to avoid reference issues
    this.totalSamples += pcm16Data.length;
  }

  /**
   * Write accumulated audio to a WAV file
   * @param outputDir - Directory to write the file to (defaults to ./audio_dumps)
   * @returns Path to the written file, or null if failed
   */
  async writeToFile(outputDir: string = './audio_dumps'): Promise<string | null> {
    if (this.chunks.length === 0) {
      logger.warn({ sessionId: this.sessionId }, 'AudioDumper - No audio chunks to write');
      return null;
    }

    try {
      // Create output directory if it doesn't exist
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${this.label}_${this.sessionId}_${timestamp}.wav`;
      const filepath = path.join(outputDir, filename);

      // Combine all chunks into a single array
      const allSamples = new Int16Array(this.totalSamples);
      let offset = 0;
      for (const chunk of this.chunks) {
        allSamples.set(chunk, offset);
        offset += chunk.length;
      }

      // Create WAV file buffer
      const wavBuffer = this.createWavBuffer(allSamples);

      // Write to file
      fs.writeFileSync(filepath, wavBuffer);

      const durationMs = Date.now() - this.startTime;
      const durationSeconds = this.totalSamples / this.sampleRate;

      logger.info(
        {
          sessionId: this.sessionId,
          filepath,
          chunks: this.chunks.length,
          samples: this.totalSamples,
          durationSeconds: durationSeconds.toFixed(2),
          recordingDurationMs: durationMs,
        },
        `AudioDumper - Wrote ${this.chunks.length} chunks (${durationSeconds.toFixed(2)}s) to ${filename}`,
      );

      return filepath;
    } catch (error) {
      logger.error(
        { err: error, sessionId: this.sessionId },
        'AudioDumper - Failed to write audio file',
      );
      return null;
    }
  }

  /**
   * Create a WAV file buffer from PCM16 samples
   */
  private createWavBuffer(samples: Int16Array): Buffer {
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const byteRate = (this.sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = samples.length * 2; // 2 bytes per sample

    // WAV file header (44 bytes)
    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4); // File size - 8
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
    header.writeUInt16LE(numChannels, 22); // NumChannels
    header.writeUInt32LE(this.sampleRate, 24); // SampleRate
    header.writeUInt32LE(byteRate, 28); // ByteRate
    header.writeUInt16LE(blockAlign, 32); // BlockAlign
    header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40); // Subchunk2Size

    // Combine header and audio data
    const audioBuffer = Buffer.from(samples.buffer);
    return Buffer.concat([header, audioBuffer]);
  }

  /**
   * Get statistics about accumulated audio
   */
  getStats(): { chunks: number; samples: number; durationSeconds: number } {
    return {
      chunks: this.chunks.length,
      samples: this.totalSamples,
      durationSeconds: this.totalSamples / this.sampleRate,
    };
  }

  /**
   * Clear accumulated chunks
   */
  clear(): void {
    this.chunks = [];
    this.totalSamples = 0;
    this.startTime = Date.now();
  }
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
