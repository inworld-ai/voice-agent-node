import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { TextInput } from '../../types';

/**
 * TextInputSafetyExtractorNode extracts text from TextInput for safety checking.
 *
 * This node:
 * - Receives TextInput
 * - Extracts the text property
 * - Returns it as a string for safety checking nodes
 */
export class TextInputSafetyExtractorNode extends CustomNode {
  process(
    _context: ProcessContext,
    textInput: TextInput,
  ): string {
    return textInput.text;
  }
}

