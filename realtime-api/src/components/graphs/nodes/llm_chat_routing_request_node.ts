import {CustomNode, Graph, GraphTypes, ProcessContext} from '@inworld/runtime/graph';
import logger from '../../../logger';

import { State } from '../../../types/index';

/**
 * LLMChatRoutingRequestNode builds a LLM chat request from the state.
 *
 * This node:
 * - Receives the current conversation state
 * - Converts state messages to LLM message format
 * - Returns a formatted LLMChatRequest for the LLM node
 */
export class LLMChatRoutingRequestNode extends CustomNode {
  process(_context: ProcessContext, state: State): GraphTypes.LLMChatRoutingRequest {
    try {
      logger.debug({ messageCount: state.messages?.length }, `LLMChatRoutingRequestNode start: ${state.messages?.length || 0} messages`);

      // Convert state messages to LLMMessageInterface format
      // Filter out messages with empty content
      const conversationMessages = state.messages
        .filter((msg) => {
          if (!msg) {
            logger.warn('LLMChatRoutingRequestNode - Found undefined message in state');
            return false;
          }
          // Filter out messages with empty content
          if (!msg.content || msg.content.trim() === '') {
            logger.debug({ messageId: msg.id }, 'LLMChatRoutingRequestNode - Filtering out empty message');
            return false;
          }
          return true;
        })
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      const request: any = {
        messages: conversationMessages,
        stream: true
      };

      if (state.tools && Array.isArray(state.tools) && state.tools.length > 0) {
        logger.debug({ toolCount: state.tools.length }, `LLMChatRoutingRequestNode processing ${state.tools.length} tools`);

        // Transform OpenAI Realtime API format to Inworld SDK format
        // OpenAI Realtime API: { type: 'function', name, description, parameters }
        // Inworld SDK: { name, description, properties }
        // The key difference: 'parameters' -> 'properties' (which is now a stringified JSON)
        request.tools = state.tools
          .filter((t: any) => t != null && typeof t === 'object')
          .map((tool: any) => {
            if (tool.type === 'function' && tool.name) {
              return {
                name: tool.name,
                description: tool.description,
                properties: JSON.stringify(tool.parameters || {}),
              };
            }
            // If already in Inworld format or unknown, pass through
            return tool;
          });

        logger.debug({ toolCount: request.tools.length }, `LLMChatRoutingRequestNode converted ${request.tools.length} tools to Inworld format`);

        // Handle toolChoice - ensure it's in the right format
        if (state.toolChoice) {
          if (typeof state.toolChoice === 'string') {
            request.toolChoice = { type: state.toolChoice };
          } else {
            request.toolChoice = state.toolChoice;
          }
        } else {
          request.toolChoice = { type: 'auto' };
        }

        logger.debug({ toolChoice: request.toolChoice }, `LLMChatRoutingRequestNode tool choice: ${request.toolChoice}`);
      }

      // Configure model selection from state
      if (state.modelId) {
        request.modelId = state.modelId;
      }
      else {
        request.modelId = {provider: "google", modelName: "gemini-2.5-flash"}; // HARDCODE: Must be specified for now
      }

      if (state.modelSelection) {
        request.modelSelection = state.modelSelection; // Contains model selection, exclusion and sorting strategy
      }

      if (state.textGenerationConfig) {
        request.textGenerationConfig = state.textGenerationConfig;
      }


      logger.debug({
        messageCount: conversationMessages.length,
        modelId: request.modelId,
        modelSelection: request.modelSelection,
        textGenerationConfig: request.textGenerationConfig
      }, `LLMChatRoutingRequestNode final request: ${conversationMessages.length} messages`);

      return new GraphTypes.LLMChatRoutingRequest(request);
    } catch (error) {
      logger.error({ err: error }, 'LLMChatRoutingRequestNode fatal error');
      throw error;
    }
  }
}
