# =============================================================================
# Multi-stage Dockerfile for swiss-cybersecurity-mcp
# =============================================================================
# Builder stage: install ALL deps (incl. better-sqlite3 native binding via
# postinstall), rebuild against this Node ABI, compile TypeScript.
# Runtime stage: copy node_modules + dist + baked DB. Do NOT re-run npm ci
# (that would strip the better-sqlite3 native .node binding).
# =============================================================================

FROM node:20-alpine AS builder
WORKDIR /app

# Build toolchain for better-sqlite3 native compile
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci
RUN npm rebuild better-sqlite3

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# -----------------------------------------------------------------------------

FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV NCSC_CH_DB_PATH=/app/data/ncsc-ch.db

COPY package.json package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Bake DB from release-provisioned data/database.db (CI gunzip target)
COPY data/database.db data/ncsc-ch.db

# Non-root runtime user (UID 1001)
RUN addgroup -S -g 1001 mcp && \
    adduser -S -u 1001 -G mcp mcp && \
    chown -R mcp:mcp /app
USER mcp

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/src/http-server.js"]
