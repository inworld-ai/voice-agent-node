import { ArrowBackRounded, ArrowUpward, Mic } from '@mui/icons-material';
import {
  Box,
  Button,
  Collapse,
  IconButton,
  Link,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';

import { INPUT_SAMPLE_RATE } from '../../../../constants';
import { config } from '../../config';
import { ChatHistoryItem, InteractionLatency } from '../types';
import { RecordIcon } from './Chat.styled';
import { History } from './History';
import { LatencyChart } from './LatencyChart';

interface ChatProps {
  chatHistory: ChatHistoryItem[];
  connection: WebSocket;
  onStopChatting: () => void;
  userName: string;
  latencyData: InteractionLatency[];
  onStopRecordingRef?: React.MutableRefObject<(() => void) | undefined>;
}

let interval: number;
let stream: MediaStream;
let audioCtx: AudioContext;
let audioWorkletNode: AudioWorkletNode;

export function Chat(props: ChatProps) {
  const { chatHistory, connection, latencyData, onStopRecordingRef } = props;

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
    clearInterval(interval);
    stream?.getTracks().forEach((track) => track.stop());
    audioWorkletNode?.disconnect();
    connection.send(JSON.stringify({ type: 'audioSessionEnd' }));
  }, [connection]);

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

  const startRecording = useCallback(async () => {
    try {
      setIsRecording(true);

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: INPUT_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      audioCtx = new AudioContext({
        sampleRate: INPUT_SAMPLE_RATE,
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

      // Send accumulated audio chunks periodically
      interval = setInterval(() => {
        if (leftChannel.length > 0) {
          connection.send(
            JSON.stringify({
              type: 'audio',
              audio: leftChannel,
            }),
          );
          // Clear buffer
          leftChannel = [];
        }
      }, 100);
    } catch (e) {
      console.error('Error starting recording:', e);
      setIsRecording(false); // Reset state on error
      throw e; // Re-throw to see the error
    }
  }, [connection]);

  const handleSend = useCallback(() => {
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
      connection.send(JSON.stringify({ type: 'text', text: trimmedText }));
      setText('');
      // Keep text widget open after sending
    } else {
      console.log('❌ Blocked empty message - not sending');
    }
  }, [connection, text]);

  const handleTextKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSend();
      }
    },
    [handleSend],
  );

  const handleSpeakClick = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    // When starting recording at center position, also open text widget
    if (chatHistory.length === 0) {
      setShowTextWidget(true);
    }

    return startRecording();
  }, [isRecording, startRecording, stopRecording, chatHistory.length]);

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
          height: '100vh',
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
          }}
        >
          <History history={chatHistory} latencyData={latencyData} />
        </Box>

        {/* Input Widget - Different layouts for center vs bottom */}
        {chatHistory.length === 0 ? (
          // Centered vertical widget for initial state
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
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
              }}
            >
              {/* Microphone Button */}
              <IconButton
                onClick={handleSpeakClick}
                sx={{
                  height: '48px',
                  width: '48px',
                  backgroundColor: isRecording ? '#DC2626' : '#111111',
                  color: 'white',
                  borderRadius: '50%',
                  position: 'relative',
                  '&:hover': {
                    backgroundColor: isRecording ? '#B91C1C' : '#222222',
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
                  transition: 'all 0.2s ease-in-out',
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
                  color: isRecording ? '#222222' : '#817973',
                  fontSize: '14px',
                  fontFamily: 'Inter, Arial, sans-serif',
                  fontWeight: 500,
                  textAlign: 'center',
                  mt: 0.5,
                }}
              >
                {isRecording
                  ? 'Listening... Tap to stop'
                  : 'Tap to start speaking'}
              </Typography>

              {!isRecording && (
                <Link
                  component="button"
                  onClick={handleTypeInstead}
                  sx={{
                    color: '#817973',
                    fontSize: '12px',
                    fontFamily: 'Inter, Arial, sans-serif',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    mt: 0.5,
                    '&:hover': {
                      color: '#5C5652',
                    },
                  }}
                >
                  Type instead
                </Link>
              )}

              {/* Text input dropdown for center position */}
              <Collapse in={showTextWidget} timeout={200}>
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
                    placeholder="Type a message..."
                    variant="standard"
                    autoFocus
                    sx={{
                      '& .MuiInputBase-root': {
                        fontSize: '14px',
                        fontFamily: 'Inter, Arial, sans-serif',
                        color: '#222222',
                        lineHeight: 1.4,
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
                        transition: 'all 0.2s ease-in-out',
                      }}
                    >
                      <ArrowUpward sx={{ fontSize: '16px' }} />
                    </IconButton>
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
        ) : (
          // Horizontal bar for bottom position (ChatGPT style)
          <Box
            sx={{
              position: 'fixed',
              bottom: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10,
              width: '100%',
              maxWidth: '700px',
              px: 2,
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
              }}
            >
              {/* Microphone Button */}
              <IconButton
                onClick={handleSpeakClick}
                sx={{
                  height: '40px',
                  width: '40px',
                  backgroundColor: isRecording ? '#DC2626' : '#111111',
                  color: 'white',
                  borderRadius: '50%',
                  flexShrink: 0,
                  '&:hover': {
                    backgroundColor: isRecording ? '#B91C1C' : '#222222',
                  },
                  transition: 'all 0.2s ease-in-out',
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
                  isRecording
                    ? 'Listening... Tap mic to stop'
                    : 'Type a message...'
                }
                variant="standard"
                sx={{
                  flex: 1,
                  '& .MuiInputBase-root': {
                    fontSize: '16px',
                    fontFamily: 'Inter, Arial, sans-serif',
                    color: '#222222',
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
                    transition: 'all 0.2s ease-in-out',
                  }}
                >
                  <ArrowUpward sx={{ fontSize: '16px' }} />
                </IconButton>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </>
  );
}
