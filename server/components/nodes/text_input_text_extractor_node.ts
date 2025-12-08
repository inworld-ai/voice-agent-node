import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { TextInput } from '../../types';

/**
 * TextInputTextExtractorNode extracts text from TextInput for downstream processing.
 * This node is used by safety, knowledge, and memory retrieval nodes.
 *
 * This node:
 * - Receives TextInput
 * - Extracts the text property
 * - Returns it as a string for nodes that require text input
 */
export class TextInputTextExtractorNode extends CustomNode {
  process(
    _context: ProcessContext,
    textInput: TextInput,
  ): string {
    return textInput.text;
  }
}

