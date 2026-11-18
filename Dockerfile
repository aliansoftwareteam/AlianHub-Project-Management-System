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
#
# The base image is pinned by digest so a rebuild of the same commit gives the
# same image; Dependabot (.github/dependabot.yml) proposes the bumps.
# ─────────────────────────────────────────────────────────────────────

# ─── Stage 1: Frontend builder ───────────────────────────────────────
# Builds the Vue.js bundle to be served statically by the backend.
FROM node:20.20.2-alpine3.23@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS frontend-builder

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

# vue.config.js aliases these backend modules into the bundle so the app and the
# API share one copy. tests/conventions/docker-frontend-aliases.test.js fails when
# an alias is added without its COPY line here.
COPY Modules/Pages/helpers/pageContent.js /app/Modules/Pages/helpers/pageContent.js
COPY Modules/Agents/workKinds.js /app/Modules/Agents/workKinds.js
COPY Modules/Agents/engine/egressRules.js /app/Modules/Agents/engine/egressRules.js
COPY Modules/Agents/dailyRunLimit.js /app/Modules/Agents/dailyRunLimit.js
COPY Modules/Auth/helpers/passwordRule.js /app/Modules/Auth/helpers/passwordRule.js
COPY Modules/Project/helpers/viewSettings.js /app/Modules/Project/helpers/viewSettings.js
COPY Modules/CustomField/helpers/fieldTaskTypes.js /app/Modules/CustomField/helpers/fieldTaskTypes.js
COPY Modules/CustomField/helpers/datePastFuture.js /app/Modules/CustomField/helpers/datePastFuture.js
COPY Modules/CustomField/fieldTypes /app/Modules/CustomField/fieldTypes
COPY Modules/Automations/templates.js /app/Modules/Automations/templates.js
COPY Modules/Company/helpers/workingDays.js /app/Modules/Company/helpers/workingDays.js
COPY Modules/Tasks/helpers/taskTreeRules.js /app/Modules/Tasks/helpers/taskTreeRules.js
COPY Modules/Tasks/helpers/ganttShift.js /app/Modules/Tasks/helpers/ganttShift.js
COPY Modules/Tasks/helpers/workingCalendar.js /app/Modules/Tasks/helpers/workingCalendar.js
COPY Modules/Tasks/helpers/taskExtraListsRules.js /app/Modules/Tasks/helpers/taskExtraListsRules.js
COPY Modules/Tasks/helpers/descriptionBlock.js /app/Modules/Tasks/helpers/descriptionBlock.js
COPY Modules/Tasks/helpers/richTextAllowlist.js /app/Modules/Tasks/helpers/richTextAllowlist.js
COPY Modules/Forms/helpers/formLogic.js /app/Modules/Forms/helpers/formLogic.js

# Build the SPA bundle. webpack needs more than Node's default ~2 GB heap for
# this bundle (same setting as ci.yml).
COPY frontend/ ./
# Source maps are never served from the image (the shell worker skips them too)
# and are a large share of the bundle.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build \
 && find dist -name '*.map' -delete


# ─── Stage 2: Backend production deps ────────────────────────────────
# Installs ONLY production deps for the smallest possible final image.
FROM node:20.20.2-alpine3.23@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS backend-deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force


# ─── Stage 3: Final runtime image ────────────────────────────────────
# Non-root user, tini for signal handling, minimal surface area.
FROM node:20.20.2-alpine3.23@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS production

# tini forwards SIGTERM/SIGINT so Node shuts down gracefully. Yarn is unused and
# only adds packages to scan; npm stays for `npm run migrate` in the container,
# upgraded because the npm bundled with Node 20 ships a tar with a critical CVE.
RUN apk add --no-cache tini \
 && rm -rf /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && npm install -g npm@10.9.9 --no-audit --no-fund \
 && npm cache clean --force

WORKDIR /app

# --chown on each COPY instead of a `chown -R` afterwards, which would copy
# every file into one more layer and double the image. The files stay owned by
# node, as before, so self-hosted features that write next to the code still work.
COPY --from=backend-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=frontend-builder --chown=node:node /app/frontend/dist ./frontend/dist
COPY --chown=node:node package.json CHANGELOG.md build-info.jso[n] ./
COPY --chown=node:node brandSettings.json thumbnail.json ./
COPY --chown=node:node index.js server.js cron.js ./
COPY --chown=node:node Config/ ./Config/
COPY --chown=node:node Modules/ ./Modules/
COPY --chown=node:node common-storage/ ./common-storage/
COPY --chown=node:node event/ ./event/
COPY --chown=node:node middlewares/ ./middlewares/
COPY --chown=node:node migrations/ ./migrations/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node scripts/ ./scripts/
COPY --chown=node:node socket/ ./socket/
COPY --chown=node:node utils/ ./utils/
COPY --chown=node:node wasabiUploadsLocal/ ./wasabiUploadsLocal/

# Every directory the app writes to. They exist in the image so the app never
# has to create one under a read-only root (deploy/managed/compose.yml.tmpl
# mounts a tmpfs or volume on each), and so a fresh volume starts owned by node:
# storage (files when STORAGE_TYPE=server), log, backups, wasabiUploads (upload
# staging), thumbnails, wasabiUploadsLocal/exports (export jobs).
RUN mkdir -p storage/USER_PROFILES log backups wasabiUploads thumbnails wasabiUploadsLocal/exports \
 && chown node:node /app storage storage/USER_PROFILES log backups wasabiUploads thumbnails wasabiUploadsLocal wasabiUploadsLocal/exports

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
