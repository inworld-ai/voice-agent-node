import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import Groq, { toFile } from 'groq-sdk';
// @ts-ignore - wav-encoder doesn't have type definitions
import * as WavEncoder from 'wav-encoder';

/**
 * Configuration interface for GroqSTTNode
 */
export interface GroqSTTNodeConfig {
  /** Groq API key */
  apiKey: string;
  /** Sample rate of the audio stream in Hz */
  sampleRate?: number;
  /** Model to use for transcription */
  model?: string;
  /** Language code (e.g., 'en', 'es') */
  language?: string;
  /** Prompt to provide context or spelling guidance */
  prompt?: string;
  /** Temperature for the model (0.0 - 1.0) */
  temperature?: number;
  /** Response format ('json', 'text', 'verbose_json') */
  responseFormat?: string;
}

/**
 * GroqSTTNode processes audio using Groq's Whisper API.
 *
 * This node:
 * - Receives pre-extracted audio chunks from AudioExtractor/AudioNormalizer
 * - Converts audio to WAV format
 * - Sends audio to Groq Whisper API for transcription
 * - Returns transcribed text
 *
 * Note: This node works within the VAD-based pipeline and relies on
 * AudioStreamSlicer for turn detection. It simply replaces RemoteSTTNode.
 */
export class GroqSTTNode extends CustomNode {
  private groq: Groq;
  private sampleRate: number;
  private model: string;
  private language: string;
  private prompt: string;
  private temperature: number;
  private responseFormat: string;

  constructor(props: { id?: string; config: GroqSTTNodeConfig }) {
    const { config, ...nodeProps } = props;

    if (!config.apiKey) {
      throw new Error('GroqSTTNode requires an API key.');
    }

    super({
      id: nodeProps.id || 'groq-stt-node',
      executionConfig: {
        sampleRate: config.sampleRate || 16000,
        model: config.model || 'whisper-large-v3-turbo',
        language: config.language || 'en',
      },
    });

    this.groq = new Groq({ apiKey: config.apiKey });
    this.sampleRate = config.sampleRate || 16000;
    this.model = config.model || 'whisper-large-v3-turbo';
    this.language = config.language || 'en';
    this.prompt = config.prompt || '';
    this.temperature =
      config.temperature !== undefined ? config.temperature : 0.0;
    this.responseFormat = config.responseFormat || 'json';
  }

  /**
   * Process audio and transcribe using Groq Whisper API
   * This node receives audio data from the AudioNormalizer
   */
  async process(
    context: ProcessContext,
    audio: GraphTypes.Audio,
  ): Promise<string> {
    console.log('[Groq STT] Starting transcription');

    try {
      // Check if we have valid audio data
      if (!audio || !audio.data || audio.data.length === 0) {
        console.log('[Groq STT] Empty audio, returning empty string');
        return '';
      }

      console.log(
        `[Groq STT] Processing audio: ${audio.data.length} samples at ${audio.sampleRate}Hz`,
      );

      // Convert array to Float32Array if needed
      const audioData =
        audio.data instanceof Float32Array
          ? audio.data
          : new Float32Array(audio.data);

      // Convert to WAV format in memory (no file I/O needed)
      const encodeStartTime = Date.now();
      const wavBuffer = await this.encodeToWav(
        audioData,
        audio.sampleRate || this.sampleRate,
      );
      const encodeEndTime = Date.now();
      const encodingLatencyMs = encodeEndTime - encodeStartTime;
      console.log(
        `[Groq STT] WAV encoding latency: ${encodingLatencyMs}ms, size: ${(wavBuffer.length / 1024).toFixed(2)}KB`,
      );

      // Transcribe using Groq - pass buffer directly without file I/O
      console.log(`[Groq STT] Sending to Groq API (model: ${this.model})...`);
      const apiStartTime = Date.now();

      // Use Groq SDK's toFile utility to create a proper file object from buffer
      const audioFile = await toFile(wavBuffer, 'audio.wav', {
        type: 'audio/wav',
      });

      const transcription = await this.groq.audio.transcriptions.create({
        file: audioFile,
        model: this.model,
        language: this.language,
        prompt: this.prompt || undefined,
        response_format: this.responseFormat as any,
        temperature: this.temperature,
      });

      const apiEndTime = Date.now();
      const apiLatencyMs = apiEndTime - apiStartTime;
      const totalLatencyMs = apiEndTime - encodeStartTime;
      console.log(
        `[Groq STT] API call latency: ${apiLatencyMs}ms (total: ${totalLatencyMs}ms)`,
      );

      // Extract text based on response format
      let transcriptText = '';
      if (typeof transcription === 'string') {
        transcriptText = transcription;
      } else if (transcription && typeof transcription === 'object') {
        transcriptText = (transcription as any).text || '';
      }

      console.log(`[Groq STT] Transcription complete: "${transcriptText}"`);
      return transcriptText;
    } catch (error) {
      console.error('[Groq STT] Transcription failed:', error);
      throw error;
    }
  }

  /**
   * Encode audio data to WAV format in memory
   *
   * Note: WAV is used for optimal latency as recommended by Groq docs.
   * For future optimization, FLAC compression could reduce upload size:
   * - Lossless compression (smaller file size)
   * - May reduce network transfer time
   * - Trade-off: adds encoding overhead
   *
   * Groq preprocessing: Audio is downsampled to 16KHz mono server-side,
   * so we already use optimal format client-side (16KHz mono).
   */
  private async encodeToWav(
    audioData: Float32Array,
    sampleRate: number,
  ): Promise<Buffer> {
    // Encode to WAV format
    const audioBuffer = {
      sampleRate: sampleRate,
      channelData: [audioData], // Mono audio
    };

    const wavBuffer = await WavEncoder.encode(audioBuffer);

    return Buffer.from(wavBuffer);
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    console.log('[Groq STT] Destroying node');
    // No persistent connections to clean up
  }
}
