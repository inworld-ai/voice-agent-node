import {
  SubgraphBuilder,
  RemoteLLMChatNode,
  RemoteLLMComponent,
} from '@inworld/runtime/graph';
import { FlashPromptBuilderNode } from '../nodes/memory/flash/flash_prompt_builder';
import { FlashResponseParserNode } from '../nodes/memory/flash/flash_response_parser';
import { FlashMemoryConfig } from '../nodes/memory/memory_types';

export interface FlashSubgraphConfig extends FlashMemoryConfig {
  llmProvider: string;
  llmModelName: string;
  embedderComponentId: string;
}

export function createFlashSubgraph(
  id: string,
  config: FlashSubgraphConfig,
): SubgraphBuilder {
  const promptBuilder = new FlashPromptBuilderNode(config);

  const llmNode = new RemoteLLMChatNode({
    id: `${id}_llm`,
    provider: config.llmProvider,
    modelName: config.llmModelName,
    textGenerationConfig: { maxNewTokens: 800, temperature: 0.7 },
  });

  const responseParser = new FlashResponseParserNode(config);

  return new SubgraphBuilder(id)
    .addNode(promptBuilder)
    .addNode(llmNode)
    .addNode(responseParser)
    .addEdge(promptBuilder, llmNode)
    .addEdge(llmNode, responseParser)
    .setStartNode(promptBuilder)
    .setEndNode(responseParser);
}

