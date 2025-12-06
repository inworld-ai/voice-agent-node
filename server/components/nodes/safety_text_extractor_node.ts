import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

/**
 * SafetyTextExtractorNode extracts text from SafetyResult for downstream nodes.
 *
 * This node:
 * - Receives SafetyResult
 * - Extracts the text property
 * - Returns it as a string for downstream nodes like TextChunkingNode
 */
export class SafetyTextExtractorNode extends CustomNode {
  process(
    _context: ProcessContext,
    input: GraphTypes.SafetyResult,
  ): string {
    if (!input.isSafe) {
      throw new Error(
        'SafetyTextExtractorNode should only receive safe SafetyResult',
      );
    }
    return input.text;
  }
}


