import {
  ThumbDown,
  ThumbDownOutlined,
  ThumbUp,
  ThumbUpOutlined,
} from '@mui/icons-material';
import { Box, Fade, IconButton, Stack, Typography } from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { config } from '../../config';
import {
  Actor,
  CHAT_HISTORY_TYPE,
  ChatHistoryItem,
  HistoryItemActor,
  InteractionLatency,
} from '../types';
import { Typing } from './Typing';

export type FeedbackRating = 'thumbs_up' | 'thumbs_down' | null;

interface HistoryProps {
  history: ChatHistoryItem[];
  latencyData: InteractionLatency[];
  onFeedback?: (itemId: string, rating: FeedbackRating) => void;
}

type CombinedHistoryItem = {
  id: string;
  message: HistoryItemActor;
  source: Actor;
  type: CHAT_HISTORY_TYPE;
};

export const History = (props: HistoryProps) => {
  const { history, latencyData, onFeedback } = props;

  const ref = useRef<HTMLDivElement>(null);
  const prevHistoryLengthRef = useRef(0);

  const [combinedChatHistory, setCombinedChatHistory] = useState<
    CombinedHistoryItem[]
  >([]);
  const [isInteractionEnd, setIsInteractionEnd] = useState<boolean>(true);
  const [feedbackState, setFeedbackState] = useState<Map<string, FeedbackRating>>(new Map());
  const [disabledItems, setDisabledItems] = useState<Set<string>>(new Set());

  const handleFeedback = useCallback(
    (itemId: string, currentRating: FeedbackRating) => {
      // Client-side debounce: disable buttons for 500ms after click
      if (disabledItems.has(itemId)) return;

      setDisabledItems((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
      setTimeout(() => {
        setDisabledItems((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }, 500);

      const existingRating = feedbackState.get(itemId);
      // Toggle off if clicking the same rating, otherwise set new rating
      const newRating = existingRating === currentRating ? null : currentRating;

      setFeedbackState((prev) => {
        const next = new Map(prev);
        if (newRating === null) {
          next.delete(itemId);
        } else {
          next.set(itemId, newRating);
        }
        return next;
      });

      onFeedback?.(itemId, newRating);
    },
    [feedbackState, disabledItems, onFeedback],
  );

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
    const mergedRecords: CombinedHistoryItem[] = [];
    const hasActors = history.find(
      (record: ChatHistoryItem) => record.type === CHAT_HISTORY_TYPE.ACTOR,
    );
    const filteredEvents = history.filter((record: ChatHistoryItem) =>
      [CHAT_HISTORY_TYPE.ACTOR, CHAT_HISTORY_TYPE.INTERACTION_END].includes(
        record.type,
      ),
    );

    // Find the most recent user message that doesn't have an agent response yet
    const userMessages = history.filter(
      (item) => item.type === CHAT_HISTORY_TYPE.ACTOR && item.source?.isUser === true
    );
    
    let pendingUserMessageId: string | undefined;
    for (let i = userMessages.length - 1; i >= 0; i--) {
      const userMsg = userMessages[i];
      // Check if there's an agent message in history after this user message
      const userMsgIndex = history.findIndex((item) => item.id === userMsg.id);
      const hasAgentResponse = history.slice(userMsgIndex + 1).some(
        (item) => 
          item.type === CHAT_HISTORY_TYPE.ACTOR &&
          item.source.isAgent &&
          !item.isRecognizing &&
          item.text &&
          item.text.trim().length > 0
      );
      
      if (!hasAgentResponse) {
        pendingUserMessageId = userMsg.id;
        break;
      }
    }

    // Process all history items in order - each message is independent
    // Track which user messages have assistant responses to avoid duplicate placeholders
    const userMessagesWithResponses = new Set<string>();
    
    for (let i = 0; i < history.length; i++) {
      let item = history[i];
      switch (item.type) {
        case CHAT_HISTORY_TYPE.ACTOR:
          // Each message is independent - create a record for it
          const record: CombinedHistoryItem = {
            id: item.id,
            message: item,
            source: item.source,
            type: CHAT_HISTORY_TYPE.ACTOR,
          };
          mergedRecords.push(record);
          
          // Track user messages that have assistant responses
          if (item.source.isAgent) {
            // Find the most recent user message before this assistant message
            for (let j = i - 1; j >= 0; j--) {
              const prevItem = history[j];
              if (prevItem.type === CHAT_HISTORY_TYPE.ACTOR && prevItem.source?.isUser) {
                userMessagesWithResponses.add(prevItem.id);
                break;
              }
            }
          }
          break;
      }
    }
    
    // Add placeholders only for user messages that don't have assistant responses yet
    for (let i = 0; i < history.length; i++) {
      let item = history[i];
      if (item.type === CHAT_HISTORY_TYPE.ACTOR && item.source.isUser && item.id === pendingUserMessageId) {
        // Only add placeholder if this user message doesn't have a response yet
        if (!userMessagesWithResponses.has(item.id)) {
          const placeholder: CombinedHistoryItem = {
            id: `placeholder-${item.id}`,
            message: {
              ...item,
              id: `placeholder-${item.id}`,
              text: '',
              isRecognizing: true,
              source: {
                name: 'Assistant',
                isAgent: true,
                isUser: false,
              },
            } as HistoryItemActor,
            source: {
              name: 'Assistant',
              isAgent: true,
              isUser: false,
            },
            type: CHAT_HISTORY_TYPE.ACTOR,
          };
          // Insert placeholder right after the user message
          const userMessageIndex = mergedRecords.findIndex((r) => r.id === item.id);
          if (userMessageIndex >= 0) {
            mergedRecords.splice(userMessageIndex + 1, 0, placeholder);
          } else {
            mergedRecords.push(placeholder);
          }
        }
      }
    }

    // Interaction is considered ended when there is no actor action yet or last received message is INTERACTION_END
    const lastEvent = filteredEvents[filteredEvents.length - 1];
    const interactionEnd = lastEvent?.type === CHAT_HISTORY_TYPE.INTERACTION_END;

    setIsInteractionEnd(!hasActors || !!interactionEnd);

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
        // Style cancelled messages - replace trailing punctuation with "..." to indicate interruption
        if (message.isCancelled) {
          const displayText = message.text || '(Cancelled)';
          let finalText = displayText.trim();
          
          // If already ends with "...", keep it
          if (finalText.endsWith('...')) {
            // Already has "...", keep as is
          } else {
            // Check if last character is a letter (a-z, A-Z)
            const lastChar = finalText[finalText.length - 1];
            const isLastCharLetter = /[a-zA-Z]/.test(lastChar);
            
            if (isLastCharLetter) {
              // Last character is a letter, append "..."
              finalText = `${finalText}...`;
            } else {
              // Last character is a symbol (punctuation, etc.), replace it with "..."
              finalText = finalText.slice(0, -1) + '...';
            }
          }
          
          return (
            <span style={{ 
              opacity: 0.7,
              fontStyle: 'italic'
            }}>
              {finalText}
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
        pb: 4,
        maxWidth: '800px',
        mx: 'auto',
        width: '100%',
        scrollBehavior: 'auto', // Instant scroll to prevent glitches
        willChange: 'scroll-position', // Optimize scrolling performance
      }}
    >
      <Stack spacing={1}>
        {combinedChatHistory.map((item, index) => {
          // Determine if this is an agent message by checking if it's NOT a user message
          const isAgent = !item.source?.isUser;

          // Find latency for this message (for agent messages, use the message id)
          const latency = isAgent
            ? latencyData.find((l) => l.interactionId === item.id)
            : null;

          return (
            <Box
              key={`message-${item.id}-${index}`}
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
                {!item.message.text || item.message.text.trim().length === 0 ? (
                  // Show typing indicator when no text yet (placeholder)
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
                    {getContent(item.message)}
                  </Typography>
                )}
              </Box>

              {/* Feedback buttons for completed agent messages */}
              {isAgent &&
                !item.message.isRecognizing &&
                item.message.text &&
                item.message.text.trim().length > 0 && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.25,
                      mt: 0.5,
                      ml: 0.5,
                    }}
                  >
                    <IconButton
                      size="small"
                      disabled={disabledItems.has(item.id)}
                      onClick={() => handleFeedback(item.id, 'thumbs_up')}
                      sx={{
                        color:
                          feedbackState.get(item.id) === 'thumbs_up'
                            ? '#10B981'
                            : '#C4BDB7',
                        padding: '4px',
                        transition: 'all 0.2s ease-in-out',
                        '&:hover': {
                          color: '#10B981',
                          backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        },
                        '&.Mui-disabled': {
                          color:
                            feedbackState.get(item.id) === 'thumbs_up'
                              ? '#10B981'
                              : '#C4BDB7',
                          opacity: 0.6,
                        },
                      }}
                    >
                      {feedbackState.get(item.id) === 'thumbs_up' ? (
                        <ThumbUp sx={{ fontSize: '16px' }} />
                      ) : (
                        <ThumbUpOutlined sx={{ fontSize: '16px' }} />
                      )}
                    </IconButton>
                    <IconButton
                      size="small"
                      disabled={disabledItems.has(item.id)}
                      onClick={() => handleFeedback(item.id, 'thumbs_down')}
                      sx={{
                        color:
                          feedbackState.get(item.id) === 'thumbs_down'
                            ? '#EF4444'
                            : '#C4BDB7',
                        padding: '4px',
                        transition: 'all 0.2s ease-in-out',
                        '&:hover': {
                          color: '#EF4444',
                          backgroundColor: 'rgba(239, 68, 68, 0.08)',
                        },
                        '&.Mui-disabled': {
                          color:
                            feedbackState.get(item.id) === 'thumbs_down'
                              ? '#EF4444'
                              : '#C4BDB7',
                          opacity: 0.6,
                        },
                      }}
                    >
                      {feedbackState.get(item.id) === 'thumbs_down' ? (
                        <ThumbDown sx={{ fontSize: '16px' }} />
                      ) : (
                        <ThumbDownOutlined sx={{ fontSize: '16px' }} />
                      )}
                    </IconButton>
                  </Box>
                )}
            </Box>
          );
        })}

      </Stack>
    </Box>
  );
};
