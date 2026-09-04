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

# Copy the brand config so the build can read it
COPY brandSettings.json /app/brandSettings.json
RUN ln -sf /app/brandSettings.json /app/frontend/brandSettings.json

# Copy the root package.json — Header.vue imports {version} from it
# via a 5-level relative path. Without this, webpack fails with:
#   "Can't resolve '../../../../../package.json'"
COPY package.json /app/package.json

# vue.config.js aliases @pageContent to this backend helper so the block
# editor and the API share one content model.
COPY Modules/Pages/helpers/pageContent.js /app/Modules/Pages/helpers/pageContent.js

# Build the SPA bundle. webpack needs more than Node's default ~2 GB heap for
# this bundle (same setting as ci.yml).
COPY frontend/ ./
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build


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
COPY package.json CHANGELOG.md ./
COPY brandSettings.json thumbnail.json ./
COPY index.js server.js cron.js ./
COPY Config/ ./Config/
COPY Modules/ ./Modules/
COPY common-storage/ ./common-storage/
COPY docs/ ./docs/
COPY event/ ./event/
COPY middlewares/ ./middlewares/
COPY migrations/ ./migrations/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY socket/ ./socket/
COPY utils/ ./utils/
COPY wasabiUploadsLocal/ ./wasabiUploadsLocal/

# Writable directories: uploaded files (STORAGE_TYPE=server), logs, backups —
# each mounted as a volume in compose so they survive an image update.
RUN mkdir -p /app/storage /app/log /app/backups \
 && chown -R node:node /app

# Drop to non-root user
USER node

EXPOSE 4000

# Config/jwt.js passes JWT_ALGORITHM and JWT_EXP straight to jwt.sign, which
# rejects undefined options — without them no session can be created.
ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE_TYPE=server \
    JWT_ALGORITHM=HS256 \
    JWT_EXP=24h

# /health answers 200 only when the database is reachable, 503 otherwise.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4000)+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# tini as PID 1 forwards signals correctly so Node shuts down gracefully
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
