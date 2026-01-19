import {
  Close,
  CloudUpload,
  Mic,
  MicOff,
  PlayArrow,
  Refresh,
  Stop,
} from '@mui/icons-material';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';

import { config } from '../../config';

interface VoiceCloneDialogProps {
  open: boolean;
  onClose: () => void;
  onVoiceCloned: (voiceId: string, displayName: string) => void;
}

export const VoiceCloneDialog = ({
  open,
  onClose,
  onVoiceCloned,
}: VoiceCloneDialogProps) => {
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      handleReset();
    }
  }, [open]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 24000,
        },
      });

      // Try to use a more compressed format, fallback to webm
      let mimeType = 'audio/webm;codecs=opus';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        audioBitsPerSecond: 64000,
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const newTime = prev + 1;
          // Auto-stop at 15 seconds (API limit)
          if (newTime >= 15) {
            stopRecording();
          }
          return newTime;
        });
      }, 1000);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError(
        'Unable to access microphone. Please check your browser permissions.'
      );
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const handleReset = useCallback(() => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setAudioBlob(null);
    setRecordingTime(0);
    setError(null);
    setIsProcessing(false);
  }, [audioUrl]);

  const convertAudioToBase64 = useCallback(
    async (blob: Blob): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },
    []
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      // Validate file type
      const validTypes = [
        'audio/wav',
        'audio/mp3',
        'audio/mpeg',
        'audio/webm',
        'audio/ogg',
        'audio/m4a',
        'audio/x-m4a',
      ];
      if (!validTypes.includes(file.type) && !file.name.match(/\.(wav|mp3|webm|ogg|m4a)$/i)) {
        setError('Please upload a valid audio file (WAV, MP3, WebM, OGG, or M4A)');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError('File too large. Please upload an audio file under 10MB.');
        return;
      }

      setError(null);
      setAudioBlob(file);
      const url = URL.createObjectURL(file);
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioUrl(url);
    },
    [audioUrl]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload]
  );

  const handleCloneVoice = useCallback(async () => {
    if (!audioBlob) {
      setError('Please record or upload an audio sample first');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const base64Audio = await convertAudioToBase64(audioBlob);
      const displayName = `Custom Voice ${new Date().toLocaleTimeString()}`;

      const response = await fetch(config.CLONE_VOICE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioData: base64Audio,
          displayName,
          langCode: 'EN_US',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.warnings && data.warnings.length > 0) {
        console.warn('Voice clone warnings:', data.warnings);
      }

      // Success! Pass the voice ID back
      onVoiceCloned(data.voiceId, data.displayName || displayName);
      onClose();
    } catch (err: any) {
      console.error('Error cloning voice:', err);
      setError(err.message || 'Failed to clone voice. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [audioBlob, convertAudioToBase64, onVoiceCloned, onClose]);

  return (
    <Dialog
      open={open}
      onClose={() => !isProcessing && onClose()}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
          backgroundColor: '#FFFFFF',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Mic sx={{ color: '#dc3545' }} />
          <Typography
            variant="h6"
            sx={{
              fontWeight: 600,
              fontFamily: 'Inter, Arial, sans-serif',
            }}
          >
            Clone Your Voice
          </Typography>
        </Box>
        <IconButton
          onClick={onClose}
          disabled={isProcessing}
          size="small"
        >
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {/* Instructions */}
        <Box
          sx={{
            mb: 3,
            p: 2,
            backgroundColor: '#fff5f5',
            borderRadius: '12px',
            border: '1px solid #f0d0d0',
          }}
        >
          <Typography
            variant="body2"
            sx={{
              color: '#555',
              lineHeight: 1.7,
              fontFamily: 'Inter, Arial, sans-serif',
              mb: 2,
            }}
          >
            <strong>🎤 Record a 10-15 second audio sample</strong> speaking
            clearly, or drag & drop an existing audio file.
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: '#555',
              lineHeight: 1.7,
              fontFamily: 'Inter, Arial, sans-serif',
              mb: 2,
            }}
          >
            <strong>Find a quiet place</strong> for the best results.
          </Typography>
          <Box
            sx={{
              backgroundColor: '#fff',
              p: 2,
              borderRadius: '8px',
              border: '1px solid #d0e7ff',
            }}
          >
            <Typography
              variant="body2"
              sx={{
                color: '#333',
                fontStyle: 'italic',
                lineHeight: 1.7,
                fontFamily: 'Inter, Arial, sans-serif',
              }}
            >
              Sample script: "Hi there! I'm excited to try out this voice
              cloning feature. This is me speaking naturally so the AI can
              learn my voice patterns. Thanks for listening!"
            </Typography>
          </Box>
        </Box>

        {/* Recording / Upload Area */}
        {!audioBlob ? (
          <Box sx={{ textAlign: 'center' }}>
            {/* Drag & Drop Zone */}
            <Box
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => !isRecording && fileInputRef.current?.click()}
              sx={{
                p: 4,
                mb: 3,
                border: `2px dashed ${isDragging ? '#667eea' : '#E9E5E0'}`,
                borderRadius: '12px',
                backgroundColor: isDragging ? '#f0f4ff' : '#fafafa',
                cursor: isRecording ? 'default' : 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: isRecording ? '#E9E5E0' : '#AEA69F',
                  backgroundColor: isRecording ? '#fafafa' : '#f5f5f5',
                },
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileInputChange}
                style={{ display: 'none' }}
              />
              <CloudUpload
                sx={{ fontSize: 48, color: '#AEA69F', mb: 1 }}
              />
              <Typography
                variant="body2"
                sx={{
                  color: '#817973',
                  fontFamily: 'Inter, Arial, sans-serif',
                }}
              >
                Drag & drop an audio file here, or click to browse
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: '#AEA69F',
                  fontFamily: 'Inter, Arial, sans-serif',
                }}
              >
                WAV, MP3, WebM, OGG, M4A (max 10MB)
              </Typography>
            </Box>

            <Typography
              variant="body2"
              sx={{
                color: '#817973',
                fontFamily: 'Inter, Arial, sans-serif',
                mb: 2,
              }}
            >
              — or —
            </Typography>

            {/* Record Button */}
            <Button
              variant="contained"
              onClick={isRecording ? stopRecording : startRecording}
              startIcon={isRecording ? <Stop /> : <Mic />}
              sx={{
                backgroundColor: isRecording ? '#333' : '#dc3545',
                borderRadius: '24px',
                px: 4,
                py: 1.5,
                textTransform: 'none',
                fontFamily: 'Inter, Arial, sans-serif',
                fontWeight: 600,
                fontSize: '15px',
                '&:hover': {
                  backgroundColor: isRecording ? '#111' : '#c82333',
                },
              }}
            >
              {isRecording
                ? `Stop Recording (${recordingTime}s)`
                : 'Start Recording'}
            </Button>

            {isRecording && (
              <Box sx={{ mt: 2 }}>
                <LinearProgress
                  variant="determinate"
                  value={(recordingTime / 15) * 100}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: '#f0d0d0',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: '#dc3545',
                    },
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    color: '#dc3545',
                    fontFamily: 'Inter, Arial, sans-serif',
                    mt: 1,
                    display: 'block',
                  }}
                >
                  Recording... Speak clearly for 10-15 seconds
                </Typography>
              </Box>
            )}
          </Box>
        ) : (
          /* Audio Preview */
          <Box sx={{ textAlign: 'center' }}>
            <audio
              src={audioUrl || undefined}
              controls
              style={{ width: '100%', marginBottom: '16px' }}
            />

            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                gap: 2,
                mb: 3,
              }}
            >
              <Button
                variant="outlined"
                onClick={handleReset}
                startIcon={<Refresh />}
                disabled={isProcessing}
                sx={{
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontFamily: 'Inter, Arial, sans-serif',
                  borderColor: '#AEA69F',
                  color: '#5C5652',
                  '&:hover': {
                    borderColor: '#817973',
                    backgroundColor: '#fafafa',
                  },
                }}
              >
                Record Again
              </Button>
            </Box>

            <Button
              variant="contained"
              onClick={handleCloneVoice}
              disabled={isProcessing}
              sx={{
                backgroundColor: '#111111',
                borderRadius: '8px',
                px: 4,
                py: 1.5,
                textTransform: 'none',
                fontFamily: 'Inter, Arial, sans-serif',
                fontWeight: 600,
                fontSize: '15px',
                '&:hover': {
                  backgroundColor: '#222222',
                },
                '&.Mui-disabled': {
                  backgroundColor: '#E9E5E0',
                  color: '#AEA69F',
                },
              }}
            >
              {isProcessing ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} sx={{ color: 'white' }} />
                  Creating Voice...
                </Box>
              ) : (
                'Create Voice Clone'
              )}
            </Button>
          </Box>
        )}

        {/* Error Message */}
        {error && (
          <Typography
            variant="body2"
            sx={{
              color: '#d32f2f',
              mt: 2,
              textAlign: 'center',
              fontFamily: 'Inter, Arial, sans-serif',
            }}
          >
            {error}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
};


