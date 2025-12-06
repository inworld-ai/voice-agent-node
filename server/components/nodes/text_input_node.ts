import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { TextInput } from '../../types';

/**
 * TextInputNode is the entry point for text input in the graph.
 * It's a proxy node that passes through the TextInput object.
 *
 * This node:
 * - Receives TextInput (starter node for text input path)
 * - Returns the TextInput object for downstream processing
 */
export class TextInputNode extends CustomNode {
  process(
    _context: ProcessContext,
    textInput: TextInput,
  ): TextInput {
    return textInput;
  }
}

