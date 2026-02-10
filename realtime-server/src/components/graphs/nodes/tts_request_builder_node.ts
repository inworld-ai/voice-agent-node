import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

import { TTS_SAMPLE_RATE } from '../../../config';
import logger from '../../../logger';
import { ConnectionsMap } from '../../../types/index';

/**
 * TTSRequestBuilderNode builds a TTSRequest with dynamic voiceId and modelId.
 * For long-running graphs, it reads voiceId and ttsModelId from connection state at processing time
 * to ensure changes via session.update are reflected immediately.
 */
export class TTSRequestBuilderNode extends CustomNode {
  private connections: ConnectionsMap;
  private defaultVoiceId: string;
  private defaultTtsModelId: string;

  constructor(props: {
    id: string;
    connections: ConnectionsMap;
    defaultVoiceId: string;
    defaultTtsModelId: string;
    reportToClient?: boolean;
  }) {
    super({
      id: props.id,
      reportToClient: props.reportToClient,
    });
    this.connections = props.connections;
    this.defaultVoiceId = props.defaultVoiceId;
    this.defaultTtsModelId = props.defaultTtsModelId;
  }

  /**
   * Build a TTSRequest with the current voiceId and ttsModelId from connection state
   * Receives two inputs:
   * 1. input - Graph input with sessionId (TextInput or State)
   * 2. textStream - The text stream from TextChunkingNode
   */
  process(context: ProcessContext, input: any, textStream: GraphTypes.TextStream): GraphTypes.TTSRequest {
    const sessionId = context.getDatastore().get('sessionId') as string;

    // For long-running graphs, read voiceId and ttsModelId from connection state at processing time
    // This ensures changes via session.update are immediately reflected
    const connection = this.connections[sessionId];
    const voiceId = connection?.state?.voiceId || input?.voiceId || this.defaultVoiceId;
    const ttsModelId = connection?.state?.ttsModelId || this.defaultTtsModelId;

    logger.debug(
      {
        sessionId,
        voiceId,
        ttsModelId,
        connectionVoiceId: connection?.state?.voiceId,
        connectionTtsModelId: connection?.state?.ttsModelId,
        inputVoiceId: input?.voiceId,
        defaultVoiceId: this.defaultVoiceId,
        defaultTtsModelId: this.defaultTtsModelId,
      },
      `TTSRequestBuilder building request [voice:${voiceId}] [model:${ttsModelId}]`,
    );

    return GraphTypes.TTSRequest.withStream(
      textStream,
      {
        id: voiceId,
      },
      {
        modelId: ttsModelId,
        postprocessing: {
          sampleRate: TTS_SAMPLE_RATE,
        },
        inference: {
          temperature: 1.1,
          speakingRate: 1,
        },
        timestampType: undefined,
      },
    );
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }
}
