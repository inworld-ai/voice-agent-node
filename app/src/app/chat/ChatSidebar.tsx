import { Settings, VolumeUp } from '@mui/icons-material';
import {
  Box,
  FormControl,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback } from 'react';

import { AVAILABLE_VOICES } from '../constants/voices';

interface ChatSidebarProps {
  currentVoiceId: string;
  systemPrompt: string;
  onVoiceChange: (voiceId: string) => void;
  onSystemPromptChange: (prompt: string) => void;
  isSessionActive: boolean;
}

export function ChatSidebar(props: ChatSidebarProps) {
  const {
    currentVoiceId,
    systemPrompt,
    onVoiceChange,
    onSystemPromptChange,
    isSessionActive,
  } = props;

  const currentVoice = AVAILABLE_VOICES.find(
    (v) => v.voiceId === currentVoiceId,
  );

  const handleVoiceChange = useCallback(
    (voiceId: string) => {
      console.log(
        'ChatSidebar: Voice change to',
        voiceId,
        'Session active:',
        isSessionActive,
      );
      console.log('ChatSidebar: Always passing voice change to parent');
      onVoiceChange(voiceId);
    },
    [onVoiceChange, isSessionActive],
  );

  const handleSystemPromptChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!isSessionActive) {
        onSystemPromptChange(event.target.value);
      }
    },
    [onSystemPromptChange, isSessionActive],
  );

  console.log(
    'ChatSidebar render: isSessionActive =',
    isSessionActive,
    'currentVoiceId =',
    currentVoiceId,
  );

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: '1px solid #E9E5E0',
          backgroundColor: '#FFFFFF',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Settings sx={{ fontSize: 18, color: '#5C5652' }} />
          <Typography
            variant="h6"
            sx={{
              fontFamily: 'Inter, Arial, sans-serif',
              fontSize: '16px',
              fontWeight: 600,
              color: '#222222',
            }}
          >
            Settings
          </Typography>
        </Box>
        <Typography
          sx={{
            fontSize: '11px',
            color: isSessionActive ? '#E6145F' : '#28a745',
            fontFamily: 'Inter, Arial, sans-serif',
            fontWeight: 500,
            mt: 0.5,
          }}
        >
          {isSessionActive ? 'Locked during session' : 'Ready to edit'}
        </Typography>
      </Box>

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        {/* System Prompt Section */}
        <Box>
          <Typography
            sx={{
              fontFamily: 'Inter, Arial, sans-serif',
              fontSize: '14px',
              fontWeight: 600,
              color: '#222222',
              mb: 1.5,
            }}
          >
            System Prompt
          </Typography>
          <Paper
            sx={{
              borderRadius: '8px',
              backgroundColor: isSessionActive ? '#F8F6F4' : '#FFFFFF',
              border: '1px solid #E9E5E0',
              overflow: 'hidden',
              ...(!isSessionActive && {
                '&:hover': {
                  borderColor: '#D6D1CB',
                },
                '&:focus-within': {
                  borderColor: '#AEA69F',
                },
              }),
            }}
          >
            <TextField
              multiline
              rows={6}
              fullWidth
              value={systemPrompt}
              onChange={handleSystemPromptChange}
              disabled={isSessionActive}
              placeholder="Enter system instructions for the AI agent..."
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  border: 'none',
                  '& fieldset': {
                    border: 'none',
                  },
                },
                '& .MuiOutlinedInput-input': {
                  fontSize: '13px',
                  fontFamily: 'Inter, Arial, sans-serif',
                  lineHeight: 1.4,
                  p: '12px',
                  color: isSessionActive ? '#817973' : '#222222',
                  '&::placeholder': {
                    color: '#817973',
                    opacity: 1,
                  },
                },
                '& .MuiOutlinedInput-input:disabled': {
                  WebkitTextFillColor: '#817973',
                },
              }}
            />
          </Paper>
        </Box>

        {/* Voice Section */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <VolumeUp sx={{ fontSize: 18, color: '#5C5652' }} />
            <Typography
              sx={{
                fontFamily: 'Inter, Arial, sans-serif',
                fontSize: '14px',
                fontWeight: 600,
                color: '#222222',
              }}
            >
              Voice
            </Typography>
          </Box>

          {/* Voice Selector */}
          <FormControl fullWidth size="small">
            <Select
              value={currentVoiceId}
              onChange={(e) => {
                console.log(
                  'ChatSidebar: Select onChange triggered with value:',
                  e.target.value,
                );
                handleVoiceChange(e.target.value);
              }}
              disabled={isSessionActive}
              displayEmpty
              sx={{
                fontFamily: 'Inter, Arial, sans-serif',
                fontSize: '14px',
                backgroundColor: isSessionActive ? '#F8F6F4' : '#FFFFFF',
                borderRadius: '8px',
                height: '40px',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#E9E5E0',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#AEA69F',
                },
                ...(!isSessionActive && {
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#D6D1CB',
                  },
                }),
                '& .MuiSelect-select': {
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  color: isSessionActive ? '#817973' : '#222222',
                },
                '& .MuiSelect-select.Mui-disabled': {
                  WebkitTextFillColor: '#817973',
                },
              }}
            >
              {AVAILABLE_VOICES.map((voice) => (
                <MenuItem
                  key={voice.voiceId}
                  value={voice.voiceId}
                  sx={{
                    fontFamily: 'Inter, Arial, sans-serif',
                    fontSize: '14px',
                    padding: '8px 16px',
                    '&:hover': {
                      backgroundColor: '#f4f0eb',
                    },
                    '&.Mui-selected': {
                      backgroundColor: '#E6145F',
                      color: 'white',
                      '&:hover': {
                        backgroundColor: '#B8104C',
                      },
                    },
                  }}
                >
                  {voice.displayName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Current Voice Info */}
          {currentVoice && (
            <Box
              sx={{
                mt: 2,
                p: 2,
                backgroundColor: isSessionActive ? '#F8F6F4' : '#FFFFFF',
                borderRadius: '8px',
                border: '1px solid #E9E5E0',
              }}
            >
              <Typography
                sx={{
                  fontSize: '12px',
                  color: '#817973',
                  fontFamily: 'Inter, Arial, sans-serif',
                  lineHeight: 1.4,
                }}
              >
                {currentVoice.description}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
