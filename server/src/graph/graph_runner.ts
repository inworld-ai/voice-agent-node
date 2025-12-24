import { GraphTypes } from "@inworld/runtime/graph";
import { v4 } from "uuid";

import type { WSOutboundPacket } from "../../../contract";
import { MultimodalStream } from "../stream/multimodal_stream";

export interface GraphRunnerContext {
  sessionId: string;
  userApiKey: string;
  state: any;
}

export interface GraphRunnerGraph {
  graph: { start: Function; stop: Function };
}

/**
 * Runs a long-lived graph execution for a session and maps graph outputs to WS packets.
 */
export class GraphRunner {
  constructor(private send: (packet: WSOutboundPacket) => void) {}

  async run({
    ctx,
    stream,
    graphWrapper,
  }: {
    ctx: GraphRunnerContext;
    stream: MultimodalStream;
    graphWrapper: GraphRunnerGraph;
  }) {
    const multimodalStream = stream.createStream();
    const taggedStream = Object.assign(multimodalStream, {
      type: "MultimodalContent",
    });

    const { outputStream } = await graphWrapper.graph.start(taggedStream, {
      dataStoreContent: {
        sessionId: ctx.sessionId,
        state: ctx.state,
      },
      userCredentials: {
        inworld_api_key: ctx.userApiKey,
      },
    });

    let currentInteractionId: string = v4();

    for await (const result of outputStream as any) {
      if (result?.isGraphError?.()) {
        const errorData = result.data;
        const errorObj = new Error(
          errorData?.message || "Graph processing error"
        );
        this.send({
          type: "ERROR",
          error: errorObj.toString(),
          date: new Date(),
          packetId: { interactionId: currentInteractionId, utteranceId: v4() },
        });
        currentInteractionId = v4();
        continue;
      }

      const resolvedInteractionId = await this.processResult(
        result,
        currentInteractionId,
        ctx
      );

      if (resolvedInteractionId) {
        this.send({
          type: "INTERACTION_END",
          date: new Date(),
          packetId: { interactionId: resolvedInteractionId },
        });
      }

      currentInteractionId = v4();
    }
  }

  private async processResult(
    result: any,
    interactionId: string,
    ctx: GraphRunnerContext
  ): Promise<string> {
    await result.processResponse({
      TTSOutputStream: async (ttsStream: GraphTypes.TTSOutputStream) => {
        for await (const chunk of ttsStream) {
          const effectiveInteractionId = interactionId || v4();
          const utteranceId = v4();

          const audioBytes = Array.isArray(chunk.audio?.data)
            ? Buffer.from(chunk.audio.data)
            : undefined;
          if (audioBytes) {
            this.send({
              type: "AUDIO",
              audio: { chunk: audioBytes.toString("base64") },
              date: new Date(),
              packetId: { interactionId: effectiveInteractionId, utteranceId },
              routing: { source: this.buildAgentRoutingSource(ctx) },
            });
          }
          this.send({
            type: "TEXT",
            text: { text: chunk.text, final: true },
            date: new Date(),
            packetId: { interactionId: effectiveInteractionId, utteranceId },
            routing: { source: this.buildAgentRoutingSource(ctx) },
          });
        }
      },
      Custom: async (customData: GraphTypes.Custom<any>) => {
        // InteractionInfo from realtime agent native graph
        if (customData.type === "InteractionInfo") {
          const interactionData = (customData as any).data || customData;
          const text = interactionData.text;
          const interactionIdFromData =
            interactionData.interaction_id ?? interactionData.interactionId;
          const effectiveInteractionId =
            interactionIdFromData != null
              ? String(interactionIdFromData)
              : interactionId;

          if (interactionData.isInterrupted) {
            this.send({
              type: "CANCEL_RESPONSE",
              date: new Date(),
              packetId: { interactionId: effectiveInteractionId },
            });
          }

          if (text) {
            interactionId = effectiveInteractionId;
            this.send({
              type: "TEXT",
              text: { text, final: false },
              date: new Date(),
              packetId: { interactionId, utteranceId: v4() },
              routing: { source: this.buildUserRoutingSource(ctx) },
            });
          }
        }

        // Speech complete notifier (optional)
        if (customData.type === "SPEECH_COMPLETE") {
          const effectiveInteractionId =
            (customData as any).interactionId ||
            String((customData as any).iteration);
          this.send({
            type: "USER_SPEECH_COMPLETE",
            date: new Date(),
            packetId: { interactionId: effectiveInteractionId },
            metadata: {
              totalSamples: (customData as any).totalSamples,
              sampleRate: (customData as any).sampleRate,
              endpointingLatencyMs: (customData as any).endpointingLatencyMs,
              source: "VAD",
              iteration: (customData as any).iteration,
            },
          });
        }
      },
      error: async (error: GraphTypes.GraphError) => {
        this.send({
          type: "ERROR",
          error: new Error(error.message).toString(),
          date: new Date(),
          packetId: { interactionId: interactionId || v4() },
        });
      },
      default: (): void => undefined,
    });

    return interactionId;
  }

  private getAgentName(ctx: GraphRunnerContext): string {
    const agentName =
      ctx.state?.agent?.name?.trim() || ctx.state?.agent?.id?.trim();
    return agentName || "Assistant";
  }

  private getUserName(ctx: GraphRunnerContext): string {
    const userName = ctx.state?.userName?.trim();
    return userName || "User";
  }

  private buildAgentRoutingSource(ctx: GraphRunnerContext) {
    return {
      isAgent: true,
      name: this.getAgentName(ctx),
    };
  }

  private buildUserRoutingSource(ctx: GraphRunnerContext) {
    return {
      isUser: true,
      name: this.getUserName(ctx),
    };
  }
}
