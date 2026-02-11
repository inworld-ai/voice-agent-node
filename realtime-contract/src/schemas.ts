/**
 * Zod schemas for realtime events (discriminated unions + parse helpers).
 * Mirrors types.ts for runtime validation; unknown events fall back to generic schema.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export const contentPartSchema = z.object({
  type: z.enum(['text', 'audio', 'input_text', 'input_audio']),
  text: z.string().optional(),
  audio: z.string().optional(),
  transcript: z.string().optional(),
});

export const conversationItemSchema = z
  .object({
    id: z.string().optional(),
    type: z.enum(['message', 'function_call', 'function_call_output']).optional(),
    object: z.literal('realtime.item').optional(),
    status: z.enum(['completed', 'in_progress', 'incomplete']).optional(),
    role: z.enum(['user', 'assistant', 'system']).optional(),
    content: z.array(contentPartSchema).optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    output: z.string().optional(),
  })
  .passthrough();

export const realtimeResponseSchema = z.object({
  id: z.string().optional(),
  conversation_id: z.string().optional().nullable(),
  max_output_tokens: z
    .union([z.number(), z.literal('inf')])
    .optional()
    .nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  output_modalities: z.array(z.string()).optional().nullable(),
  object: z.literal('realtime.response').optional().nullable(),
  output: z.array(conversationItemSchema).optional().nullable(),
  audio: z
    .object({
      output: z
        .object({
          format: z.unknown().optional().nullable(),
          voice: z.string().optional().nullable(),
          model: z.string().optional().nullable(),
          speed: z.number().optional().nullable(),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
  status: z.enum(['in_progress', 'completed', 'cancelled', 'failed', 'incomplete']).optional().nullable(),
  status_details: z.record(z.string(), z.unknown()).optional().nullable(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      input_token_details: z.record(z.string(), z.unknown()).optional().nullable(),
      output_tokens: z.number().optional(),
      output_token_details: z.record(z.string(), z.unknown()).optional().nullable(),
      total_tokens: z.number().optional(),
    })
    .optional()
    .nullable(),
});

// ---------------------------------------------------------------------------
// Server event schemas (sent from server to client)
// ---------------------------------------------------------------------------

export const sessionCreatedEventSchema = z.object({
  type: z.literal('session.created'),
  event_id: z.string(),
  session: z.record(z.string(), z.unknown()),
});

export const sessionUpdatedEventSchema = z.object({
  type: z.literal('session.updated'),
  event_id: z.string(),
  session: z.record(z.string(), z.unknown()),
});

export const conversationItemAddedEventSchema = z.object({
  type: z.literal('conversation.item.added'),
  event_id: z.string(),
  item: conversationItemSchema,
  previous_item_id: z.string().nullable().optional(),
});

export const conversationItemDoneEventSchema = z.object({
  type: z.literal('conversation.item.done'),
  event_id: z.string(),
  item: conversationItemSchema,
  previous_item_id: z.string().nullable().optional(),
});

export const conversationItemRetrievedEventSchema = z.object({
  type: z.literal('conversation.item.retrieved'),
  event_id: z.string(),
  item: conversationItemSchema,
});

export const conversationItemTruncatedEventSchema = z.object({
  type: z.literal('conversation.item.truncated'),
  event_id: z.string(),
  item_id: z.string(),
  audio_end_ms: z.number(),
  content_index: z.number(),
});

export const conversationItemDeletedEventSchema = z.object({
  type: z.literal('conversation.item.deleted'),
  event_id: z.string(),
  item_id: z.string(),
});

export const inputAudioBufferCommittedEventSchema = z.object({
  type: z.literal('input_audio_buffer.committed'),
  event_id: z.string(),
  item_id: z.string(),
  previous_item_id: z.string().nullable().optional(),
});

export const inputAudioBufferClearedEventSchema = z.object({
  type: z.literal('input_audio_buffer.cleared'),
  event_id: z.string(),
});

export const inputAudioBufferSpeechStartedEventSchema = z.object({
  type: z.literal('input_audio_buffer.speech_started'),
  event_id: z.string(),
  item_id: z.string(),
  audio_start_ms: z.number(),
});

export const inputAudioBufferSpeechStoppedEventSchema = z.object({
  type: z.literal('input_audio_buffer.speech_stopped'),
  event_id: z.string(),
  item_id: z.string(),
  audio_end_ms: z.number(),
});

export const conversationItemInputAudioTranscriptionDeltaEventSchema = z.object({
  type: z.literal('conversation.item.input_audio_transcription.delta'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number().optional(),
  delta: z.string().optional(),
});

export const conversationItemInputAudioTranscriptionCompletedEventSchema = z.object({
  type: z.literal('conversation.item.input_audio_transcription.completed'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number(),
  transcript: z.string(),
});

export const responseCreatedEventSchema = z.object({
  type: z.literal('response.created'),
  event_id: z.string(),
  response: realtimeResponseSchema,
});

export const responseDoneEventSchema = z.object({
  type: z.literal('response.done'),
  event_id: z.string(),
  response: realtimeResponseSchema,
});

export const responseOutputItemAddedEventSchema = z.object({
  type: z.literal('response.output_item.added'),
  event_id: z.string(),
  item: conversationItemSchema,
  output_index: z.number(),
  response_id: z.string(),
});

export const responseOutputItemDoneEventSchema = z.object({
  type: z.literal('response.output_item.done'),
  event_id: z.string(),
  item: conversationItemSchema,
  output_index: z.number(),
  response_id: z.string(),
});

export const responseContentPartAddedEventSchema = z.object({
  type: z.literal('response.content_part.added'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number(),
  output_index: z.number(),
  response_id: z.string(),
  part: z.object({
    audio: z.string().optional(),
    text: z.string().optional(),
    transcript: z.string().optional(),
    type: z.enum(['text', 'audio', 'input_text', 'input_audio']).optional(),
  }),
});

export const responseContentPartDoneEventSchema = z.object({
  type: z.literal('response.content_part.done'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number(),
  output_index: z.number(),
  response_id: z.string(),
  part: z.object({
    audio: z.string().optional(),
    text: z.string().optional(),
    transcript: z.string().optional(),
    type: z.enum(['text', 'audio', 'input_text', 'input_audio']).optional(),
  }),
});

export const responseAudioDeltaEventSchema = z.object({
  type: z.literal('response.output_audio.delta'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number(),
  delta: z.string(),
  output_index: z.number(),
  response_id: z.string(),
});

export const responseAudioDoneEventSchema = z.object({
  type: z.literal('response.output_audio.done'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number(),
  output_index: z.number(),
  response_id: z.string(),
});

export const responseAudioTranscriptDeltaEventSchema = z.object({
  type: z.literal('response.output_audio_transcript.delta'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number(),
  delta: z.string(),
  output_index: z.number(),
  response_id: z.string(),
});

export const responseAudioTranscriptDoneEventSchema = z.object({
  type: z.literal('response.output_audio_transcript.done'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number(),
  transcript: z.string(),
  output_index: z.number(),
  response_id: z.string(),
});

export const responseFunctionCallArgumentsDeltaEventSchema = z.object({
  type: z.literal('response.function_call_arguments.delta'),
  event_id: z.string(),
  item_id: z.string(),
  call_id: z.string(),
  delta: z.string(),
  output_index: z.number(),
  response_id: z.string(),
});

export const responseFunctionCallArgumentsDoneEventSchema = z.object({
  type: z.literal('response.function_call_arguments.done'),
  event_id: z.string(),
  item_id: z.string(),
  call_id: z.string(),
  arguments: z.string(),
  output_index: z.number(),
  response_id: z.string(),
});

export const responseTextDeltaEventSchema = z.object({
  type: z.literal('response.output_text.delta'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number(),
  delta: z.string(),
  output_index: z.number(),
  response_id: z.string(),
});

export const responseTextDoneEventSchema = z.object({
  type: z.literal('response.output_text.done'),
  event_id: z.string(),
  item_id: z.string(),
  content_index: z.number(),
  text: z.string(),
  output_index: z.number(),
  response_id: z.string(),
});

export const errorEventSchema = z.object({
  type: z.literal('error'),
  event_id: z.string(),
  error: z.object({
    type: z.string().optional(),
    code: z.string().nullable().optional(),
    message: z.string().optional(),
    param: z.string().nullable().optional(),
    event_id: z.string().nullable().optional(),
  }),
});

export const rateLimitsUpdatedEventSchema = z.object({
  type: z.literal('rate_limits.updated'),
  event_id: z.string(),
  rate_limits: z.array(
    z.object({
      limit: z.number().optional(),
      name: z.enum(['requests', 'tokens']).optional(),
      remaining: z.number().optional(),
      reset_seconds: z.number().optional(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Client event schemas (sent from client to server)
// ---------------------------------------------------------------------------

export const sessionUpdateEventSchema = z.object({
  type: z.literal('session.update'),
  event_id: z.string().optional(),
  session: z.record(z.string(), z.unknown()),
});

export const inputAudioBufferAppendEventSchema = z.object({
  type: z.literal('input_audio_buffer.append'),
  audio: z.string(),
  event_id: z.string().optional(),
});

export const inputAudioBufferClearEventSchema = z.object({
  type: z.literal('input_audio_buffer.clear'),
  event_id: z.string().optional(),
});

export const inputAudioBufferCommitEventSchema = z.object({
  type: z.literal('input_audio_buffer.commit'),
  event_id: z.string().optional(),
});

export const conversationItemCreateEventSchema = z.object({
  type: z.literal('conversation.item.create'),
  item: conversationItemSchema,
  event_id: z.string().optional(),
  previous_item_id: z.string().nullable().optional(),
});

export const conversationItemDeleteEventSchema = z.object({
  type: z.literal('conversation.item.delete'),
  item_id: z.string(),
  event_id: z.string().optional(),
});

export const conversationItemRetrieveEventSchema = z.object({
  type: z.literal('conversation.item.retrieve'),
  item_id: z.string(),
  event_id: z.string().optional(),
});

export const conversationItemTruncateEventSchema = z.object({
  type: z.literal('conversation.item.truncate'),
  item_id: z.string(),
  audio_end_ms: z.number(),
  content_index: z.number(),
  event_id: z.string().optional(),
});

export const responseCancelEventSchema = z.object({
  type: z.literal('response.cancel'),
  event_id: z.string().optional(),
  response_id: z.string().optional(),
});

export const responseCreateEventSchema = z.object({
  type: z.literal('response.create'),
  event_id: z.string().optional(),
  response: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Discriminated unions and generic fallback
// ---------------------------------------------------------------------------

export const genericServerEventSchema = z
  .object({
    type: z.string(),
    event_id: z.string().optional().nullable(),
  })
  .passthrough();

export const realtimeServerEventSchema = z.discriminatedUnion('type', [
  sessionCreatedEventSchema,
  sessionUpdatedEventSchema,
  conversationItemAddedEventSchema,
  conversationItemDoneEventSchema,
  conversationItemRetrievedEventSchema,
  conversationItemTruncatedEventSchema,
  conversationItemDeletedEventSchema,
  inputAudioBufferCommittedEventSchema,
  inputAudioBufferClearedEventSchema,
  inputAudioBufferSpeechStartedEventSchema,
  inputAudioBufferSpeechStoppedEventSchema,
  conversationItemInputAudioTranscriptionDeltaEventSchema,
  conversationItemInputAudioTranscriptionCompletedEventSchema,
  responseCreatedEventSchema,
  responseDoneEventSchema,
  responseOutputItemAddedEventSchema,
  responseOutputItemDoneEventSchema,
  responseContentPartAddedEventSchema,
  responseContentPartDoneEventSchema,
  responseAudioDeltaEventSchema,
  responseAudioDoneEventSchema,
  responseAudioTranscriptDeltaEventSchema,
  responseAudioTranscriptDoneEventSchema,
  responseFunctionCallArgumentsDeltaEventSchema,
  responseFunctionCallArgumentsDoneEventSchema,
  responseTextDeltaEventSchema,
  responseTextDoneEventSchema,
  errorEventSchema,
  rateLimitsUpdatedEventSchema,
]);

export const realtimeClientEventSchema = z.discriminatedUnion('type', [
  sessionUpdateEventSchema,
  inputAudioBufferAppendEventSchema,
  inputAudioBufferClearEventSchema,
  inputAudioBufferCommitEventSchema,
  conversationItemCreateEventSchema,
  conversationItemTruncateEventSchema,
  conversationItemDeleteEventSchema,
  conversationItemRetrieveEventSchema,
  responseCancelEventSchema,
  responseCreateEventSchema,
]);

// ---------------------------------------------------------------------------
// Parse helpers (accept string or object; work in browser and Node)
// ---------------------------------------------------------------------------

export type ServerEventParseResult =
  | { data: z.infer<typeof realtimeServerEventSchema>; isGeneric: false }
  | { data: z.infer<typeof genericServerEventSchema>; isGeneric: true }
  | { data: null; isGeneric: true };

export type ClientEventParseResult =
  | { data: z.infer<typeof realtimeClientEventSchema>; isGeneric: false }
  | { data: z.infer<typeof genericServerEventSchema>; isGeneric: true }
  | { data: null; isGeneric: true };

function toObject(raw: string | Record<string, unknown>): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }
  return null;
}

/**
 * Parse a server event (from WebSocket message or raw object).
 * Unknown event types are returned as generic events; invalid payloads return { data: null, isGeneric: true }.
 */
