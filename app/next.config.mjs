/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enable emotion for MUI
  compiler: {
    emotion: true,
  },
  // Automatically expose INWORLD_API_KEY and INWORLD_WORKSPACE to client
  // This allows users to set only one API key instead of two
  // NOTE: This exposes API keys to the client - suitable for dev environments only
  env: {
    NEXT_PUBLIC_INWORLD_API_KEY: process.env.INWORLD_API_KEY || '',
    NEXT_PUBLIC_INWORLD_WORKSPACE: process.env.INWORLD_WORKSPACE || '',
  },
  // Exclude @inworld/runtime from bundling - it contains native .node binaries
  // that need to be loaded via Node.js require() instead of webpack bundling
  serverExternalPackages: ['@inworld/runtime'],
  // Turbopack config (Next.js 16+ uses Turbopack by default)
  // Empty config to silence the warning
  turbopack: {},
};

export default nextConfig;
