import { SubgraphBuilder, RemoteLLMChatNode } from '@inworld/runtime/graph';
import { LongTermPromptBuilderNode } from '../nodes/memory/long_term/long_term_prompt_builder';
import { LongTermResponseParserNode } from '../nodes/memory/long_term/long_term_response_parser';
import { LongTermMemoryConfig } from '../nodes/memory/memory_types';

export function createLongTermSubgraph(
  id: string,
  config: LongTermMemoryConfig & {
    embedderComponentId: string;
    llmComponentId: string;
    llmProvider: string;
    llmModelName: string;
  },
): SubgraphBuilder {
  const promptBuilder = new LongTermPromptBuilderNode(config);

  const llmNode = new RemoteLLMChatNode({
    id: `${id}_llm`,
    provider: config.llmProvider,
    modelName: config.llmModelName,
    textGenerationConfig: { maxNewTokens: 800, temperature: 0.7 },
  });

  const responseParser = new LongTermResponseParserNode({
    embedderComponentId: config.embedderComponentId,
  });

  return new SubgraphBuilder(id)
    .addNode(promptBuilder)
    .addNode(llmNode)
    .addNode(responseParser)
    .addEdge(promptBuilder, llmNode)
    .addEdge(llmNode, responseParser)
    .setStartNode(promptBuilder)
    .setEndNode(responseParser);
}

