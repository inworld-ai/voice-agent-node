import './App.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import toast, { Toaster } from 'react-hot-toast';
import { v4 } from 'uuid';

import { Chat } from './app/chat/Chat';
import { Layout } from './app/components/Layout';
import { ConfigView } from './app/configuration/ConfigView';
import {
  get as getConfiguration,
  save as saveConfiguration,
} from './app/helpers/configuration';
import { Player } from './app/sound/Player';
import {
  Agent,
  CHAT_HISTORY_TYPE,
  ChatHistoryItem,
  Configuration,
  InteractionLatency,
} from './app/types';
import { config } from './config';
import * as defaults from './defaults';

interface CurrentContext {
  agent?: Agent;
  chatting: boolean;
  connection?: WebSocket;
  userName?: string;
}

const player = new Player();
let key = '';

/**
 * Formats audio transcript text to ensure proper sentence structure:
 * - Starts with a capital letter
 * - Ends with a period (if final and not already ending with punctuation)
 */
function formatAudioTranscript(text: string, isFinal: boolean = true): string {
  if (!text || text.trim().length === 0) {
    return text;
  }

  let formatted = text.trim();

  // Capitalize first letter
  if (formatted.length > 0) {
    formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  // For final messages, ensure it ends with a period if it doesn't already end with punctuation
  if (isFinal) {
    const lastChar = formatted[formatted.length - 1];
    const endsWithPunctuation = /[.!?]/.test(lastChar);
    if (!endsWithPunctuation) {
      formatted += '.';
    }
  }

  return formatted;
}

function App() {
  const formMethods = useForm<Configuration>();

  const [open, setOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [connection, setConnection] = useState<WebSocket>();
  const [agent, setAgent] = useState<Agent>();
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [chatting, setChatting] = useState(false);
  const [userName, setUserName] = useState('');
  const [latencyData, setLatencyData] = useState<InteractionLatency[]>([]);

  const currentInteractionId = useRef<string | null>(null);
  const stopRecordingRef = useRef<(() => void) | undefined>(undefined);
  const stateRef = useRef<CurrentContext>({} as CurrentContext);
  stateRef.current = {
    agent,
    chatting,
    connection,
    userName,
  };

  const onOpen = useCallback(() => {
    console.log('Open!');
    setOpen(true);
  }, []);

  const onDisconnect = useCallback(() => {
    console.log('Disconnect!');
    setOpen(true);
  }, []);

  const onMessage = useCallback((message: MessageEvent) => {
    const packet = JSON.parse(message.data);

    let chatItem: ChatHistoryItem | undefined = undefined;

    if (packet?.type === 'AUDIO') {
      player.addToQueue({ audio: packet.audio });

      // Track first audio chunk for latency calculation (client-side)
      const interactionId = packet.packetId?.interactionId;
      if (interactionId) {
        setLatencyData((prev) => {
          const existing = prev.find(
            (item) => item.interactionId === interactionId,
          );

          if (existing && !existing.firstAudioTimestamp) {
            const firstAudioTimestamp = Date.now();
            // Calculate latency: prefer speechCompleteTimestamp, fallback to userTextTimestamp
            const startTimestamp =
              existing.speechCompleteTimestamp || existing.userTextTimestamp;
            const latencyMs = startTimestamp
              ? firstAudioTimestamp - startTimestamp
              : undefined;

            // Log latency with endpointing latency info for debugging
            const endpointingLatencyMs =
              existing.metadata?.endpointingLatencyMs || 0;
            if (latencyMs !== undefined && endpointingLatencyMs > 0) {
              const totalLatency = latencyMs + endpointingLatencyMs;
              console.log(
                `⏱️ Latency for interaction ${interactionId}: ${totalLatency}ms total ` +
                  `(${endpointingLatencyMs}ms endpointing + ${latencyMs}ms processing) ` +
                  `(from ${existing.speechCompleteTimestamp ? 'speech complete' : 'text input'})`,
              );
            } else if (latencyMs !== undefined) {
              console.log(
                `⏱️ Latency for interaction ${interactionId}: ${latencyMs}ms ` +
                  `(from ${existing.speechCompleteTimestamp ? 'speech complete' : 'text input'})`,
              );
            }

            return prev.map((item) =>
              item.interactionId === interactionId
                ? { ...item, firstAudioTimestamp, latencyMs }
                : item,
            );
          }
          return prev;
        });
      }
    } else if (packet?.type === 'NEW_INTERACTION') {
      currentInteractionId.current = packet.packetId?.interactionId;
      const interactionId = packet.packetId?.interactionId;

      // Track userTextTimestamp for text-based interactions
      // This is when the NEW_INTERACTION arrives at the client (after text is sent)
      if (interactionId) {
        setLatencyData((prev) => {
          const existing = prev.find(
            (item) => item.interactionId === interactionId,
          );
          // Only create/update if we don't already have this interaction (from speech)
          if (!existing) {
            return [
              ...prev,
              {
                interactionId,
                userTextTimestamp: Date.now(),
                userText: '', // Will be updated when we receive the text back
              },
            ];
          }
          return prev;
        });
      }
    } else if (packet?.type === 'CANCEL_RESPONSE') {
      console.log('Cancel response: stopping audio playback');
      player.stop();
    } else if (packet?.type === 'USER_SPEECH_COMPLETE') {
      // User's speech has been detected and processed (VAD detected end of speech)
      // Record timestamp on client side for latency measurement
      const interactionId = packet.packetId?.interactionId;
      const speechCompleteTimestamp = Date.now();

      console.log(
        `🎤 User speech complete for interaction ${interactionId}`,
        packet.metadata,
      );

      setLatencyData((prev) => {
        const existing = prev.find(
          (item) => item.interactionId === interactionId,
        );

        if (!existing) {
          // Create new entry for audio-based interaction
          return [
            ...prev,
            {
              interactionId,
              speechCompleteTimestamp,
              userText: 'Voice input', // Will be updated when we receive the transcribed text
              metadata: packet.metadata,
            },
          ];
        } else {
          // Update existing entry with speech completion time
          return prev.map((item) =>
            item.interactionId === interactionId
              ? { ...item, speechCompleteTimestamp, metadata: packet.metadata }
              : item,
          );
        }
      });
    } else if (packet?.type === 'TEXT') {
      const { agent, userName } = stateRef.current || {};
      const textContent = packet.text.text || '';
      const trimmedText = textContent.trim();
      const isAgent = packet.routing?.source?.isAgent;

      console.log(
        '📝 TEXT PACKET - From:',
        isAgent === true ? 'AGENT' : 'USER',
        'Original:',
        JSON.stringify(textContent),
        'Trimmed:',
        JSON.stringify(trimmedText),
        'Length:',
        trimmedText.length,
        'Final:',
        packet.text.final,
        'isAgent:',
        isAgent,
      );

      // Only filter empty messages from USER (not from AGENT)
      // isAgent is true for agent messages, undefined/false for user messages
      if (trimmedText.length > 0 || isAgent === true) {
        console.log('✅ Adding text message to chat');
        
        // Format audio transcripts for user messages (ensure proper sentence structure)
        let displayText = packet.text.text;
        if (!isAgent) {
          displayText = formatAudioTranscript(packet.text.text, packet.text.final);
        }
        
        chatItem = {
          id: packet.packetId?.utteranceId,
          type: CHAT_HISTORY_TYPE.ACTOR,
          date: new Date(packet.date!),
          source: packet.routing?.source,
          text: displayText, // Formatted text for user messages, original for agent messages
          interactionId: packet.packetId?.interactionId,
          isRecognizing: !packet.text.final,
          author: isAgent === true ? agent?.name : userName,
        };

        // Update latency data with user text for display
        if (!isAgent && packet.text.final && packet.packetId?.interactionId) {
          const formattedUserText = formatAudioTranscript(trimmedText, true);
          console.log(
            `🎯 User text received for interaction ${packet.packetId.interactionId}: "${formattedUserText}"`,
          );
          setLatencyData((prev) => {
            return prev.map((item) =>
              item.interactionId === packet.packetId.interactionId &&
              !item.userText
                ? { ...item, userText: formattedUserText }
                : item,
            );
          });
        }
      } else {
        console.log(
          '❌ Filtered out empty USER text message - not adding to chat',
        );
      }
    } else if (packet?.type === 'INTERACTION_END') {
      chatItem = {
        id: v4(),
        type: CHAT_HISTORY_TYPE.INTERACTION_END,
        date: new Date(packet.date!),
        source: packet.routing?.source,
        interactionId: packet.packetId?.interactionId,
      };
    } else if (packet?.type === 'ERROR') {
      // Stop recording if active when any error occurs
      if (stopRecordingRef.current) {
        console.log('🛑 Stopping recording due to error');
        stopRecordingRef.current();
      }

      toast.error(packet?.error ?? 'Something went wrong');
    }

    if (chatItem) {
      setChatHistory((currentState) => {
        let newState = undefined;

        // For partial/recognizing messages, find by interactionId + isRecognizing
        // This allows us to update the same message as it's being transcribed
        let currentHistoryIndex = -1;
        if (
          chatItem.type === CHAT_HISTORY_TYPE.ACTOR &&
          chatItem.isRecognizing
        ) {
          currentHistoryIndex = currentState.findIndex((item) => {
            return (
              item.type === CHAT_HISTORY_TYPE.ACTOR &&
              item.interactionId === chatItem?.interactionId &&
              item.isRecognizing === true &&
              item.source?.isAgent === chatItem?.source?.isAgent
            );
          });
        } else if (
          chatItem.type === CHAT_HISTORY_TYPE.ACTOR &&
          !chatItem.isRecognizing
        ) {
          // For final messages, check if there's a partial message to replace
          const partialIndex = currentState.findIndex((item) => {
            return (
              item.type === CHAT_HISTORY_TYPE.ACTOR &&
              item.interactionId === chatItem?.interactionId &&
              item.isRecognizing === true &&
              item.source?.isAgent === chatItem?.source?.isAgent
            );
          });

          if (partialIndex >= 0) {
            // Replace the partial message with the final one
            currentHistoryIndex = partialIndex;
          } else {
            // Otherwise, find by utteranceId (for agent messages or direct updates)
            currentHistoryIndex = currentState.findIndex((item) => {
              return item.id === chatItem?.id;
            });
          }
        } else {
          // For non-ACTOR messages (like INTERACTION_END), find by id
          currentHistoryIndex = currentState.findIndex((item) => {
            return item.id === chatItem?.id;
          });
        }

        if (currentHistoryIndex >= 0 && chatItem) {
          // Update existing item
          newState = [...currentState];
          newState[currentHistoryIndex] = chatItem;
        } else {
          // Add new item
          newState = [...currentState, chatItem!];
        }
        return newState;
      });
    }
  }, []);

  const openConnection = useCallback(async () => {
    key = v4();
    // Get configuration including voiceId from selected template
    const { agent, user, voiceId } = formMethods.getValues();

    setChatting(true);
    setUserName(user?.name!);

    const response = await fetch(`${config.LOAD_URL}?sessionId=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: user?.name,
        agent,
        voiceId,
        sttService: 'assemblyai', // Always use Assembly.AI (only supported STT service)
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setChatting(false);

      // Handle STT service configuration errors
      if (data.error && data.requestedService) {
        const envVarMap: { [key: string]: string } = {
          assemblyai: 'ASSEMBLY_AI_API_KEY',
        };

        const envVar = envVarMap[data.requestedService];
        const availableList = data.availableServices?.join(', ') || 'assemblyai';

        // Build error message
        let errorMessage = data.error;
        if (envVar) {
          errorMessage += `\n\nPlease set the ${envVar} environment variable on the server.`;
        }
        if (data.error.includes('Only Assembly.AI STT is supported')) {
          errorMessage += `\n\nThe requested STT service "${data.requestedService}" is not supported. Only Assembly.AI is available.`;
        }
        errorMessage += `\n\nAvailable STT services: ${availableList}`;

        toast.error(errorMessage, {
          duration: 8000,
          style: {
            maxWidth: '500px',
          },
        });

        console.error('STT Service Error:', {
          error: data.error,
          requestedService: data.requestedService,
          availableServices: data.availableServices,
          requiredEnvVar: envVar,
        });
      } else {
        // Generic error handling
        toast.error(
          `Failed to create session: ${data.errors || response.statusText}`,
        );
        console.log(response.statusText, ': ', data.errors);
      }

      return;
    }

    if (data.agent) {
      setAgent(data.agent as Agent);
    }

    // Add a small delay to ensure server has fully processed the session
    // This prevents race conditions where WebSocket connects before session is ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    const ws = new WebSocket(`${config.SESSION_URL}?sessionId=${key}`);

    // Add error handler for WebSocket connection failures
    ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      toast.error('Failed to establish WebSocket connection');
      setChatting(false);
    });

    // Add close handler to detect unexpected disconnections
    ws.addEventListener('close', (event) => {
      if (event.code === 1008) {
        console.error('WebSocket closed: Session not found');
        toast.error('Session not found. Please try again.');
        setChatting(false);
      } else if (!event.wasClean) {
        console.error(
          'WebSocket closed unexpectedly:',
          event.code,
          event.reason,
        );
      }
    });

    setConnection(ws);

    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('disconnect', onDisconnect);
  }, [formMethods, onDisconnect, onMessage, onOpen]);

  const stopChatting = useCallback(async () => {
    // Disable flags
    setChatting(false);
    setOpen(false);

    // Stop audio playing
    player.stop();

    // Clear collections (only when fully exiting to config)
    setChatHistory([]);
    setLatencyData([]);

    // Close connection and clear connection data
    if (connection) {
      connection.close();
      connection.removeEventListener('open', onOpen);
      connection.removeEventListener('message', onMessage);
      connection.removeEventListener('disconnect', onDisconnect);
      // Note: error and close handlers are removed automatically when connection closes
    }

    setConnection(undefined);
    setAgent(undefined);

    await fetch(`${config.UNLOAD_URL}?sessionId=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    key = '';
  }, [connection, onDisconnect, onMessage, onOpen]);

  const resetForm = useCallback(() => {
    formMethods.reset({
      ...defaults.configuration,
    });
    saveConfiguration(formMethods.getValues());
  }, [formMethods]);

  useEffect(() => {
    const configuration = getConfiguration();
    const parsedConfiguration = configuration
      ? JSON.parse(configuration)
      : defaults.configuration;

    // Normalize sttService to 'assemblyai' (remove any old values like 'inworld' or 'groq')
    formMethods.reset({
      ...parsedConfiguration,
      sttService: 'assemblyai',
    });

    setInitialized(true);
  }, [formMethods]);

  useEffect(() => {
    player.preparePlayer();
  }, []);

  const content = chatting ? (
    <Chat
      chatHistory={chatHistory}
      connection={connection}
      onStopChatting={stopChatting}
      userName={userName}
      latencyData={latencyData}
      onStopRecordingRef={stopRecordingRef}
      isLoaded={open && !!agent}
    />
  ) : (
    <ConfigView
      canStart={formMethods.formState.isValid}
      onStart={() => openConnection()}
      onResetForm={resetForm}
    />
  );

  return (
    <FormProvider {...formMethods}>
      <Toaster
        toastOptions={{
          style: {
            maxWidth: 'fit-content',
            wordBreak: 'break-word',
          },
        }}
      />
      <Layout chatMode={chatting}>{initialized ? content : ''}</Layout>
    </FormProvider>
  );
}

export default App;
