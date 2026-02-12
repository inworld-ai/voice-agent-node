# -----------------------------------------------------------
# Dockerfile for voice-agent-smart-router-server
# (realtime-server + realtime-contract)
# Build context: repository root
# Uses: realtime-server/.dockerignore
# -----------------------------------------------------------

FROM node:20-slim AS deps
WORKDIR /workspace

# Copy root workspace config
COPY package.json package-lock.json ./
COPY realtime-server/package.json ./realtime-server/
COPY realtime-contract/package.json ./realtime-contract/

# Create placeholder for the app workspace (excluded by .dockerignore)
RUN mkdir -p app \
    && echo '{"name":"app","version":"0.1.0","private":true}' > app/package.json

RUN npm ci

# -----------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /workspace

COPY --from=deps /workspace ./
COPY realtime-contract/ ./realtime-contract/
COPY realtime-server/ ./realtime-server/

# Build contract first (server depends on it), then the server
RUN npm run build --workspace=@realtime-service/realtime-contract \
    && npm run build --workspace=@realtime-service/realtime-server

# -----------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /workspace

# Install native libraries required by @inworld/runtime (inworld.node)
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# Copy hoisted node_modules (npm workspaces hoists all deps to the root)
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/package.json ./

# Copy built contract (runtime dependency of server)
COPY --from=builder /workspace/realtime-contract/package.json ./realtime-contract/
COPY --from=builder /workspace/realtime-contract/dist ./realtime-contract/dist

# Copy built server
COPY --from=builder /workspace/realtime-server/package.json ./realtime-server/
COPY --from=builder /workspace/realtime-server/dist ./realtime-server/dist

# The server listens on port 4000 (WS_APP_PORT in config.ts)
EXPOSE 4000

CMD ["node", "realtime-server/dist/index.js"]
