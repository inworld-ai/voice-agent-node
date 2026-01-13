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
  HistoryItemActor,
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
  const transcriptBuffers = useRef<Map<string, string>>(new Map()); // item_id -> accumulated transcript
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
    const event = JSON.parse(message.data);
    const eventType = event?.type;

    let chatItem: ChatHistoryItem | undefined = undefined;

    console.log('📨 Received event:', eventType, event);

    if (eventType === 'session.created') {
      console.log('✅ Session created');
      // Session is ready, we can start sending audio/text
    } else if (eventType === 'response.output_audio.delta' || eventType === 'response.audio.delta') {
      // Audio chunk from agent response
      // Audio format is determined by audio.output.format in session.update
      // Currently the server implementation sends PCM16 base64 (Int16Array at 24kHz)
      if (event.delta) {
        try {
          // Decode base64 to get PCM16 Int16Array bytes
          const binaryString = atob(event.delta);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          // Convert to Int16Array (PCM16)
          const int16Array = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
          
          // Convert Int16 to Float32 for Player
          const float32Array = new Float32Array(int16Array.length);
          for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0; // Convert to -1.0 to 1.0 range
          }
          
          // Convert Float32Array to base64 for Player (Player expects base64 Float32 PCM)
          const floatBytes = new Uint8Array(float32Array.buffer);
          let binary = '';
          for (let i = 0; i < floatBytes.length; i++) {
            binary += String.fromCharCode(floatBytes[i]);
          }
          const base64Float32 = btoa(binary);
          
          player.addToQueue({ audio: { chunk: base64Float32 } });

          // Track first audio chunk for latency calculation
          const itemId = event.item_id;
          if (itemId) {
            // Find the most recent user message to calculate latency
            setChatHistory((currentState) => {
              const userMessages = currentState.filter(
                (item) => item.type === CHAT_HISTORY_TYPE.ACTOR && item.source?.isUser === true
              );
              
              if (userMessages.length > 0) {
                const mostRecentUserMessage = userMessages[userMessages.length - 1];
                const userTextTimestamp = mostRecentUserMessage.date?.getTime() || Date.now();
                
                // Get text from user message (only if it's an ACTOR type)
                const userText = mostRecentUserMessage.type === CHAT_HISTORY_TYPE.ACTOR 
                  ? (mostRecentUserMessage as HistoryItemActor).text 
                  : '';
                
                setLatencyData((prev) => {
                  const existing = prev.find((item) => item.interactionId === itemId);
                  
                  if (!existing || !existing.firstAudioTimestamp) {
                    const firstAudioTimestamp = Date.now();
                    const latencyMs = firstAudioTimestamp - userTextTimestamp;
                    
                    console.log(`⏱️ Latency for assistant item ${itemId}: ${latencyMs}ms`);
                    
                    if (existing) {
                      return prev.map((item) =>
                        item.interactionId === itemId
                          ? { ...item, firstAudioTimestamp, latencyMs }
                          : item,
                      );
                    } else {
                      return [
                        ...prev,
                        {
                          interactionId: itemId,
                          firstAudioTimestamp,
                          latencyMs,
                          userTextTimestamp,
                          userText: userText,
                        },
                      ];
                    }
                  }
                  return prev;
                });
              }
              
              return currentState; // No state change, just using it for reading
            });
          }
        } catch (error) {
          console.error('Error processing audio delta:', error);
        }
      }
    } else if (eventType === 'response.output_audio_transcript.delta' || eventType === 'response.audio_transcript.delta') {
      // Streaming transcript from agent - accumulate deltas
      const { agent } = stateRef.current || {};
      const itemId = event.item_id;
      const delta = event.delta || '';
      
      if (itemId && delta) {
        // Accumulate transcript deltas by item_id
        const currentTranscript = transcriptBuffers.current.get(itemId) || '';
        const updatedTranscript = currentTranscript + delta;
        transcriptBuffers.current.set(itemId, updatedTranscript);
        
        if (updatedTranscript.trim().length > 0) {
          chatItem = {
            id: itemId,
            type: CHAT_HISTORY_TYPE.ACTOR,
            date: new Date(),
            text: updatedTranscript,
            interactionId: itemId, // Use item_id directly as the message ID
            isRecognizing: true, // This is a delta, not final
            author: agent?.name,
            source: {
              name: agent?.name || 'Agent',
              isUser: false,
              isAgent: true,
            },
          };
        }
      }
    } else if (eventType === 'response.output_audio_transcript.done' || eventType === 'response.audio_transcript.done') {
      // Final transcript from agent
      const { agent } = stateRef.current || {};
      const itemId = event.item_id;
      const transcriptText = event.transcript || '';
      
      // Clear the buffer for this item
      if (itemId) {
        transcriptBuffers.current.delete(itemId);
      }
      
      if (transcriptText.trim().length > 0) {
        chatItem = {
          id: itemId,
          type: CHAT_HISTORY_TYPE.ACTOR,
          date: new Date(),
          text: transcriptText,
          interactionId: itemId, // Use item_id directly as the message ID
          isRecognizing: false, // Final transcript
          author: agent?.name,
          source: {
            name: agent?.name || 'Agent',
            isUser: false,
            isAgent: true,
          },
        };
      }
    } else if (eventType === 'input_audio_buffer.speech_started') {
      console.log('🎤 User started speaking');
    } else if (eventType === 'input_audio_buffer.speech_stopped') {
      // User's speech has been detected and processed (VAD detected end of speech)
      const speechCompleteTimestamp = Date.now();
      console.log('🎤 User speech stopped', event);

      // Track speech completion - we'll get the interaction ID from conversation.item.added
      // For now, we'll update it when conversation.item.added arrives
    } else if (eventType === 'conversation.item.added') {
      // User message item added (from speech or text)
      // This is the event the server actually sends
      const item = event.item;
      if (item?.type === 'message' && item.role === 'user') {
        // Extract text from content array
        // Content can have text or transcript fields
        const textContent = item.content?.map((c: any) => c.text || c.transcript || '').join('') || '';
        const trimmedText = textContent.trim();
        const itemId = item.id;
        const userName = stateRef.current?.userName || 'User';
        
        if (trimmedText.length > 0) {
          const formattedText = formatAudioTranscript(trimmedText, true);
          chatItem = {
            id: itemId || v4(),
            type: CHAT_HISTORY_TYPE.ACTOR,
            date: new Date(),
            text: formattedText,
            interactionId: itemId, // Use item.id directly as the message ID
            isRecognizing: false,
            author: userName,
            source: {
              name: userName,
              isUser: true,
              isAgent: false,
            },
          };

          console.log('👤 User message added to chat:', formattedText);
          console.log('👤 User message item_id:', itemId);
          // Note: Latency will be calculated when assistant response arrives (using assistant's item_id)
        }
      }
    } else if (eventType === 'response.created') {
      // response.created event - no matching needed, item_id will come in subsequent events
      const responseId = event.response?.id || event.response_id;
      currentInteractionId.current = responseId;
      console.log('📝 Response created:', responseId);
    } else if (eventType === 'response.done') {
      // Response is complete - ensure any recognizing messages are marked as final
      const itemId = event.item_id;
      console.log('✅ Response done, item_id:', itemId);
      
      if (itemId) {
        // Clear any transcript buffer for this item
        transcriptBuffers.current.delete(itemId);
        
        // Update any recognizing messages for this item to be final
        setChatHistory((currentState) => {
          const hasRecognizingMessage = currentState.some(
            (item) =>
              item.type === CHAT_HISTORY_TYPE.ACTOR &&
              item.id === itemId &&
              item.isRecognizing === true &&
              item.source.isAgent
          );
          
          if (hasRecognizingMessage) {
            // Update existing recognizing messages to be final
            return currentState.map((item) => {
              if (
                item.type === CHAT_HISTORY_TYPE.ACTOR &&
                item.id === itemId &&
                item.isRecognizing === true &&
                item.source.isAgent
              ) {
                // Mark as final (not recognizing anymore)
                return {
                  ...item,
                  isRecognizing: false,
                };
              }
              return item;
            });
          }
          return currentState;
        });
      }
    } else if (eventType === 'response.cancelled') {
      console.log('🛑 Response cancelled: stopping audio playback');
      player.stop();
    } else if (eventType === 'error') {
      // Stop recording if active when any error occurs
      if (stopRecordingRef.current) {
        console.log('🛑 Stopping recording due to error');
        stopRecordingRef.current();
      }

      const errorMessage = event.error?.message || event.error || 'Something went wrong';
      toast.error(errorMessage);
    }

    if (chatItem) {
      setChatHistory((currentState) => {
        let newState = undefined;

        // Find messages by their unique id (item_id from API)
        // For partial/recognizing messages, find by id + isRecognizing to update as it streams
        let currentHistoryIndex = -1;
        if (
          chatItem.type === CHAT_HISTORY_TYPE.ACTOR &&
          chatItem.isRecognizing
        ) {
          // Find existing recognizing message with same id
          currentHistoryIndex = currentState.findIndex((item) => {
            return (
              item.type === CHAT_HISTORY_TYPE.ACTOR &&
              item.id === chatItem?.id &&
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
              item.id === chatItem?.id &&
              item.isRecognizing === true &&
              item.source?.isAgent === chatItem?.source?.isAgent
            );
          });

          if (partialIndex >= 0) {
            // Replace the partial message with the final one
            currentHistoryIndex = partialIndex;
          } else {
            // Otherwise, find by id
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

    // Build connection URL and protocols

    const wsUrl = `${config.REALTIME_API_URL}/session?key=${key}&protocol=realtime`;
    
    // Always send authentication if API key is configured
    // This ensures the server always has credentials for Inworld API calls
    const shouldSendAuth = config.INWORLD_API_KEY && config.INWORLD_API_KEY.trim();
    
    // Remove all base64 padding (=) characters as they're invalid in WebSocket subprotocols
    const protocols = shouldSendAuth
      ? [`basic_${config.INWORLD_API_KEY.replace(/=/g, '')}`]
      : undefined;
    
    console.log('🔌 Connecting to:', wsUrl);
    if (protocols) {
      console.log('🔐 Using authentication subprotocol:', protocols[0].substring(0, 20) + '...');
    } else {
      console.log('⚠️  No API key configured - connecting without authentication');
    }

    // Validate WebSocket URL format
    if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      console.error('❌ Invalid WebSocket URL format:', wsUrl);
      toast.error('Invalid WebSocket URL. Must start with ws:// or wss://');
      setChatting(false);
      return;
    }

    let ws: WebSocket;
    try {
      console.log('🔌 Creating WebSocket connection...');
      console.log('   URL:', wsUrl);
      console.log('   Protocols:', protocols || 'none');
      
      ws = protocols
        ? new WebSocket(wsUrl, protocols)
        : new WebSocket(wsUrl);
      
      console.log('✅ WebSocket object created, readyState:', ws.readyState);
    } catch (error) {
      console.error('❌ Failed to create WebSocket:', error);
      toast.error(`Failed to create WebSocket: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setChatting(false);
      return;
    }

    // Add error handler for WebSocket connection failures
    ws.addEventListener('error', (error) => {
      console.error('❌ WebSocket error event:', error);
      console.error('WebSocket readyState:', ws.readyState);
      console.error('WebSocket URL:', wsUrl);
      toast.error('Failed to establish WebSocket connection. Check console for details.');
      setChatting(false);
    });

    // Add close handler to detect unexpected disconnections
    ws.addEventListener('close', (event) => {
      console.log('🔌 WebSocket closed:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      
      // Stop recording if active when connection closes
      if (stopRecordingRef.current) {
        console.log('🛑 Stopping recording due to WebSocket close');
        stopRecordingRef.current();
      }
      
      if (event.code === 1008) {
        console.error('❌ WebSocket closed: Session not found or invalid');
        toast.error('Session not found. Please try again.');
        setChatting(false);
      } else if (event.code === 1006) {
        console.error('❌ WebSocket closed abnormally (1006). Possible causes:');
        console.error('  - Network connectivity issues');
        console.error('  - Server not reachable');
        console.error('  - Authentication failed');
        console.error('  - CORS issues');
        toast.error('Connection closed abnormally. Check console for details.');
        setChatting(false);
      } else if (event.code === 1002) {
        console.error('❌ WebSocket closed: Protocol error (1002)');
        toast.error('Protocol error. Check authentication configuration.');
        setChatting(false);
      } else if (event.code === 1011) {
        // Server error (e.g., JS Call Timeout)
        console.error('❌ WebSocket closed: Server error (1011)');
        console.error('Reason:', event.reason || 'No reason provided');
        toast.error(event.reason || 'Server error. Connection closed.');
        setChatting(false);
      } else if (!event.wasClean) {
        console.error(
          '❌ WebSocket closed unexpectedly:',
          `Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`,
        );
        toast.error(`Connection closed: ${event.reason || `Code ${event.code}`}`);
        setChatting(false);
      } else {
        // Even if wasClean is true, if we're still in chatting state, we should return to settings
        // This handles cases where the server cleanly closes the connection (e.g., timeout)
        if (stateRef.current.chatting) {
          console.log('🔌 WebSocket closed cleanly, returning to settings');
          setChatting(false);
        }
      }
    });

    // Handle WebSocket open - send session.update event
    ws.addEventListener('open', () => {
      console.log('✅ WebSocket connected successfully');
      console.log('📡 Selected protocol:', ws.protocol || 'none');
      console.log('📡 Ready state:', ws.readyState);
      
      // Send session.update with configuration
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          output_modalities: ['text', 'audio'],
          instructions: agent?.systemPrompt || 'You are a helpful assistant.',
          audio: {
            input: {
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'medium', // 'low' | 'medium' | 'high'
                create_response: true,
                interrupt_response: false,
              },
              transcription: {
                model: 'gpt-4o-mini-transcribe',
              },
            },
            output: {
              voice: voiceId || 'Alex',
            },
          },
        },
      };

      console.log('📤 Sending session.update:', JSON.stringify(sessionUpdate, null, 2));
      
      try {
        ws.send(JSON.stringify(sessionUpdate));
        console.log('✅ session.update sent successfully');
      } catch (error) {
        console.error('❌ Failed to send session.update:', error);
        toast.error('Failed to send session configuration');
        setChatting(false);
        return;
      }
      
      // Set agent info if available
      if (agent) {
        setAgent(agent as Agent);
      }
      
      onOpen();
    });

    setConnection(ws);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('disconnect', onDisconnect);
  }, [formMethods, onDisconnect, onMessage, onOpen]);

  const stopChatting = useCallback(async () => {
    // Stop recording first (before closing connection)
    if (stopRecordingRef.current) {
      console.log('🛑 Stopping recording before closing connection');
      stopRecordingRef.current();
    }

    // Disable flags
    setChatting(false);
    setOpen(false);

    // Stop audio playing
    player.stop();

    // Clear collections (only when fully exiting to config)
    setChatHistory([]);
    setLatencyData([]);
    transcriptBuffers.current.clear();

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
      <Layout>{initialized ? content : ''}</Layout>
    </FormProvider>
  );
}

export default App;
