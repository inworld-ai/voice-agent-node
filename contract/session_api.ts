/**
 * STT service selection for a session.
 *
 * @remarks
 * Matches current client UI values.
 */
export type STTService = 'native';

/**
 * Minimal agent configuration sent from the client to the server.
 *
 * @remarks
 * This is intentionally small and loosely typed so both client and server
 * can evolve without importing each other’s internal types.
 */
export interface AgentConfig {
  name?: string;
  description?: string;
  motivation?: string;
  knowledge?: string;
  systemPrompt?: string;
}

/**
 * Request body for POST /load.
 */
export interface LoadRequestBody {
  userName: string;
  agent: AgentConfig;
  sttService?: STTService;
  voiceId?: string;
}

/**
 * Successful response body for POST /load.
 */
export interface LoadResponseBody {
  agent: {
    id: string;
    name?: string;
  };
}