export function parseServerEvent(raw: string | Record<string, unknown>): ServerEventParseResult {
  const obj = toObject(raw);
  if (!obj) {
    return { data: null, isGeneric: true };
  }
  const parsed = realtimeServerEventSchema.safeParse(obj);
  if (parsed.success) {
    return { data: parsed.data as z.infer<typeof realtimeServerEventSchema>, isGeneric: false };
  }
  const genericParsed = genericServerEventSchema.safeParse(obj);
  if (genericParsed.success) {
    return { data: genericParsed.data, isGeneric: true };
  }
  return { data: null, isGeneric: true };
}

/**
 * Parse a client event (from WebSocket message or raw object).
 * Unknown event types are returned as generic events; invalid payloads return { data: null, isGeneric: true }.
 */
export function parseClientEvent(raw: string | Record<string, unknown>): ClientEventParseResult {
  const obj = toObject(raw);
  if (!obj) {
    return { data: null, isGeneric: true };
  }
  const parsed = realtimeClientEventSchema.safeParse(obj);
  if (parsed.success) {
    return { data: parsed.data as z.infer<typeof realtimeClientEventSchema>, isGeneric: false };
  }
  const genericParsed = genericServerEventSchema.safeParse(obj);
  if (genericParsed.success) {
    return { data: genericParsed.data as z.infer<typeof genericServerEventSchema>, isGeneric: true };
  }
  return { data: null, isGeneric: true };
}
