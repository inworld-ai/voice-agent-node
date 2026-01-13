# Voice Agent Application

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Powered by Inworld AI](https://img.shields.io/badge/Powered_by-Inworld_AI-orange)](https://inworld.ai/runtime)
[![Documentation](https://img.shields.io/badge/Documentation-Read_Docs-blue)](https://docs.inworld.ai/docs/node/overview)
[![Model Providers](https://img.shields.io/badge/Model_Providers-See_Models-purple)](https://docs.inworld.ai/docs/models#llm)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Try_It_Now-brightgreen)](https://voice-agent-client-dlvldu24na-uc.a.run.app)

This application demonstrates a simple chat interface with an AI agent that can respond to text and voice inputs, powered by Inworld AI Runtime. The server implements the **OpenAI Realtime API protocol** for WebSocket-based real-time voice and audio interactions.

## Prerequisites

- Node.js 20 or higher
- Assembly.AI API key (required for speech-to-text functionality)
- Inworld API key (required)

## Get Started

### Step 1: Clone the Repository

```bash
git clone https://github.com/inworld-ai/voice-agent-node
cd voice-agent-node
```

### Step 2: Configure Server Environment Variables

Copy `server/.env-sample` to `server/.env` and fill all required variables. Some variables are optional and can be left empty. In this case default values will be used.

Get your API key from the [Inworld Portal](https://platform.inworld.ai/).

### Step 3: Configure Client Environment Variables (Optional)

The client supports optional environment variables to customize its behavior. Create a `.env` file in the `client` directory if you want to override defaults:

- `VITE_ENABLE_LATENCY_REPORTING` - Set to `true` to enable latency reporting in the UI (shows latency chart and latency badges on agent messages). Default: `false`
- `VITE_APP_PORT` - Server port to connect to. Default: `4000`
- `VITE_APP_LOAD_URL` - Custom load endpoint URL
- `VITE_APP_UNLOAD_URL` - Custom unload endpoint URL
- `VITE_APP_SESSION_URL` - Custom session WebSocket URL

### Step 4: Install Dependencies and Run

Install dependencies for both server and client:

```bash
# Install server dependencies
cd server
npm install

# Start the server
npm start
```

The server will start on port 4000.

```bash
# Install client dependencies
cd ../client
npm install
npm start
```

The client will start on port 3000 and should automatically open in your default browser. It's possible that port 3000 is already in use, so the next available port will be used.

### Step 5: Configure and Use the Application

1. Define the agent settings:
   - Enter the agent system prompt (instructions)
   - Click "Create Agent"

2. Interact with the agent:
   - For voice input, click the microphone icon to unmute yourself. Click again to mute yourself.
   - For text input, enter text in the input field and press Enter to send it to the agent
  
## Repo Structure

```
voice-agent-node/
├── server/                          # Backend: OpenAI Realtime API + Inworld Graph Framework
│   ├── src/
│   │   ├── components/
│   │   │   ├── realtime/           # Realtime API protocol implementation
│   │   │   │   ├── realtime_message_handler.ts
│   │   │   │   ├── realtime_session_manager.ts
│   │   │   │   └── realtime_event_factory.ts
│   │   │   ├── audio/              # Audio stream processing
│   │   │   │   ├── realtime_audio_handler.ts
│   │   │   │   └── multimodal_stream_manager.ts
│   │   │   ├── graphs/             # Graph pipeline orchestration
│   │   │   │   ├── graph.ts
│   │   │   │   ├── realtime_graph_executor.ts
│   │   │   │   └── nodes/          # Graph nodes (STT, LLM, TTS, etc.)
│   │   │   ├── app.ts
│   │   │   └── runtime_app_manager.ts
│   │   ├── types/                  # TypeScript definitions
│   │   ├── index.ts                # Server entry point
│   │   └── config.ts
│   ├── REALTIME_API.md             # OpenAI Realtime API documentation
│   ├── .env-sample                 # Environment variables template
│   └── package.json
├── client/                          # Frontend React application
│   ├── src/
│   │   ├── app/
│   │   │   ├── chat/               # Chat UI components
│   │   │   ├── configuration/     # Agent configuration UI
│   │   │   └── components/        # Shared components
│   │   ├── App.tsx
│   │   └── config.ts
│   ├── .env-sample
│   └── package.json
└── LICENSE
```

### Protocol & API

The server implements the **OpenAI Realtime API protocol** for all WebSocket connections. This provides a standardized interface for real-time voice interactions, compatible with OpenAI's Realtime API specification.

**Key Features:**
- OpenAI Realtime API compatible protocol
- Session management via `session.update` events
- Support for audio input/output, text messages, and conversation management
- Server-side Voice Activity Detection (VAD) with configurable eagerness levels
- Streaming audio and transcript responses

For detailed API documentation, see [REALTIME_API.md](server/REALTIME_API.md).

### STT Provider

The server uses **Assembly.AI** as the Speech-to-Text provider, which provides high accuracy with built-in speech segmentation and semantic VAD (Voice Activity Detection).

## Troubleshooting

- If you encounter connection issues, ensure both server and client are running. Server should be running on port 4000 and client can be running on port 3000 or any other port.
- Check that your API keys are valid and properly set in the `.env` file:
  - `INWORLD_API_KEY` - Required for Inworld services
  - `ASSEMBLYAI_API_KEY` - Required for speech-to-text functionality (note: `ASSEMBLYAI_API_KEY`, not `ASSEMBLY_AI_API_KEY`)
- For voice input issues, ensure your browser has microphone permissions.
- The server uses the OpenAI Realtime API protocol. Ensure your client is sending the correct event types (see [REALTIME_API.md](server/REALTIME_API.md) for details).
- If you see WebSocket connection errors, verify that the session key is provided in the query string: `ws://localhost:4000/session?key=YOUR_SESSION_KEY`

**Bug Reports**: [GitHub Issues](https://github.com/inworld-ai/voice-agent-node/issues)

**General Questions**: For general inquiries and support, please email us at support@inworld.ai

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
