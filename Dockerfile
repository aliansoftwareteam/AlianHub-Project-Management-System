# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────
# AlianHub - Project Management System
# Multi-stage Dockerfile producing a small, secure production image.
#
# Build:
#   docker build -t alianhub:dev .
#
# Run (standalone, requires MongoDB elsewhere):
#   docker run -d -p 4000:4000 \
#     -e MONGODB_URL=mongodb://your-mongo-host:27017/alianhub \
#     -e JWT_SECRET=change-me \
#     alianhub:dev
#
# Run with bundled MongoDB:
#   docker compose up -d
# ─────────────────────────────────────────────────────────────────────

# ─── Stage 1: Frontend builder ───────────────────────────────────────
# Builds the Vue.js bundle to be served statically by the backend.
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy lockfile first for cache-friendly installs
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Symlink the brand config so the build can read it
COPY brandSettings.json /app/brandSettings.json
RUN ln -sf /app/brandSettings.json /app/frontend/brandSettings.json

# Build the SPA bundle
COPY frontend/ ./
RUN npm run build


# ─── Stage 2: Backend production deps ────────────────────────────────
# Installs ONLY production deps for the smallest possible final image.
FROM node:20-alpine AS backend-deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force


# ─── Stage 3: Final runtime image ────────────────────────────────────
# Non-root user, tini for signal handling, minimal surface area.
FROM node:20-alpine AS production

# tini handles SIGTERM/SIGINT properly (graceful shutdown)
RUN apk add --no-cache tini

WORKDIR /app

# Bring in production deps from the deps stage
COPY --from=backend-deps /app/node_modules ./node_modules

# Bring in the built frontend bundle
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy backend source — order matters for layer caching, but at this
# stage we're only running, not installing.
COPY package.json ./
COPY brandSettings.json ./
COPY index.js server.js check-version.js installation.js ./
COPY Config/ ./Config/
COPY Modules/ ./Modules/
COPY common-storage/ ./common-storage/
COPY event/ ./event/
COPY middlewares/ ./middlewares/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY socket/ ./socket/
COPY utils/ ./utils/

# Persistent storage directory (mounted as a volume in compose)
RUN mkdir -p /app/common-storage/uploads \
 && chown -R node:node /app

# Drop to non-root user
USER node

EXPOSE 4000

ENV NODE_ENV=production \
    PORT=4000

# Health check — passes if the server responds (even with a 4xx),
# fails only on connection errors or 5xx. No extra binary needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4000)+'/', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

# tini as PID 1 forwards signals correctly so Node shuts down gracefully
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
