import { CopyAll, Mic, Send } from '@mui/icons-material';
import { Box, IconButton, InputAdornment, TextField } from '@mui/material';
import { useCallback, useState } from 'react';

import { INPUT_SAMPLE_RATE } from '../../../../constants';
import { CHAT_HISTORY_TYPE, ChatHistoryItem } from '../types';
import { ActionsStyled, RecordIcon } from './Chat.styled';
import { CopyConfirmedDialog } from './CopyConfirmedDialog';
import { History } from './History';

interface ChatProps {
  chatHistory: ChatHistoryItem[];
  connection: WebSocket;
  onStopChatting: () => void;
  userName: string;
}

let interval: number;
let stream: MediaStream;
let audioCtx: AudioContext;
let audioWorkletNode: AudioWorkletNode;

export function Chat(props: ChatProps) {
  const { chatHistory, connection } = props;

  const [text, setText] = useState('');
  const [copyDestination, setCopyDestination] = useState('');
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
    },
    [],
  );

  const formatTranscript = useCallback((messages: ChatHistoryItem[]) => {
    let transcript = '';

    messages.forEach((item) => {
      switch (item.type) {
        case CHAT_HISTORY_TYPE.ACTOR:
          // Add each message on a new line with proper formatting
          transcript += `\n${item.author}: ${item.text}`;
          break;
      }
    });

    return transcript.trim(); // Remove leading newline
  }, []);

  const getTranscript = useCallback(
    (messages: ChatHistoryItem[], startId?: string, endId?: string) => {
      if (!messages.length) {
        return '';
      }

      // get full array by default
      let startIndex: number = 0;
      let endIndex: number = messages.length - 1;

      if (startId || endId) {
        // find start/end indexes of the slice if ids are specified
        messages.forEach((item, index) => {
          if (item.id === startId) {
            startIndex = index;
          }

          if (item.id === endId) {
            endIndex = index;
          }
        });
      }

      if (endIndex < startIndex) {
        const tmp = startIndex;
        startIndex = endIndex;
        endIndex = tmp;
      }

      // generate eventual transcript
      return formatTranscript(messages.slice(startIndex, endIndex + 1));
    },
    [formatTranscript],
  );

  const handleCopyClick = useCallback(async () => {
    const history = getTranscript(chatHistory);

    if (navigator.clipboard) {
      navigator.clipboard.writeText(history).then(() => {
        setCopyDestination('clipboard');
      });
    } else {
      setCopyDestination('console');
    }

    setCopyConfirmOpen(true);
  }, [getTranscript, chatHistory]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    clearInterval(interval);
    stream.getTracks().forEach((track) => track.stop());
    audioWorkletNode?.disconnect();
    connection.send(JSON.stringify({ type: 'audioSessionEnd' }));
  }, [connection]);

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
    if (text) {
      connection.send(JSON.stringify({ type: 'text', text }));

      setText('');
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
      setIsRecording(false);
      return;
    }

    return startRecording();
  }, [isRecording, startRecording, stopRecording]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        position: 'relative',
        paddingBottom: '4.5rem',
        overflow: 'hidden',
        zIndex: 2,
      }}
    >
      <History history={chatHistory} />
      <ActionsStyled>
        <TextField
          variant="standard"
          fullWidth
          value={text}
          onChange={handleTextChange}
          onKeyPress={handleTextKeyPress}
          sx={{
            backgroundColor: (theme) => theme.palette.grey[100],
            borderRadius: '1rem',
            padding: '1rem',
          }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={handleSend}>
                  <Send />
                </IconButton>
              </InputAdornment>
            ),
            disableUnderline: true,
          }}
        />
        <IconButton
          onClick={handleSpeakClick}
          sx={{ height: '3rem', width: '3rem', backgroundColor: '#F1F5F9' }}
        >
          {isRecording ? <RecordIcon /> : <Mic />}
        </IconButton>
        <IconButton onClick={handleCopyClick}>
          <CopyAll fontSize="small" />
        </IconButton>
      </ActionsStyled>
      <CopyConfirmedDialog
        copyConfirmOpen={copyConfirmOpen}
        copyDestination={copyDestination}
        setCopyConfirmOpen={setCopyConfirmOpen}
      />
    </Box>
  );
}
