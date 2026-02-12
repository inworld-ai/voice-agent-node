# -----------------------------------------------------------
# Dockerfile for voice-agent-smart-router-client (Next.js app)
# Build context: repository root
# Uses: app/.dockerignore
# -----------------------------------------------------------

FROM node:20-slim AS deps
WORKDIR /workspace

# Copy root workspace config
COPY package.json package-lock.json ./
COPY app/package.json ./app/

# Create placeholder workspace packages (excluded by .dockerignore)
# so that `npm ci` can resolve the full workspace graph
RUN mkdir -p realtime-server realtime-contract \
    && echo '{"name":"@realtime-service/realtime-server","version":"1.0.0"}' > realtime-server/package.json \
    && echo '{"name":"@realtime-service/realtime-contract","version":"1.0.0"}' > realtime-contract/package.json

RUN npm ci

# -----------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /workspace

# libgomp is needed during `next build` — it collects page data server-side
# which loads the @inworld/runtime native binary
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /workspace ./
COPY app/ ./app/

# Build the Next.js application
RUN npm run build --workspace=app

# -----------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /workspace

# Install native libraries required by @inworld/runtime (inworld.node)
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# Copy only what's needed for production
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/package.json ./
COPY --from=builder /workspace/app/package.json ./app/
COPY --from=builder /workspace/app/node_modules ./app/node_modules
COPY --from=builder /workspace/app/.next ./app/.next
COPY --from=builder /workspace/app/public ./app/public

# Cloud Run injects PORT env variable (defaults to 8080)
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start", "--workspace=app"]
