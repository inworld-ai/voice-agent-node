import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { InteractionInfo, State, TextInput } from '../../types';

/**
 * InteractionQueueNode manages the queue of user interactions.
 *
 * This node:
 * - Receives interaction info from STT processing
 * - Manages a queue of interactions to ensure sequential processing
 * - Prevents race conditions when multiple interactions arrive
 * - Returns TextInput when ready to process, or empty when waiting
 *
 * Queue states tracked in datastore:
 * - 'q{id}': Queued interactions waiting to be processed
 * - 'r{id}': Running interactions currently being processed
 * - 'c{id}': Completed interactions
 */
export class InteractionQueueNode extends CustomNode {
  process(
    context: ProcessContext,
    interactionInfo: InteractionInfo,
    state: State,
  ): TextInput {
    console.log('InteractionQueueNode', {
      interactionInfo,
      state,
    });

    const sessionId = interactionInfo.sessionId;

    // ====================================================================
    // STEP 1-3: Store text and analyze queue state
    // ====================================================================
    const dataStore = context.getDatastore();
    const QUEUED_PREFIX = 'q';
    const RUNNING_PREFIX = 'r';
    const COMPLETED_PREFIX = 'c';

    // Register interaction in the queue
    if (!dataStore.has(QUEUED_PREFIX + interactionInfo.interactionId)) {
      // Store queued interaction
      dataStore.add(
        QUEUED_PREFIX + interactionInfo.interactionId,
        interactionInfo.text,
      );
    }

    // Get all keys and categorize them
    const allKeys = dataStore.keys();
    const queuedIds: string[] = [];
    let completedCount = 0;
    let runningCount = 0;

    for (const key of allKeys) {
      if (key.startsWith(QUEUED_PREFIX)) {
        const idStr = key.substring(QUEUED_PREFIX.length);
        queuedIds.push(idStr);
      } else if (key.startsWith(COMPLETED_PREFIX)) {
        completedCount++;
      } else if (key.startsWith(RUNNING_PREFIX)) {
        runningCount++;
      }
    }

    // Sort queued IDs - extract iteration number for sorting
    queuedIds.sort((a, b) => {
      const getIteration = (id: string): number => {
        const hashIndex = id.indexOf('#');
        if (hashIndex === -1) return 0;
        const iter = parseInt(id.substring(hashIndex + 1), 10);
        return isNaN(iter) ? 0 : iter;
      };
      return getIteration(a) - getIteration(b);
    });

    console.log(
      `InteractionQueue: State - ${queuedIds.length} queued, ${completedCount} completed, ${runningCount} running`,
    );

    // ====================================================================
    // STEP 4: Decide if we should start processing the next interaction
    // ====================================================================
    if (queuedIds.length === 0) {
      // No interactions to process yet
      console.log('InteractionQueue: No interactions to process yet');
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
      } as TextInput;
    }

    if (queuedIds.length === completedCount) {
      // All interactions have been processed
      console.log('InteractionQueue: All interactions completed');
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
      } as TextInput;
    }

    // There are unprocessed interactions
    if (runningCount === completedCount) {
      // No interaction is currently running, start the next one
      const nextId = queuedIds[completedCount];
      const runningKey = RUNNING_PREFIX + nextId;

      // Try to mark as running (prevents race conditions)
      if (dataStore.has(runningKey) || !dataStore.add(runningKey, '')) {
        console.log(
          `InteractionQueue: Interaction ${nextId} already started by another evaluation`,
        );
        return {
          text: '',
          sessionId: sessionId,
          interactionId: '',
        } as TextInput;
      }

      const queuedText = dataStore.get(QUEUED_PREFIX + nextId) as string;
      if (!queuedText) {
        console.error(`Failed to retrieve text for interaction ${nextId}`);
        return {
          text: '',
          sessionId: sessionId,
          interactionId: '',
        } as TextInput;
      }

      console.log(
        `InteractionQueue: Starting LLM processing for interaction ${nextId} with text ${queuedText}`,
      );

      return {
        text: queuedText,
        sessionId: sessionId,
        interactionId: nextId,
      } as TextInput;
    } else {
      // An interaction is currently running, wait for it to complete
      console.log(
        `InteractionQueue: Waiting - interaction ${queuedIds[completedCount]} is processing`,
      );
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
      } as TextInput;
    }
  }
}
