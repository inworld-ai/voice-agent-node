// Client-side configuration for Next.js
// Use NEXT_PUBLIC_ prefix for client-accessible environment variables

const getClientEnv = (key: string, defaultValue: string = ''): string => {
  if (typeof window !== 'undefined') {
    // Client-side: only NEXT_PUBLIC_ vars are available
    return process.env[`NEXT_PUBLIC_${key}`] || defaultValue;
  }
  // Server-side: can access all env vars
  return process.env[`NEXT_PUBLIC_${key}`] || process.env[key] || defaultValue;
};

const REALTIME_SERVER_PORT = getClientEnv('REALTIME_SERVER_PORT', '4000');
const REALTIME_SERVER_HOST = getClientEnv('REALTIME_SERVER_HOST', 'localhost');

export const config = {
  LOAD_URL:
    getClientEnv('APP_LOAD_URL') || `http://${REALTIME_SERVER_HOST}:${REALTIME_SERVER_PORT}/load`,
  UNLOAD_URL:
    getClientEnv('APP_UNLOAD_URL') || `http://${REALTIME_SERVER_HOST}:${REALTIME_SERVER_PORT}/unload`,
  SESSION_URL:
    getClientEnv('APP_SESSION_URL') || `ws://${REALTIME_SERVER_HOST}:${REALTIME_SERVER_PORT}/session`,
  REALTIME_API_URL:
    getClientEnv('REALTIME_API_URL') || `ws://${REALTIME_SERVER_HOST}:${REALTIME_SERVER_PORT}`,
  INWORLD_API_KEY: 
    getClientEnv('INWORLD_API_KEY') || '',
  INWORLD_WORKSPACE:
    getClientEnv('INWORLD_WORKSPACE') || '',
  // Next.js API route for character generation
  GENERATE_CHARACTER_URL:
    getClientEnv('GENERATE_CHARACTER_URL') || '/api/generate-character',
  // Next.js API route for voice cloning
  CLONE_VOICE_URL:
    getClientEnv('CLONE_VOICE_URL') || '/api/clone-voice',
  ENABLE_LATENCY_REPORTING:
    getClientEnv('ENABLE_LATENCY_REPORTING') === 'true' || false,
};
