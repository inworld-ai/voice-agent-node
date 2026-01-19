/**
 * Character Generator - AI-powered character/persona generation
 * Uses Inworld's RemoteLLMChatNode via a singleton graph (initialized once at startup)
 */

import {
  GraphBuilder,
  RemoteLLMChatNode,
  CustomNode,
  ProcessContext,
  GraphTypes,
  Graph,
} from '@inworld/runtime/graph';

import { DEFAULT_LLM_MODEL_NAME, DEFAULT_PROVIDER } from '../constants';
import { getCharacterGenerationPrompt, VALID_VOICE_IDS } from './prompts/character_generation';

// Singleton graph instance - created once and reused
let characterGenerationGraph: Graph | null = null;
let graphInitPromise: Promise<Graph> | null = null;

// Custom node to format the prompt for character generation
class CharacterPromptNode extends CustomNode {
  process(_context: ProcessContext, input: { description: string }): GraphTypes.LLMChatRequest {
    const prompt = getCharacterGenerationPrompt(input.description);
    return new GraphTypes.LLMChatRequest({
      messages: [
        {
          role: 'system',
          content: 'You are a helpful character creator for voice-based AI applications. Always output valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
  }
}

// Initialize the singleton graph (called once)
async function initCharacterGenerationGraph(apiKey: string): Promise<Graph> {
  const promptNode = new CharacterPromptNode({
    id: 'character-prompt-node',
  });

  const llmNode = new RemoteLLMChatNode({
    id: 'character-llm-node',
    provider: process.env.LLM_PROVIDER || DEFAULT_PROVIDER,
    modelName: process.env.LLM_MODEL_NAME || DEFAULT_LLM_MODEL_NAME,
    stream: false,
    textGenerationConfig: {
      maxNewTokens: 2000,
      maxPromptLength: 4000,
      repetitionPenalty: 1,
      topP: 0.9,
      temperature: 0.7,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  });

  const graphBuilder = new GraphBuilder({
    id: 'character-generation-graph',
    apiKey,
    enableRemoteConfig: false,
  });

  graphBuilder
    .addNode(promptNode)
    .addNode(llmNode)
    .addEdge(promptNode, llmNode)
    .setStartNode(promptNode)
    .setEndNode(llmNode);

  return graphBuilder.build();
}

// Get or create the singleton graph
async function getCharacterGraph(): Promise<Graph> {
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    throw new Error('INWORLD_API_KEY is required for character generation.');
  }

  // If already initialized, return it
  if (characterGenerationGraph) {
    return characterGenerationGraph;
  }

  // If initialization is in progress, wait for it
  if (graphInitPromise) {
    return graphInitPromise;
  }

  // Initialize the graph (only happens once)
  console.log('Initializing character generation graph (singleton)...');
  graphInitPromise = initCharacterGenerationGraph(apiKey);
  characterGenerationGraph = await graphInitPromise;
  console.log('✓ Character generation graph initialized');
  
  return characterGenerationGraph;
}

// Main generation function - reuses the singleton graph
export async function generateCharacterPrompt(
  description: string,
): Promise<{ name: string; voiceId: string; systemPrompt: string }> {
  console.log('Using Inworld LLM for character generation...');
  
  const graph = await getCharacterGraph();
  
  // Note: We do NOT call graph.stop() - the graph stays alive for reuse
  const { outputStream } = await graph.start({ description });
  
  // Collect the full response from the stream
  let responseText = '';
  for await (const result of outputStream) {
    const data = (result as any)?.data;
    if (typeof data === 'string') {
      responseText += data;
    } else if (data?.text) {
      responseText += data.text;
    } else if (data?.content) {
      responseText += data.content;
    }
  }

  // Extract JSON from response
  if (responseText.includes('{') && responseText.includes('}')) {
    responseText = responseText.slice(
      responseText.indexOf('{'),
      responseText.lastIndexOf('}') + 1,
    );
  }

  const result = JSON.parse(responseText);
  
  console.log('Parsed character result:', {
    name: result.name,
    voiceId: result.voiceId,
    systemPromptType: typeof result.systemPrompt,
    systemPromptLength: typeof result.systemPrompt === 'string' ? result.systemPrompt.length : 'N/A'
  });
  
  const voiceId = VALID_VOICE_IDS.includes(result.voiceId) ? result.voiceId : 'Olivia';
  
  let systemPrompt = result.systemPrompt;
  if (typeof systemPrompt !== 'string') {
    console.warn('systemPrompt is not a string, converting:', typeof systemPrompt);
    systemPrompt = JSON.stringify(systemPrompt);
  }
  
  return {
    name: result.name || 'Generated Character',
    voiceId,
    systemPrompt: systemPrompt || '',
  };
}
