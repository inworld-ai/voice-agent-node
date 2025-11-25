import { Box, Fade, Stack, Typography } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';

import { config } from '../../config';
import {
  Actor,
  CHAT_HISTORY_TYPE,
  ChatHistoryItem,
  HistoryItemActor,
  InteractionLatency,
} from '../types';
import { Typing } from './Typing';

interface HistoryProps {
  history: ChatHistoryItem[];
  latencyData: InteractionLatency[];
}

type CombinedHistoryItem = {
  interactionId: string;
  messages: HistoryItemActor[];
  source: Actor;
  type: CHAT_HISTORY_TYPE;
};

export const History = (props: HistoryProps) => {
  const { history, latencyData } = props;

  const ref = useRef<HTMLDivElement>(null);
  const prevHistoryLengthRef = useRef(0);

  const [combinedChatHistory, setCombinedChatHistory] = useState<
    CombinedHistoryItem[]
  >([]);
  const [isInteractionEnd, setIsInteractionEnd] = useState<boolean>(true);

  // Scroll to bottom when combinedChatHistory changes (after messages are processed)
  useEffect(() => {
    if (ref.current && combinedChatHistory.length > 0) {
      const isNewMessage = combinedChatHistory.length > prevHistoryLengthRef.current;
      prevHistoryLengthRef.current = combinedChatHistory.length;
      
      if (isNewMessage) {
        // Use double requestAnimationFrame to ensure DOM is fully updated before scrolling
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (ref.current) {
              // Scroll instantly to prevent glitches
              ref.current.scrollTop = ref.current.scrollHeight;
            }
          });
        });
      } else {
        // For updates to existing messages, scroll only if near bottom
        if (ref.current) {
          const { scrollTop, scrollHeight, clientHeight } = ref.current;
          const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
          if (isNearBottom) {
            requestAnimationFrame(() => {
              if (ref.current) {
                ref.current.scrollTop = ref.current.scrollHeight;
              }
            });
          }
        }
      }
    }
  }, [combinedChatHistory]);

  useEffect(() => {
    let currentRecord: CombinedHistoryItem | undefined;
    const mergedRecords: CombinedHistoryItem[] = [];
    const hasActors = history.find(
      (record: ChatHistoryItem) => record.type === CHAT_HISTORY_TYPE.ACTOR,
    );
    const filteredEvents = history.filter((record: ChatHistoryItem) =>
      [CHAT_HISTORY_TYPE.ACTOR, CHAT_HISTORY_TYPE.INTERACTION_END].includes(
        record.type,
      ),
    );

    for (let i = 0; i < history.length; i++) {
      let item = history[i];
      switch (item.type) {
        case CHAT_HISTORY_TYPE.ACTOR:
          // For agent messages, also check if there's a placeholder to merge into
          if (item.source.isAgent) {
            currentRecord = mergedRecords.find(
              (r) =>
                r.interactionId === item.interactionId &&
                r.type === CHAT_HISTORY_TYPE.ACTOR &&
                r.source.isAgent &&
                (r.source.name === item.source.name || r.messages.length === 0), // Match by name or if it's a placeholder
            ) as CombinedHistoryItem;
          } else {
            // For user messages, match by name as before
            currentRecord = mergedRecords.find(
              (r) =>
                r.interactionId === item.interactionId &&
                [CHAT_HISTORY_TYPE.ACTOR].includes(r.messages?.[0]?.type) &&
                r.type === CHAT_HISTORY_TYPE.ACTOR &&
                r.source.name === item.source.name,
            ) as CombinedHistoryItem;
          }

          if (currentRecord) {
            currentRecord.messages.push(item);
            // Update source name if it was a placeholder
            if (currentRecord.messages.length === 1 && currentRecord.source.name === 'Assistant' && item.source.name !== 'Assistant') {
              currentRecord.source = item.source;
            }
          } else {
            currentRecord = {
              interactionId: item.interactionId,
              messages: [item],
              source: item.source,
              type: CHAT_HISTORY_TYPE.ACTOR,
            } as CombinedHistoryItem;
            mergedRecords.push(currentRecord);
          }
          break;
      }
    }

    // Interaction is considered ended
    // when there is no actor action yet (chat is not started)
    // or last received message is INTERACTION_END.
    const lastInteractionId =
      filteredEvents[filteredEvents.length - 1]?.interactionId;

    const interactionEnd = filteredEvents.find(
      (event) =>
        event.interactionId === lastInteractionId &&
        event.type === CHAT_HISTORY_TYPE.INTERACTION_END,
    );

    setIsInteractionEnd(!hasActors || (!!currentRecord && !!interactionEnd));

    // Find the last user message/interaction that doesn't have an agent response yet
    // Look for user messages and check if they have corresponding agent messages
    const userMessages = history.filter(
      (item) => item.type === CHAT_HISTORY_TYPE.ACTOR && item.source?.isUser === true
    );
    
    // Find the most recent user message that doesn't have an agent response
    let pendingUserInteractionId: string | undefined;
    for (let i = userMessages.length - 1; i >= 0; i--) {
      const userMsg = userMessages[i];
      const hasAgentResponse = mergedRecords.some(
        (item) => 
          item.interactionId === userMsg.interactionId && 
          item.source.isAgent &&
          item.messages.some((m) => !m.isRecognizing && m.text && m.text.trim().length > 0)
      );
      
      if (!hasAgentResponse) {
        pendingUserInteractionId = userMsg.interactionId;
        break;
      }
    }

    // Add placeholder typing bubble if there's a pending user interaction waiting for agent response
    if (pendingUserInteractionId) {
      // Check if placeholder doesn't already exist
      const placeholderExists = mergedRecords.some(
        (item) => item.interactionId === pendingUserInteractionId && item.source.isAgent && item.messages.length === 0
      );
      
      if (!placeholderExists) {
        const placeholderItem: CombinedHistoryItem = {
          interactionId: pendingUserInteractionId,
          messages: [],
          source: {
            name: 'Assistant',
            isAgent: true,
            isUser: false,
          } as Actor,
          type: CHAT_HISTORY_TYPE.ACTOR,
        };
        mergedRecords.push(placeholderItem);
      }
    }

    setCombinedChatHistory(mergedRecords);
  }, [history, isInteractionEnd]);

  const getContent = (message: HistoryItemActor) => {
    switch (message.type) {
      case CHAT_HISTORY_TYPE.ACTOR:
        // Style partial/recognizing text differently
        if (message.isRecognizing) {
          return (
            <span style={{ fontStyle: 'italic', opacity: 0.7 }}>
              {message.text}
            </span>
          );
        }
        return message.text;
    }
  };

  const getLatencyColor = (latencyMs: number): string => {
    if (latencyMs < 500) return '#10B981'; // Green - excellent
    if (latencyMs < 1000) return '#F59E0B'; // Amber - good
    if (latencyMs < 2000) return '#F97316'; // Orange - acceptable
    return '#EF4444'; // Red - slow
  };

  return (
    <Box
      ref={ref}
      sx={{
        flex: 1,
        overflow: 'auto',
        pt: 3,
        px: 3,
        pb: 0,
        maxWidth: '800px',
        mx: 'auto',
        width: '100%',
        scrollBehavior: 'auto', // Instant scroll to prevent glitches
        willChange: 'scroll-position', // Optimize scrolling performance
      }}
    >
      <Stack spacing={1}>
        {combinedChatHistory.map((item, index) => {
          let messages = item.messages;
          // Determine if this is an agent message by checking if it's NOT a user message
          const isAgent = !item.source?.isUser;

          // Find latency for this interaction (for agent messages)
          const latency = isAgent
            ? latencyData.find((l) => l.interactionId === item.interactionId)
            : null;

          return (
            <Box
              key={`message-group-${item.interactionId}-${index}`}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isAgent ? 'flex-start' : 'flex-end',
                width: '100%',
              }}
            >
              {/* Author name and latency badge */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  mb: 1,
                  px: 1,
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: '#817973',
                    fontSize: '12px',
                    fontWeight: 500,
                    fontFamily: 'Inter, Arial, sans-serif',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {item.source.isAgent ? 'Assistant' : 'You'}
                </Typography>

                {/* Latency badge for agent messages */}
                {config.ENABLE_LATENCY_REPORTING &&
                  isAgent &&
                  latency?.latencyMs !== undefined &&
                  (() => {
                    const endpointingLatencyMs =
                      latency.metadata?.endpointingLatencyMs || 0;
                    const totalLatencyMs =
                      latency.latencyMs + endpointingLatencyMs;
                    return (
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.5,
                          px: 1,
                          py: 0.25,
                          borderRadius: '8px',
                          backgroundColor: `${getLatencyColor(totalLatencyMs)}15`,
                          border: `1px solid ${getLatencyColor(totalLatencyMs)}40`,
                        }}
                        title={
                          endpointingLatencyMs > 0
                            ? `Endpointing: ${endpointingLatencyMs}ms + Processing: ${latency.latencyMs}ms = Total: ${totalLatencyMs}ms`
                            : `${latency.latencyMs}ms`
                        }
                      >
                        <Box
                          sx={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: getLatencyColor(totalLatencyMs),
                          }}
                        />
                        <Typography
                          variant="caption"
                          sx={{
                            fontSize: '10px',
                            fontWeight: 600,
                            fontFamily: 'Inter, Arial, sans-serif',
                            color: getLatencyColor(totalLatencyMs),
                            letterSpacing: '0.3px',
                          }}
                        >
                          {totalLatencyMs}ms
                          {endpointingLatencyMs > 0 ? (
                            <span
                              style={{
                                fontWeight: 400,
                                opacity: 0.8,
                                marginLeft: '2px',
                              }}
                            >
                              ({endpointingLatencyMs}+{latency.latencyMs})
                            </span>
                          ) : null}
                        </Typography>
                      </Box>
                    );
                  })()}
              </Box>

              {/* Message bubble */}
              <Box
                sx={{
                  maxWidth: '75%',
                  minWidth: '120px',
                  p: 2.5,
                  borderRadius: '16px',
                  backgroundColor: isAgent ? '#FFFFFF' : '#111111',
                  color: isAgent ? '#222222' : '#FFFFFF',
                  border: isAgent ? '1px solid #E9E5E0' : 'none',
                  boxShadow: isAgent
                    ? '0 2px 8px rgba(0, 0, 0, 0.04)'
                    : '0 2px 8px rgba(0, 0, 0, 0.15)',
                  fontFamily: 'Inter, Arial, sans-serif',
                  transition: 'all 0.3s ease-in-out',
                }}
              >
                {messages.length === 0 ? (
                  // Show typing indicator when no messages yet (placeholder)
                  <Typing />
                ) : (
                  <Typography
                    variant="body1"
                    sx={{
                      lineHeight: 1.5,
                      fontSize: '14px',
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontWeight: 400,
                    }}
                  >
                    {messages.map((m) => (
                      <React.Fragment key={m.id}>{getContent(m)}</React.Fragment>
                    ))}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}

      </Stack>
    </Box>
  );
};
