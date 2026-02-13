import { TTS_SAMPLE_RATE } from '../constants/audio';

interface Audio {
  chunk: string;
}

interface QueueItem {
  audio: Audio;
}

export class Player {
  private audioPacketQueue: QueueItem[] = [];
  private isPlaying = false;
  private audioContext!: AudioContext;
  private gainNode!: GainNode;
  private nextStartTime = 0;
  private currentSources: AudioBufferSourceNode[] = [];

  async preparePlayer(): Promise<void> {
    // Initialize Web Audio API context
    this.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();

    // Create gain node for volume control and fading
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);

    // Reset timing
    this.nextStartTime = 0;
  }

  getIsPlaying(): boolean {
    // Check if we're processing the queue OR if there are active audio sources playing
    return this.isPlaying || this.currentSources.length > 0;
  }

  getQueueLength(): number {
    return this.audioPacketQueue.length;
  }

  stop() {
    // Stop all currently playing sources immediately
    this.currentSources.forEach((source) => {
      try {
        source.stop();
      } catch (e) {
        console.debug('Source already stopped', e);
      }
    });
    this.currentSources = [];

    // Clear queue completely - this ensures no more audio will be processed
    this.audioPacketQueue = [];

    // Reset state
    this.isPlaying = false;
    this.nextStartTime = 0;
  }

  async addToQueue(packet: QueueItem): Promise<void> {
    // Ensure audio context is initialized before adding to queue
    if (!this.audioContext) {
      await this.preparePlayer();
    }
    
    this.audioPacketQueue.push(packet);
    if (!this.isPlaying) {
      this.playQueue();
    }
  }

  clearQueue() {
    this.isPlaying = false;
    this.audioPacketQueue = [];
  }

  private playQueue = async (): Promise<void> => {
    if (!this.audioPacketQueue.length) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;

    // Process all queued packets
    while (this.audioPacketQueue.length > 0) {
      const currentPacket = this.audioPacketQueue.shift();
      if (!currentPacket) continue;

      try {
        await this.playAudioChunk(currentPacket.audio.chunk);
      } catch (error) {
        console.error('Error playing audio chunk:', error);
      }
    }

    this.isPlaying = false;
  };

  /**
   * Decode a base64 PCM16 chunk and schedule it for gapless playback.
   * Chunks from a continuous TTS stream share sample-level continuity,
   * so no per-chunk fade is applied -- that would introduce audible dips.
   */
  private async playAudioChunk(base64Chunk: string): Promise<void> {
    // Ensure audio context is initialized
    if (!this.audioContext) {
      await this.preparePlayer();
    }
    
    // Double-check after initialization
    if (!this.audioContext) {
      console.error('Failed to initialize AudioContext');
      return;
    }
    
    try {
      // Decode base64 → raw bytes
      const binaryString = atob(base64Chunk);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Interpret as PCM16 (Int16) and convert to Float32 for Web Audio API
      const int16Samples = new Int16Array(bytes.buffer);
      const numSamples = int16Samples.length;
      const numChannels = 1;

      const audioBuffer = this.audioContext.createBuffer(
        numChannels,
        numSamples,
        TTS_SAMPLE_RATE,
      );

      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = int16Samples[i] / 32768.0;
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.gainNode);

      // Schedule for gapless playback
      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(
        currentTime,
        this.nextStartTime > 0 ? this.nextStartTime : currentTime,
      );

      source.start(startTime);

      // Track source for cleanup
      this.currentSources.push(source);

      // Clean up when finished
      source.onended = () => {
        const index = this.currentSources.indexOf(source);
        if (index > -1) {
          this.currentSources.splice(index, 1);
        }
      };

      // Update next start time for seamless chaining
      this.nextStartTime = startTime + audioBuffer.duration;
    } catch (error) {
      console.error('Failed to decode/play audio chunk:', error);
    }
  }
}
