import { formatSession } from '../../log-helpers';
import logger from '../../logger';

/**
 * Per-session feedback tracker with anti-spam measures
 */
export class FeedbackTracker {
  // Map of item_id to rating
  private feedbackMap: Map<string, 'thumbs_up' | 'thumbs_down'> = new Map();

  // Set of all assistant item_ids seen
  private totalAssistantItems: Set<string> = new Set();

  // Map of item_id to last feedback timestamp (for rate limiting)
  private lastFeedbackTime: Map<string, number> = new Map();

  // Total feedback events received (for session cap)
  private feedbackEventCount: number = 0;

  // Anti-spam configuration
  private readonly PER_ITEM_COOLDOWN_MS = 2000; // 2 seconds per item
  private readonly MAX_FEEDBACK_EVENTS_PER_SESSION = 100; // Max 100 feedback events per session

  constructor(private sessionId: string) {}

  /**
   * Track an assistant item when it's created
   * @param itemId - The assistant item ID
   */
  trackAssistantItem(itemId: string): void {
    this.totalAssistantItems.add(itemId);
    logger.debug({ sessionId: this.sessionId, itemId }, `Tracked assistant item ${formatSession(this.sessionId)}`);
  }

  /**
   * Record feedback for an item with anti-spam checks
   * @param itemId - The item ID
   * @param rating - The rating ('thumbs_up' | 'thumbs_down' | null to remove)
   * @returns true if feedback was recorded, false if rejected due to anti-spam
   */
  recordFeedback(itemId: string, rating: 'thumbs_up' | 'thumbs_down' | null): boolean {
    // Anti-spam check 1: Session cap
    if (this.feedbackEventCount >= this.MAX_FEEDBACK_EVENTS_PER_SESSION) {
      logger.warn(
        { sessionId: this.sessionId, itemId },
        `Feedback rejected for ${formatSession(this.sessionId)}: session cap reached (${this.MAX_FEEDBACK_EVENTS_PER_SESSION})`,
      );
      return false;
    }

    // Anti-spam check 2: Validate item exists in tracked assistant items
    if (!this.totalAssistantItems.has(itemId)) {
      logger.warn(
        { sessionId: this.sessionId, itemId },
        `Feedback rejected for ${formatSession(this.sessionId)}: unknown item_id`,
      );
      return false;
    }

    // Anti-spam check 3: Per-item cooldown
    const lastTime = this.lastFeedbackTime.get(itemId);
    const now = Date.now();
    if (lastTime && now - lastTime < this.PER_ITEM_COOLDOWN_MS) {
      logger.warn(
        { sessionId: this.sessionId, itemId },
        `Feedback rejected for ${formatSession(this.sessionId)}: cooldown active (${this.PER_ITEM_COOLDOWN_MS}ms)`,
      );
      return false;
    }

    // Record feedback
    this.feedbackEventCount++;
    this.lastFeedbackTime.set(itemId, now);

    if (rating === null) {
      // Remove rating
      this.feedbackMap.delete(itemId);
      logger.info({ sessionId: this.sessionId, itemId }, `Feedback removed ${formatSession(this.sessionId)}`);
    } else {
      // Set or update rating
      this.feedbackMap.set(itemId, rating);
      logger.info(
        { sessionId: this.sessionId, itemId, rating },
        `Feedback recorded ${formatSession(this.sessionId)}: ${rating}`,
      );
    }

    return true;
  }

  /**
   * Get summary of feedback for the session
   * @returns Summary object with counts
   */
  getSummary(): {
    thumbs_up: number;
    thumbs_down: number;
    no_reaction: number;
    total: number;
  } {
    let thumbsUp = 0;
    let thumbsDown = 0;

    for (const rating of this.feedbackMap.values()) {
      if (rating === 'thumbs_up') {
        thumbsUp++;
      } else if (rating === 'thumbs_down') {
        thumbsDown++;
      }
    }

    const total = this.totalAssistantItems.size;
    const noReaction = total - thumbsUp - thumbsDown;

    return {
      thumbs_up: thumbsUp,
      thumbs_down: thumbsDown,
      no_reaction: noReaction,
      total,
    };
  }
}
