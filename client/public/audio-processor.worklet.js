// AudioWorklet processor for capturing microphone audio
// This runs in a separate audio rendering thread for optimal performance

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 1600; // 100ms chunks at 16kHz sample rate (aligns with setInterval timing in Chat.tsx)
    this.buffer = [];
    this.sampleCount = 0;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];

    // Only process if we have input
    if (input && input.length > 0) {
      const channelData = input[0]; // Get first channel (mono)

      // Add samples to buffer
      for (let i = 0; i < channelData.length; i++) {
        this.buffer.push(channelData[i]);
        this.sampleCount++;

        // When we've collected enough samples, send them to main thread
        if (this.sampleCount >= this.bufferSize) {
          // Send the buffered samples
          this.port.postMessage({
            samples: new Float32Array(this.buffer),
          });

          // Reset buffer
          this.buffer = [];
          this.sampleCount = 0;
        }
      }
    }

    // Return true to keep the processor alive
    return true;
  }
}

// Register the processor
registerProcessor('audio-capture-processor', AudioCaptureProcessor);
