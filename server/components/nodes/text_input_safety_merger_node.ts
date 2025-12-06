import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';

import { State } from '../../types';

/**
 * TextInputSafetyMergerNode merges State with SafetyResult.
 *
 * This node:
 * - Receives State (from TextInputStateUpdaterNode) and SafetyResult (from safety subgraph)
 * - Merges them into State with an isSafe property
 * - Returns State with isSafe for conditional routing
 */
export class TextInputSafetyMergerNode extends CustomNode {
  process(
    _context: ProcessContext,
    state: State,
    safetyResult?: GraphTypes.SafetyResult,
  ): State & { isSafe: boolean } {
    // Return state with safety property (default to safe if no safety result provided)
    return {
      ...state,
      isSafe: safetyResult?.isSafe ?? true,
    };
  }
}

