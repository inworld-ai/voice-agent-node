import {
  FRAME_PER_BUFFER,
  INPUT_SAMPLE_RATE,
  MIN_SPEECH_DURATION_MS,
  PAUSE_DURATION_THRESHOLD_MS,
  PRE_ROLL_MS,
  SPEECH_THRESHOLD,
} from '../../constants';

export interface AudioHandlerCallbacks {
  onNewInteractionRequested: () => string;
  onSpeechCaptured: (sessionId: string, speechBuffer: number[]) => void;
}

export class AudioHandler {
  private INPUT_SAMPLE_RATE = INPUT_SAMPLE_RATE;
  private FRAME_PER_BUFFER = FRAME_PER_BUFFER;
  private PAUSE_DURATION_THRESHOLD_MS = PAUSE_DURATION_THRESHOLD_MS;
  private MIN_SPEECH_DURATION_SAMPLES = Math.floor(
    (MIN_SPEECH_DURATION_MS * INPUT_SAMPLE_RATE) / 1000,
  );
  private PRE_ROLL_MAX_SAMPLES = Math.floor(
    (this.INPUT_SAMPLE_RATE * PRE_ROLL_MS) / 1000,
  );

  private pauseDuration = 0;
  private isCapturingSpeech = false;
  private speechBuffer: number[] = [];

  // Keep track of the audio buffer until the frame size is reached for VAD.
  private audioBuffer: any[] = [];
  // Keep track of the pre-roll buffer to avoid clipping the onset of the speech.
  private preRollBuffer: number[];

  // Keep track to avoid creating multiple interactions for the same continuous user speech.
  private currentAudioInteractionRegistered: boolean = false;

  constructor(
    private vadClient: any,
    private callbacks: AudioHandlerCallbacks,
  ) {
    this.initializePreRollWithSilence();
  }

  private initializePreRollWithSilence(): void {
    this.preRollBuffer = new Array(this.PRE_ROLL_MAX_SAMPLES).fill(0);
  }

  async processAudioChunk(message: any, sessionId: string) {
    // Add audio chunks to the audio buffer until the frame size is reached for VAD.
    for (let i = 0; i < message.audio.length; i++) {
      Object.values(message.audio[i]).forEach((value) => {
        this.audioBuffer.push(value);
      });
    }

    if (this.audioBuffer.length < this.FRAME_PER_BUFFER) {
      return;
    }

    const audioChunk = {
      data: this.audioBuffer,
      sampleRate: this.INPUT_SAMPLE_RATE,
    };
    this.audioBuffer = [];

    const vadResult = await this.vadClient.detectVoiceActivity(
      audioChunk,
      SPEECH_THRESHOLD,
    );

    if (this.isCapturingSpeech) {
      this.speechBuffer.push(...audioChunk.data);

      let speechDetected = false;
      if (
        this.speechBuffer.length >
        this.MIN_SPEECH_DURATION_SAMPLES + this.PRE_ROLL_MAX_SAMPLES
      ) {
        speechDetected = true;

        // If speech is detected, create a new interaction if not already created.
        if (!this.currentAudioInteractionRegistered) {
          this.callbacks.onNewInteractionRequested();
          this.currentAudioInteractionRegistered = true;
        }
      }

      if (vadResult === -1) {
        // Already capturing speech but new chunk has no voice activity.
        this.pauseDuration +=
          (audioChunk.data.length * 1000) / this.INPUT_SAMPLE_RATE;

        // If the pause duration is greater than the threshold, stop capturing speech.
        if (this.pauseDuration > this.PAUSE_DURATION_THRESHOLD_MS) {
          this.isCapturingSpeech = false;

          // If speech is detected, capture the speech.
          if (speechDetected) {
            this.currentAudioInteractionRegistered = false;
            this.callbacks.onSpeechCaptured(
              sessionId,
              [...this.speechBuffer], // Create a copy
            );
            this.speechBuffer = [];
          }
        }
      } else {
        // Already capturing speech and new chunk has voice activity
        this.pauseDuration = 0;
      }
    } else {
      if (vadResult !== -1) {
        // Not capturing speech but new chunk has voice activity.
        // Start capturing and prepend pre-roll to avoid clipped onset
        this.isCapturingSpeech = true;
        this.speechBuffer.push(...this.preRollBuffer);
        this.initializePreRollWithSilence();
        this.speechBuffer.push(...audioChunk.data);
        this.pauseDuration = 0;
      } else {
        // Not capturing speech and new chunk has no voice activity.
        // Maintain pre-roll while idle - replace oldest samples with new ones
        this.preRollBuffer.splice(0, audioChunk.data.length);
        this.preRollBuffer.push(...audioChunk.data);
      }
    }
  }

  endAudioSession(sessionId: string): void {
    this.pauseDuration = 0;
    this.isCapturingSpeech = false;
    this.currentAudioInteractionRegistered = false;
    // Reinitialize with silence instead of empty array
    this.initializePreRollWithSilence();

    if (this.speechBuffer.length > 0) {
      this.callbacks.onSpeechCaptured(
        sessionId,
        [...this.speechBuffer], // Create a copy
      );
      this.speechBuffer = [];
    }
  }

  normalizeAudio(audioBuffer: number[]): number[] {
    let maxVal = 0;
    // Find maximum absolute value
    for (let i = 0; i < audioBuffer.length; i++) {
      maxVal = Math.max(maxVal, Math.abs(audioBuffer[i]));
    }

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
