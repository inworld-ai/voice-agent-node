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
- For voice cloning: API key must have write permissions and `INWORLD_WORKSPACE` must be set

## Get Started

### Step 1: Clone the Repository

```bash
git clone https://github.com/inworld-ai/voice-agent-node
cd voice-agent-node
```

### Step 2: Install Dependencies

This project uses npm workspaces. Install all dependencies from the root:

```bash
npm install
```

This will install dependencies for both the `app` (Next.js frontend) and `realtime-api` (backend server) workspaces.

### Step 3: Configure Realtime API Environment Variables

Copy `realtime-api/.env.example` to `realtime-api/.env` and fill in the required variables:

**Required:**
- `INWORLD_API_KEY` - Get your API key from the [Inworld Portal](https://platform.inworld.ai/)
- `ASSEMBLYAI_API_KEY` - Get your API key from [Assembly.AI](https://www.assemblyai.com/) (required for speech-to-text functionality)

See `realtime-api/.env.example` for detailed comments and examples.

### Step 4: Configure App Environment Variables

Copy `app/.env.local.example` to `app/.env.local` and fill in the required variables:

**Required:**
- `INWORLD_API_KEY` - Single API key used for both client and server (automatically exposed to client via Next.js config)
- `INWORLD_WORKSPACE` - Your Inworld workspace name (required for voice cloning, automatically exposed to client)
- `CHARACTER_GENERATION_LLM_PROVIDER` - LLM provider for character generation (default: `groq`)
- `CHARACTER_GENERATION_LLM_MODEL_NAME` - Model name for character generation (default: `llama-3.3-70b-versatile`)

See `app/.env.local.example` for detailed comments and examples.

### Step 5: Run the Application

You can run both services together using the workspace scripts:

```bash
# Run both app and realtime-api together
npm run dev:all
```

Or run them separately in different terminals:

```bash
# Terminal 1: Start the Realtime API Server
npm run dev:api
```

The server will start on port 4000.

```bash
# Terminal 2: Start the Next.js App
npm run dev:app
```

The app will start on port 3000 and should automatically open in your default browser. It's possible that port 3000 is already in use, so the next available port will be used.

### Step 6: Configure and Use the Application

1. Define the agent settings:
   - Enter the agent system prompt (instructions)
   - Click "Create Agent"

2. Interact with the agent:
   - For voice input, click the microphone icon to unmute yourself. Click again to mute yourself.
   - For text input, enter text in the input field and press Enter to send it to the agent
  
## Repo Structure

```
voice-agent-node/
├── realtime-api/                    # Backend: OpenAI Realtime API + Inworld Graph Framework
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
│   ├── .env.example                 # Environment variables template
│   └── package.json
├── app/                              # Frontend Next.js application
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/                # Next.js API routes
│   │   │   │   ├── clone-voice/    # Voice cloning endpoint
│   │   │   │   └── generate-character/  # Character generation endpoint
│   │   │   ├── chat/               # Chat UI components
│   │   │   ├── configuration/     # Agent configuration UI
│   │   │   ├── components/         # Shared components
│   │   │   ├── layout.tsx         # Root layout
│   │   │   └── page.tsx           # Main page
│   │   ├── lib/                    # Server-side utilities
│   │   │   ├── characterGenerator.ts  # Character generation logic
│   │   │   └── prompts/           # Prompt templates
│   │   └── config.ts
│   ├── .env.local.example
│   └── package.json
├── package.json                      # Root workspace configuration
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

For detailed API documentation, see [REALTIME_API.md](realtime-api/REALTIME_API.md).

### STT Provider

The server uses **Assembly.AI** as the Speech-to-Text provider, which provides high accuracy with built-in speech segmentation and semantic VAD (Voice Activity Detection).

## Workspace Scripts

The root `package.json` provides convenient scripts to manage both workspaces:

- `npm run dev:all` - Run both app and realtime-api together
- `npm run dev:app` - Run only the Next.js app
- `npm run dev:api` - Run only the realtime API server
- `npm run build:all` - Build both workspaces
- `npm run build:app` - Build only the app
- `npm run build:api` - Build only the realtime-api
- `npm run lint:app` - Lint the app
- `npm run lint:api` - Lint the realtime-api

## Troubleshooting

- If you encounter connection issues, ensure both realtime-api and app are running. The realtime-api should be running on port 4000 and the app can be running on port 3000 or any other port.
- Check that your API keys are valid and properly set in the `.env` files:
  - **Realtime API** (`realtime-api/.env`): 
    - `INWORLD_API_KEY` - Required for Inworld services
    - `ASSEMBLYAI_API_KEY` - Required for speech-to-text functionality (note: `ASSEMBLYAI_API_KEY`, not `ASSEMBLY_AI_API_KEY`)
  - **App** (`app/.env.local`): 
    - `INWORLD_API_KEY` - Single API key for all Inworld services (automatically exposed to client)
    - `INWORLD_WORKSPACE` - Required for voice cloning (automatically exposed to client)
    - `CHARACTER_GENERATION_LLM_PROVIDER` - LLM provider for character generation (default: `groq`)
    - `CHARACTER_GENERATION_LLM_MODEL_NAME` - Model name for character generation (default: `llama-3.3-70b-versatile`)
    - `NEXT_PUBLIC_REALTIME_API_URL` - WebSocket URL (default: `ws://localhost:4000`)
- For voice input issues, ensure your browser has microphone permissions.
- The server uses the OpenAI Realtime API protocol. Ensure your client is sending the correct event types (see [REALTIME_API.md](realtime-api/REALTIME_API.md) for details).
- If you see WebSocket connection errors, verify that:
  - The server is running on the correct port (default: 4000)
  - If `AUTH_TOKEN` is set in realtime-api `.env`, include it in the query string: `ws://localhost:4000/session?token=YOUR_TOKEN`
- **Voice Cloning Issues**:
  - Ensure your `INWORLD_API_KEY` has write permissions in Inworld Studio
  - Set `INWORLD_WORKSPACE` in your `app/.env.local` file to your Inworld workspace name
  - Voice cloning will fail with an error if the workspace is not configured

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
