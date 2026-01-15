/**
 * Character Generator - AI-powered character/persona generation
 * Uses Inworld's RemoteLLMChatNode for LLM calls (same infrastructure as the voice agent)
 */

import {
  GraphBuilder,
  RemoteLLMChatNode,
  CustomNode,
  ProcessContext,
  GraphTypes,
} from '@inworld/runtime/graph';

import { DEFAULT_LLM_MODEL_NAME, DEFAULT_PROVIDER } from '../constants';
import { getCharacterGenerationPrompt, VALID_VOICE_IDS } from './prompts/character_generation';

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

// Create a character generation graph using Inworld's LLM infrastructure
async function createCharacterGenerationGraph(apiKey: string) {
  const promptNode = new CharacterPromptNode({
    id: 'character-prompt-node',
  });

  const llmNode = new RemoteLLMChatNode({
    id: 'character-llm-node',
    provider: process.env.LLM_PROVIDER || DEFAULT_PROVIDER,
    modelName: process.env.LLM_MODEL_NAME || DEFAULT_LLM_MODEL_NAME,
    stream: false, // We want the full response, not streaming
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

// Main generation function using Inworld's LLM infrastructure
export async function generateCharacterPrompt(
  description: string,
  apiKey?: string,
): Promise<{ name: string; voiceId: string; systemPrompt: string }> {
  const inworldApiKey = apiKey || process.env.INWORLD_API_KEY;
  
  if (!inworldApiKey) {
    throw new Error('INWORLD_API_KEY is required for character generation.');
  }

  console.log('Using Inworld LLM for character generation...');
  
  const graph = await createCharacterGenerationGraph(inworldApiKey);
  
  try {
    const { outputStream } = await graph.start({ description });
    
    // Collect the full response from the stream
    let responseText = '';
    for await (const result of outputStream) {
      // Handle the graph output stream response
      // The result contains data from the LLM node
      const data = (result as any)?.data;
      if (typeof data === 'string') {
        responseText += data;
      } else if (data?.text) {
        responseText += data.text;
      } else if (data?.content) {
        responseText += data.content;
      } else if (typeof result === 'string') {
        responseText += result;
      } else {
        // Try to extract text from any nested structure
        const anyResult = result as any;
        if (anyResult?.text) {
          responseText += anyResult.text;
        } else if (anyResult?.content) {
          responseText += anyResult.content;
        }
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
    
    // Validate voiceId against known Inworld voices, default to Olivia if invalid
    const voiceId = VALID_VOICE_IDS.includes(result.voiceId) ? result.voiceId : 'Olivia';
    
    // Ensure systemPrompt is a string
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
  } finally {
    // Clean up the graph
    await graph.stop();
  }
}
