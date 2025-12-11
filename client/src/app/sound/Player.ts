import { TTS_SAMPLE_RATE } from '../../../../constants';

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
  private fadeTime = 0.005; // 5ms crossfade to eliminate clicks

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
    return this.isPlaying;
  }

  getQueueLength(): number {
    return this.audioPacketQueue.length;
  }

  stop() {
    // Stop all currently playing sources
    this.currentSources.forEach((source) => {
      try {
        source.stop();
      } catch (e) {
        console.debug('Source already stopped', e);
      }
    });
    this.currentSources = [];

    // Clear queue and reset state
    this.audioPacketQueue = [];
    this.isPlaying = false;
    this.nextStartTime = 0;
  }

  addToQueue(packet: QueueItem): void {
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

  private async playAudioChunk(base64Chunk: string): Promise<void> {
    try {
      const binaryString = atob(base64Chunk);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert bytes to Float32Array (PCM Float32 samples)
      const float32Samples = new Float32Array(bytes.buffer);
      const numChannels = 1;
      const numSamples = float32Samples.length;

      // Create AudioBuffer directly from Float32Array samples
      const audioBuffer = this.audioContext.createBuffer(
        numChannels,
        numSamples,
        TTS_SAMPLE_RATE,
      );

      const channelData = audioBuffer.getChannelData(0);
      channelData.set(float32Samples);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Apply short fade-in to eliminate clicks at chunk boundaries
      const fadeGain = this.audioContext.createGain();
      fadeGain.connect(this.gainNode);
      source.connect(fadeGain);

      // Calculate timing for gapless playback
      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(
        currentTime,
        this.nextStartTime > 0 ? this.nextStartTime : currentTime,
      );

      // Apply fade-in at the start
      fadeGain.gain.setValueAtTime(0, startTime);
      fadeGain.gain.linearRampToValueAtTime(1, startTime + this.fadeTime);

      // Apply fade-out at the end
      const endTime = startTime + audioBuffer.duration;
      fadeGain.gain.setValueAtTime(1, endTime - this.fadeTime);
      fadeGain.gain.linearRampToValueAtTime(0, endTime);

      // Schedule playback
      source.start(startTime);
      source.stop(endTime);

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
      this.nextStartTime = endTime;
    } catch (error) {
      console.error('Failed to decode/play audio chunk:', error);
    }
  }
}
