import { ArrowBackRounded, ArrowUpward, Mic } from '@mui/icons-material';
import {
  Box,
  Button,
  Collapse,
  Fade,
  IconButton,
  Link,
  Slide,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';

import { config } from '../../config';
import { ChatHistoryItem, InteractionLatency } from '../types';
import { RecordIcon } from './Chat.styled';
import { FeedbackRating, History } from './History';
import { LatencyChart } from './LatencyChart';
import { Player } from '../sound/Player';

interface ChatProps {
  chatHistory: ChatHistoryItem[];
  connection?: WebSocket;
  onStopChatting: () => void;
  userName: string;
  latencyData: InteractionLatency[];
  onStopRecordingRef?: React.MutableRefObject<(() => void) | undefined>;
  isLoaded: boolean;
  player: Player;
  currentResponseIdRef?: React.RefObject<string | null>;
  onFeedback?: (itemId: string, rating: FeedbackRating) => void;
}

let interval: any;
let stream: MediaStream;
let audioCtx: AudioContext;
let audioWorkletNode: AudioWorkletNode;

/**
 * Convert Float32Array audio to PCM16 Int16Array and base64 encode
 * OpenAI Realtime Protocol requires PCM16 at 24kHz
 */
function convertAudioToPCM16Base64(float32Audio: Float32Array): string {
  // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
  const int16Array = new Int16Array(float32Audio.length);
  for (let i = 0; i < float32Audio.length; i++) {
    // Clamp to [-1, 1] and convert to Int16 range
    // s < 0 ? s * 0x8000 : s * 0x7fff
    const s = Math.max(-1, Math.min(1, float32Audio[i]));
    int16Array[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }

  // Convert Int16Array to base64
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function Chat(props: ChatProps) {
  const { chatHistory, connection, latencyData, onStopRecordingRef, isLoaded, player, currentResponseIdRef, onFeedback } = props;

  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [showTextWidget, setShowTextWidget] = useState(false);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
    },
    [],
  );

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (interval) {
      clearInterval(interval);
      interval = 0;
    }
    stream?.getTracks().forEach((track) => track.stop());
    audioWorkletNode?.disconnect();
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch((error) => {
        console.warn('Error closing audio context:', error);
      });
    }
  }, []);

  // Expose stopRecording to parent via ref
  useEffect(() => {
    if (onStopRecordingRef) {
      onStopRecordingRef.current = stopRecording;
    }
    return () => {
      if (onStopRecordingRef) {
        onStopRecordingRef.current = undefined;
      }
    };
  }, [stopRecording, onStopRecordingRef]);

  // Stop recording if connection closes
  useEffect(() => {
    if (connection && isRecording) {
      const handleClose = () => {
        if (isRecording) {
          console.log('🛑 Connection closed, stopping recording');
          stopRecording();
        }
      };

      connection.addEventListener('close', handleClose);
      return () => {
        connection.removeEventListener('close', handleClose);
      };
    }
  }, [connection, isRecording, stopRecording]);

  const startRecording = useCallback(async () => {
    if (!connection || !isLoaded) return;
    
    try {
      setIsRecording(true);

      // Use 24kHz directly to match OpenAI Realtime Protocol requirements
      const TARGET_SAMPLE_RATE = 24000;
      
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      audioCtx = new AudioContext({
        sampleRate: TARGET_SAMPLE_RATE,
      });

      // Load the AudioWorklet processor
      await audioCtx.audioWorklet.addModule('/audio-processor.worklet.js');

      // Create the audio source and worklet node
      const source = audioCtx.createMediaStreamSource(stream);
      audioWorkletNode = new AudioWorkletNode(
        audioCtx,
        'audio-capture-processor',
      );

      // Collect audio samples from the worklet
      let leftChannel: Float32Array[] = [];

      audioWorkletNode.port.onmessage = (event) => {
        // Receive samples from the audio worklet thread
        leftChannel.push(new Float32Array(event.data.samples));
      };

      // Connect source to worklet (no need to connect to destination!)
      source.connect(audioWorkletNode);

      // Send accumulated audio chunks periodically using OpenAI Realtime Protocol (PCM16 base64 at 24kHz)
      interval = setInterval(() => {
        if (leftChannel.length > 0 && connection) {
          // Check if connection is still open before sending
          if (connection.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ WebSocket is not open, stopping recording');
            stopRecording();
            return;
          }

          // Concatenate all Float32Array chunks into one
          const totalLength = leftChannel.reduce((sum, arr) => sum + arr.length, 0);
          const concatenated = new Float32Array(totalLength);
          let offset = 0;
          for (const chunk of leftChannel) {
            concatenated.set(chunk, offset);
            offset += chunk.length;
          }

          // Convert to PCM16 and base64 encode (already at 24kHz from AudioContext)
          const base64Audio = convertAudioToPCM16Base64(concatenated);

          if (base64Audio) {
            // Send using OpenAI Realtime Protocol
            try {
              connection.send(
                JSON.stringify({
                  type: 'input_audio_buffer.append',
                  audio: base64Audio,
                }),
              );
            } catch (error) {
              console.error('⚠️ Error sending audio data:', error);
              stopRecording();
            }
          } else {
            console.warn('⚠️ Failed to convert audio to PCM16 base64');
          }

          // Clear buffer
          leftChannel = [];
        }
      }, 100);
    } catch (e) {
      console.error('Error starting recording:', e);
      setIsRecording(false); // Reset state on error
      throw e; // Re-throw to see the error
    }
  }, [connection, isLoaded]);

  const handleSend = useCallback(() => {
    if (!connection || !isLoaded) return;
    
    const trimmedText = text.trim();
    console.log(
      '🔵 HANDLE SEND - Original text:',
      JSON.stringify(text),
      'Trimmed:',
      JSON.stringify(trimmedText),
      'Length:',
      trimmedText.length,
    );

    if (trimmedText && trimmedText.length > 0) {
      console.log('✅ Sending text message:', JSON.stringify(trimmedText));
      
      // Stop audio playback if user interrupts by sending text
      const isPlaying = player.getIsPlaying();
      const queueLength = player.getQueueLength();
      console.log('🔍 Audio state check:', { isPlaying, queueLength });
      
      if (isPlaying || queueLength > 0) {
        console.log('🛑 Interruption detected: user sent text during audio playback');
        player.stop();
        // Optionally cancel the current response on the server
        if (currentResponseIdRef?.current && connection && connection.readyState === WebSocket.OPEN) {
          try {
            connection.send(JSON.stringify({
              type: 'response.cancel',
              response_id: currentResponseIdRef.current,
            }));
            console.log('📤 Sent response.cancel to server for response:', currentResponseIdRef.current);
          } catch (error) {
            console.error('Error sending response.cancel:', error);
          }
        } else {
          console.log('⚠️ Could not send response.cancel:', {
            hasResponseId: !!currentResponseIdRef?.current,
            hasConnection: !!connection,
            connectionState: connection?.readyState,
          });
        }
      } else {
        console.log('ℹ️ No audio playing, no interruption needed');
      }
      
      // Check connection state before sending
      if (connection.readyState !== WebSocket.OPEN) {
        console.error('❌ WebSocket is not open, cannot send message');
        console.error('ReadyState:', connection.readyState);
        // Note: The close handler in App.tsx will handle returning to settings
        return;
      }
      
      try {
        // Send using OpenAI Realtime Protocol
        // First create a conversation item
        connection.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: trimmedText,
                },
              ],
            },
          }),
        );

        // Then trigger a response
        connection.send(
          JSON.stringify({
            type: 'response.create',
          }),
        );

        setText('');
        // Keep text widget open after sending
      } catch (error) {
        console.error('❌ Error sending text message:', error);
        // Note: The close handler in App.tsx will handle returning to settings
      }
    } else {
      console.log('❌ Blocked empty message - not sending');
    }
  }, [connection, text, isLoaded, player, currentResponseIdRef]);

  const handleTextKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSend();
      }
    },
    [handleSend],
  );

  const handleSpeakClick = useCallback(async () => {
    if (!isLoaded || !connection) return;
    
    if (isRecording) {
      stopRecording();
      return;
    }

    // When starting recording at center position, also open text widget
    if (chatHistory.length === 0) {
      setShowTextWidget(true);
    }

    return startRecording();
  }, [isRecording, startRecording, stopRecording, chatHistory.length, isLoaded, connection]);

  const handleTypeInstead = useCallback(() => {
    setShowTextWidget(true);
  }, []);

  const handleCloseTextWidget = useCallback(() => {
    setShowTextWidget(false);
    setText('');
  }, []);

  return (
    <>
      {/* Full-width background matching ConfigView */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: '#FAF7F5',
          zIndex: -1,
        }}
      />

      {/* Latency Chart */}
      {config.ENABLE_LATENCY_REPORTING && (
        <LatencyChart latencyData={latencyData} />
      )}

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 3,
            backgroundColor: 'transparent',
          }}
        >
          <Button
            startIcon={<ArrowBackRounded />}
            onClick={props.onStopChatting}
            variant="outlined"
            size="small"
            sx={{
              borderColor: '#E9E5E0',
              color: '#5C5652',
              fontFamily: 'Inter, Arial, sans-serif',
              fontSize: '14px',
              fontWeight: 500,
              textTransform: 'none',
              borderRadius: '8px',
              px: 2,
              py: 1,
              '&:hover': {
                borderColor: '#D6D1CB',
                backgroundColor: '#f4f0eb',
              },
            }}
          >
            Back to settings
          </Button>
        </Box>

        {/* Chat History */}
        <Box
          sx={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: '140px',
            transition: 'padding-bottom 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <History history={chatHistory} latencyData={latencyData} onFeedback={onFeedback} />
        </Box>

        {/* Input Widget - Different layouts for center vs bottom */}
        {/* Centered widget - fades out and scales down when chat starts */}
        <Fade in={chatHistory.length === 0} timeout={500} unmountOnExit>
          <Box
            sx={{
              position: 'absolute',
              top: '35%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10,
            }}
          >
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 1.5,
                  backgroundColor: '#FFFFFF',
                  borderRadius: '24px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
                  border: '1px solid rgba(0, 0, 0, 0.06)',
                  p: 2.5,
                  minWidth: '320px',
                  maxWidth: '400px',
                  transform: 'scale(1)',
                  transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
              {/* Microphone Button */}
              <IconButton
                onClick={handleSpeakClick}
                disabled={!isLoaded}
                sx={{
                  height: '48px',
                  width: '48px',
                  backgroundColor: isRecording ? '#DC2626' : (!isLoaded ? '#CCCCCC' : '#111111'),
                  color: 'white',
                  borderRadius: '50%',
                  position: 'relative',
                  cursor: !isLoaded ? 'not-allowed' : 'pointer',
                  opacity: !isLoaded ? 0.6 : 1,
                  transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: !isLoaded ? 'scale(0.95)' : 'scale(1)',
                  '&:hover': {
                    backgroundColor: !isLoaded ? '#CCCCCC' : (isRecording ? '#B91C1C' : '#222222'),
                    transform: !isLoaded ? 'scale(0.95)' : 'scale(1.05)',
                  },
                  '&.Mui-disabled': {
                    backgroundColor: '#CCCCCC',
                    color: 'white',
                  },
                  '&::before': !isRecording
                    ? {
                        content: '""',
                        position: 'absolute',
                        width: '56px',
                        height: '56px',
                        borderRadius: '50%',
                        backgroundColor: '#111111',
                        opacity: 0.06,
                        animation: 'subtle-pulse 3s infinite',
                      }
                    : {},
                  '&::after': isRecording
                    ? {
                        content: '""',
                        position: 'absolute',
                        width: '60px',
                        height: '60px',
                        borderRadius: '50%',
                        backgroundColor: '#DC2626',
                        opacity: 0.15,
                        animation: 'recording-pulse 2s infinite',
                      }
                    : {},
                  '@keyframes subtle-pulse': {
                    '0%': { transform: 'scale(1)', opacity: 0.06 },
                    '50%': { transform: 'scale(1.05)', opacity: 0.03 },
                    '100%': { transform: 'scale(1)', opacity: 0.06 },
                  },
                  '@keyframes recording-pulse': {
                    '0%': { transform: 'scale(1)', opacity: 0.15 },
                    '50%': { transform: 'scale(1.1)', opacity: 0.08 },
                    '100%': { transform: 'scale(1.2)', opacity: 0 },
                  },
                }}
              >
                {isRecording ? (
                  <RecordIcon sx={{ fontSize: '20px' }} />
                ) : (
                  <Mic sx={{ fontSize: '20px' }} />
                )}
              </IconButton>

              <Typography
                variant="body2"
                sx={{
                  color: isRecording ? '#222222' : (!isLoaded ? '#CCCCCC' : '#817973'),
                  fontSize: '14px',
                  fontFamily: 'Inter, Arial, sans-serif',
                  fontWeight: 500,
                  textAlign: 'center',
                  mt: 0.5,
                  transition: 'color 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                {!isLoaded
                  ? 'Loading...'
                  : isRecording
                  ? 'Listening... Tap to stop'
                  : 'Tap to start speaking'}
              </Typography>

              {!isRecording && (
                <Fade in={isLoaded} timeout={300}>
                  <Link
                    component="button"
                    onClick={handleTypeInstead}
                    sx={{
                      color: '#817973',
                      fontSize: '12px',
                      fontFamily: 'Inter, Arial, sans-serif',
                      textDecoration: 'underline',
                      cursor: isLoaded ? 'pointer' : 'not-allowed',
                      mt: 0.5,
                      opacity: isLoaded ? 1 : 0.5,
                      pointerEvents: isLoaded ? 'auto' : 'none',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      '&:hover': {
                        color: isLoaded ? '#5C5652' : '#817973',
                      },
                    }}
                  >
                    Type instead
                  </Link>
                </Fade>
              )}

              {/* Text input dropdown for center position */}
              <Collapse in={showTextWidget} timeout={300}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    width: '280px',
                    px: 2,
                    py: 1,
                    borderRadius: '20px',
                    backgroundColor: '#F8F9FA',
                    border: '1px solid #E9E5E0',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
                    minHeight: '44px',
                    mt: 1.5,
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover': {
                      borderColor: '#D6D1CB',
                      backgroundColor: '#FFFFFF',
                    },
                    '&:focus-within': {
                      borderColor: '#AEA69F',
                      backgroundColor: '#FFFFFF',
                      boxShadow: '0 2px 12px rgba(0, 0, 0, 0.10)',
                    },
                  }}
                >
                  <TextField
                    fullWidth
                    multiline
                    maxRows={3}
                    value={text}
                    onChange={handleTextChange}
                    onKeyPress={handleTextKeyPress}
                    placeholder={!isLoaded ? "Loading..." : "Type a message..."}
                    variant="standard"
                    autoFocus
                    disabled={!isLoaded}
                    sx={{
                      '& .MuiInputBase-root': {
                        fontSize: '14px',
                        fontFamily: 'Inter, Arial, sans-serif',
                        color: '#222222',
                        lineHeight: 1.4,
                        transition: 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                        '&::before, &::after': {
                          display: 'none',
                        },
                      },
                      '& .MuiInputBase-input': {
                        padding: '8px 0',
                        display: 'flex',
                        alignItems: 'center',
                        '&::placeholder': {
                          color: '#817973',
                          opacity: 1,
                        },
                      },
                    }}
                  />

                  {text.trim() && (
                    <Fade in={!!text.trim()} timeout={200}>
                      <IconButton
                        onClick={handleSend}
                        sx={{
                          backgroundColor: '#111111',
                          color: 'white',
                          borderRadius: '50%',
                          width: '32px',
                          height: '32px',
                          minWidth: '32px',
                          ml: 1,
                          '&:hover': {
                            backgroundColor: '#222222',
                          },
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        }}
                      >
                        <ArrowUpward sx={{ fontSize: '16px' }} />
                      </IconButton>
                    </Fade>
                  )}

                  <IconButton
                    onClick={handleCloseTextWidget}
                    sx={{
                      height: '28px',
                      width: '28px',
                      minWidth: '28px',
                      color: '#817973',
                      ml: 0.5,
                      '&:hover': {
                        backgroundColor: '#E9E5E0',
                        color: '#5C5652',
                      },
                      transition: 'all 0.2s ease-in-out',
                    }}
                  >
                    ✕
                  </IconButton>
                </Box>
              </Collapse>
            </Box>
          </Box>
        </Fade>

        {/* Bottom widget - slides up and fades in when chat starts */}
        <Slide direction="up" in={chatHistory.length > 0} timeout={600} mountOnEnter unmountOnExit>
          <Box
            sx={{
              position: 'fixed',
              bottom: '24px',
              left: 0,
              right: 0,
              zIndex: 10,
              width: '100%',
              maxWidth: '800px',
              mx: 'auto',
              px: 3,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#FFFFFF',
                borderRadius: '28px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
                border: '1px solid rgba(0, 0, 0, 0.06)',
                px: 2,
                py: 1.5,
                gap: 1.5,
                minHeight: '56px',
                width: '100%',
                maxWidth: '700px',
                mx: 'auto',
              }}
            >
              {/* Microphone Button */}
              <IconButton
                onClick={handleSpeakClick}
                disabled={!isLoaded}
                sx={{
                  height: '40px',
                  width: '40px',
                  backgroundColor: isRecording ? '#DC2626' : (!isLoaded ? '#CCCCCC' : '#111111'),
                  color: 'white',
                  borderRadius: '50%',
                  flexShrink: 0,
                  cursor: !isLoaded ? 'not-allowed' : 'pointer',
                  opacity: !isLoaded ? 0.6 : 1,
                  transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: !isLoaded ? 'scale(0.95)' : 'scale(1)',
                  '&:hover': {
                    backgroundColor: !isLoaded ? '#CCCCCC' : (isRecording ? '#B91C1C' : '#222222'),
                    transform: !isLoaded ? 'scale(0.95)' : 'scale(1.05)',
                  },
                  '&.Mui-disabled': {
                    backgroundColor: '#CCCCCC',
                    color: 'white',
                  },
                }}
              >
                {isRecording ? (
                  <RecordIcon sx={{ fontSize: '18px' }} />
                ) : (
                  <Mic sx={{ fontSize: '18px' }} />
                )}
              </IconButton>

              {/* Content Area - Always show text input at bottom */}
              <TextField
                fullWidth
                value={text}
                onChange={handleTextChange}
                onKeyPress={handleTextKeyPress}
                placeholder={
                  !isLoaded
                    ? 'Loading...'
                    : isRecording
                    ? 'Listening... Tap mic to stop'
                    : 'Type a message...'
                }
                variant="standard"
                disabled={!isLoaded}
                sx={{
                  flex: 1,
                  '& .MuiInputBase-root': {
                    fontSize: '16px',
                    fontFamily: 'Inter, Arial, sans-serif',
                    color: '#222222',
                    transition: 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&::before, &::after': {
                      display: 'none',
                    },
                  },
                  '& .MuiInputBase-input': {
                    padding: '8px 0',
                    '&::placeholder': {
                      color: isRecording ? '#DC2626' : '#817973',
                      opacity: 1,
                    },
                  },
                }}
              />

              {text.trim() && (
                <Fade in={!!text.trim()} timeout={200}>
                  <IconButton
                    onClick={handleSend}
                    sx={{
                      backgroundColor: '#111111',
                      color: 'white',
                      borderRadius: '50%',
                      width: '32px',
                      height: '32px',
                      minWidth: '32px',
                      '&:hover': {
                        backgroundColor: '#222222',
                      },
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  >
                    <ArrowUpward sx={{ fontSize: '16px' }} />
                  </IconButton>
                </Fade>
              )}
            </Box>
          </Box>
        </Slide>
      </Box>
    </>
  );
}
