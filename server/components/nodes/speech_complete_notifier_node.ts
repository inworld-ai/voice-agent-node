import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

/**
 * SpeechCompleteNotifierNode monitors audio processing nodes (AudioStreamSlicerNode
 * or AssemblyAISTTWebSocketNode) and reports a notification event to the client
 * when user speech is complete.
 *
 * This is a terminal reporting node with no outgoing edges. It extracts metadata
 * from the DataStreamWithMetadata output and creates a SpeechCompleteEvent for
 * the client. This enables accurate latency tracking by providing silence duration
 * that should be excluded from processing time calculations.
 *
 * The audio processing pipeline continues separately via a parallel edge from
 * the STT node to the next processing node.
 */
export class SpeechCompleteNotifierNode extends CustomNode<
  DataStreamWithMetadata,
  SpeechCompleteEvent
> {
  constructor(props: { id?: string } = {}) {
    super({
      id: props.id || 'speech-complete-notifier-node',
      reportToClient: true, // This node reports events to client
    });
  }

  /**
   * Process DataStreamWithMetadata from AudioStreamSlicerNode
   * and create a speech completion notification event
   */
  async process(
    context: ProcessContext,
    input: DataStreamWithMetadata,
  ): Promise<SpeechCompleteEvent> {
    const metadata = input.getMetadata();
    const sessionId = context.getDatastore().get('sessionId') as string;
    const iteration = (metadata.iteration as number) || 0;

    // Get interactionId from metadata (compound ID like "abc123#1"), fallback to iteration
    const interactionId =
      (metadata.interactionId as string) || String(iteration);

    // Handle both field names for compatibility (total_samples for VAD, total_audio_samples for AssemblyAI)
    const totalSamples =
      (metadata.total_audio_samples as number) ||
      (metadata.total_samples as number) ||
      0;

    console.log(
      `[SpeechCompleteNotifier] User speech complete - Session: ${sessionId}, ` +
        `InteractionId: ${interactionId}, Iteration: ${iteration}, Samples: ${totalSamples}, Latency: ${metadata.endpointing_latency_ms}ms`,
    );

    // Create and return the notification event for the client
    return {
      type: 'SPEECH_COMPLETE',
      sessionId,
      interactionId,
      iteration,
      totalSamples,
      sampleRate: metadata.sample_rate as number,
      endpointingLatencyMs: metadata.endpointing_latency_ms as number,
      speechDetected: metadata.speech_detected as boolean,
    };
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }
}

/**
 * Event emitted when user speech is complete (detected via VAD or Assembly.AI turn detection)
 * This event is reported to the client for latency tracking purposes. The endpointingLatencyMs
 * represents the time taken to detect that the user has finished speaking, and is included
 * in overall latency measurements and logged for analysis/debugging.
 */
export interface SpeechCompleteEvent {
  type: 'SPEECH_COMPLETE';
  sessionId: string;
  interactionId: string;
  iteration: number;
  totalSamples: number;
  sampleRate: number;
  endpointingLatencyMs: number;
  speechDetected: boolean;
}
