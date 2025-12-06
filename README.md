# Voice Agent Application

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Powered by Inworld AI](https://img.shields.io/badge/Powered_by-Inworld_AI-orange)](https://inworld.ai/runtime)
[![Documentation](https://img.shields.io/badge/Documentation-Read_Docs-blue)](https://docs.inworld.ai/docs/node/overview)
[![Model Providers](https://img.shields.io/badge/Model_Providers-See_Models-purple)](https://docs.inworld.ai/docs/models#llm)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Try_It_Now-brightgreen)](https://voice-agent-client-dlvldu24na-uc.a.run.app)

This application demonstrates a simple chat interface with an AI agent that can respond to text and voice inputs, powered by Inworld AI Runtime.

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
   - Enter the agent system prompt
   - Select an Speech to Text service
   - Click "Create Agent"

2. Interact with the agent:
   - For voice input, click the microphone icon to unmute yourself. Click again to mute yourself.
   - For text input, enter text in the input field and press Enter to send it to the agent
  
## Repo Structure

```
voice-agent-node/
├── server/                       # Backend handling Inworld's LLM, STT, and TTS services
│   ├── components/
│   │   ├── graph.ts              # Main graph-based pipeline orchestration
│   │   ├── stt_graph.ts          # Speech-to-text graph configuration
│   │   ├── message_handler.ts    # WebSocket message handling
│   │   ├── audio_handler.ts      # Audio stream processing
│   │   └── nodes/                # Graph node implementations (STT, LLM, TTS processing)
│   ├── models/
│   │   └── silero_vad.onnx       # VAD model for voice activity detection
│   ├── index.ts                  # Server entry point
│   ├── package.json
│   └── tsconfig.json
├── client/                       # Frontend React application
│   ├── src/
│   │   ├── app/                  # UI components (chat, configuration, shared components)
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── public/
│   ├── package.json
│   └── vite.config.mts
├── constants.ts
└── LICENSE
```

## Architecture

The voice agent server uses Inworld's Graph Framework with two main processing pipelines:

### Pipeline Overview

```mermaid
---
config:
  layout: dagre
---
flowchart TB
 subgraph STT["Assembly.AI STT Pipeline"]
        AssemblyAI["AssemblyAI STT"]
        TranscriptExtractor["TranscriptExtractor"]
        SpeechNotif1["SpeechCompleteNotifier<br>terminal node"]
  end
 subgraph AUDIO["AUDIO INPUT PIPELINE (withAudioInput=true)"]
        AudioInput["AudioInput"]
        STT
        InteractionQueue["InteractionQueue"]
  end
 subgraph TEXT["TEXT INPUT PATH (common for both audio and text)"]
        TextInput["TextInput"]
        TextInputSafetyExt["TextInputSafetyExtractor"]
        InputSafety["Input Safety Subgraph"]
        TextInputStateUpdater["TextInputStateUpdater"]
        TextInputMerger["TextInputSafetyMerger"]
        DialogPrompt["DialogPromptBuilder"]
        LLM["LLM"]
        TextAgg["TextAggregator"]
        OutputSafety["Output Safety Subgraph"]
        SafetyTextExt["SafetyTextExtractor"]
        InputCanned["Input Safety<br>Canned Response"]
        OutputCanned["Output Safety<br>Canned Response"]
  end
 subgraph OUTPUT["TTS OUTPUT & STATE"]
        ResponseAgg["ResponseAggregatorProxy"]
        TextChunk["TextChunking"]
        TTS["TTS<br>end"]
        StateUpdate["StateUpdate"]
  end
    AssemblyAI -- interaction_complete --> TranscriptExtractor & SpeechNotif1
    AssemblyAI -- "stream_exhausted!=true<br>loop optional" --> AssemblyAI
    AudioInput --> STT
    TranscriptExtractor --> InteractionQueue
    InteractionQueue -- text exists --> TextInput
    TextInput --> TextInputSafetyExt & TextInputStateUpdater
    TextInputSafetyExt --> InputSafety
    TextInputStateUpdater --> TextInputMerger
    InputSafety --> TextInputMerger
    TextInputMerger -- "isSafe=true" --> DialogPrompt
    TextInputMerger -- "isSafe=false" --> InputCanned
    InputCanned --> ResponseAgg
    DialogPrompt --> LLM
    LLM --> TextAgg
    TextAgg --> OutputSafety
    OutputSafety -- "isSafe=true" --> SafetyTextExt
    OutputSafety -- "isSafe=false" --> OutputCanned
    SafetyTextExt --> ResponseAgg
    OutputCanned --> ResponseAgg
    ResponseAgg --> TextChunk & StateUpdate
    TextChunk --> TTS
    StateUpdate -. loop optional .-> InteractionQueue

    style SpeechNotif1 fill:#f9f,stroke:#333,stroke-width:2px
    style InputSafety fill:#ff9,stroke:#333,stroke-width:2px
    style OutputSafety fill:#ff9,stroke:#333,stroke-width:2px
    style TTS fill:#9f9,stroke:#333,stroke-width:2px
```

### STT Provider

The server uses **Assembly.AI** as the Speech-to-Text provider, which provides high accuracy with built-in speech segmentation.

## Safety Features

The voice agent includes built-in safety filtering to detect and block inappropriate content. See [SAFETY.md](SAFETY.md) for detailed information on configuring and using safety features.

## Troubleshooting

- If you encounter connection issues, ensure both server and client are running. Server should be running on port 4000 and client can be running on port 3000 or any other port.
- Check that your API keys are valid and properly set in the `.env` file:
  - `INWORLD_API_KEY` - Required for Inworld services
  - `ASSEMBLY_AI_API_KEY` - Required for speech-to-text functionality
- For voice input issues, ensure your browser has microphone permissions.

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
