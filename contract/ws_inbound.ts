/**
 * WebSocket messages sent from the client to the server.
 */
export type WSInboundMessage =
  | TextInbound
  | AudioInbound
  | AudioSessionEndInbound;

export interface TextInbound {
  type: 'text' | 'TEXT';
  text: string;
}

/**
 * Audio payload as sent by the browser worklet.
 *
 * @remarks
 * The client sends `Float32Array[]`, but after `JSON.stringify` it becomes
 * arrays/objects of numbers, so we keep this permissive.
 */
export interface AudioInbound {
  type: 'audio' | 'AUDIO';
  audio: unknown[];
}

export interface AudioSessionEndInbound {
  type: 'audioSessionEnd';
}

export function isWSInboundMessage(value: unknown): value is WSInboundMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  if (typeof v.type !== 'string') return false;
  if (v.type === 'audioSessionEnd') return true;
  if (v.type === 'text' || v.type === 'TEXT') return typeof v.text === 'string';
  if (v.type === 'audio' || v.type === 'AUDIO') return Array.isArray(v.audio);
  return false;
}
