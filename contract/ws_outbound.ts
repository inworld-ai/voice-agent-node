/**
 * WebSocket packets sent from the server to the client.
 *
 * @remarks
 * This is based on the existing `EventFactory` payloads and what the client
 * currently handles in `client/src/App.tsx`.
 */
export type WSOutboundPacket =
  | TextPacket
  | AudioPacket
  | InteractionEndPacket
  | CancelResponsePacket
  | UserSpeechCompletePacket
  | ErrorPacket;

export interface PacketId {
  interactionId: string;
  utteranceId?: string;
}

export interface Routing {
  source?: {
    isAgent?: boolean;
    isUser?: boolean;
    name?: string;
  };
}

export interface TextPacket {
  type: 'TEXT';
  text: { text: string; final: boolean };
  date: Date | string;
  packetId: PacketId & { utteranceId: string };
  routing?: Routing;
}

export interface AudioPacket {
  type: 'AUDIO';
  audio: { chunk: string };
  date: Date | string;
  packetId: PacketId & { utteranceId: string };
  routing?: Routing;
}

export interface InteractionEndPacket {
  type: 'INTERACTION_END';
  date: Date | string;
  packetId: PacketId;
  routing?: Routing;
}

export interface CancelResponsePacket {
  type: 'CANCEL_RESPONSE';
  date: Date | string;
  packetId: PacketId;
}

export interface UserSpeechCompletePacket {
  type: 'USER_SPEECH_COMPLETE';
  date: Date | string;
  packetId: PacketId;
  metadata?: any;
}

export interface ErrorPacket {
  type: 'ERROR';
  error: string;
  date: Date | string;
  packetId: PacketId;
}
