import Mixpanel from 'mixpanel';

import { MIXPANEL_TOKEN } from '../config';
import logger from '../logger';

let mixpanelClient: Mixpanel.Mixpanel | null = null;

/**
 * Initialize Mixpanel client if token is available
 */
function initializeMixpanel(): Mixpanel.Mixpanel | null {
  if (!MIXPANEL_TOKEN) {
    logger.info('MIXPANEL_TOKEN not set - Mixpanel tracking disabled');
    return null;
  }

  try {
    const client = Mixpanel.init(MIXPANEL_TOKEN);
    logger.info('Mixpanel initialized successfully');
    return client;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Mixpanel');
    return null;
  }
}

// Initialize on module load
mixpanelClient = initializeMixpanel();

/**
 * Track an event to Mixpanel
 * No-ops gracefully if MIXPANEL_TOKEN is not set
 *
 * @param eventName - The name of the event to track
 * @param properties - Event properties (key-value pairs)
 */
export function trackEvent(eventName: string, properties: Record<string, any> = {}): void {
  if (!mixpanelClient) {
    logger.debug({ eventName, properties }, 'Mixpanel not initialized - skipping event');
    return;
  }

  try {
    mixpanelClient.track(eventName, properties);
    logger.debug({ eventName, properties }, 'Mixpanel event tracked');
  } catch (error) {
    logger.error({ error, eventName }, 'Failed to track Mixpanel event');
  }
}
