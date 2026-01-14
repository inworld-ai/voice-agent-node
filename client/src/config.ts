const PORT = import.meta.env.VITE_APP_PORT || 4000;

export const config = {
  LOAD_URL:
    import.meta.env.VITE_APP_LOAD_URL || `http://localhost:${PORT}/load`,
  UNLOAD_URL:
    import.meta.env.VITE_APP_UNLOAD_URL || `http://localhost:${PORT}/unload`,
  SESSION_URL:
    import.meta.env.VITE_APP_SESSION_URL || `ws://localhost:${PORT}/session`,
  REALTIME_API_URL:
    import.meta.env.VITE_REALTIME_API_URL || `ws://localhost:4000`,
  INWORLD_API_KEY: 
    import.meta.env.VITE_INWORLD_API_KEY || '',
  ENABLE_LATENCY_REPORTING:
    import.meta.env.VITE_ENABLE_LATENCY_REPORTING === 'true' || false,
};
