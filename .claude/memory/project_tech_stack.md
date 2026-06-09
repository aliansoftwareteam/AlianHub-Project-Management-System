---
name: AlianHub Tech Stack
description: Technology choices and rationale for AlianHub project management system
type: project
---

# AlianHub Technology Stack

## Backend
- **Express.js 4.21.2** — HTTP server and routing
  - Lightweight, modular-friendly, large ecosystem
- **MongoDB + Mongoose** — NoSQL database with ODM
  - Chosen for flexible schema (custom fields), document nesting (projects→tasks), easy sharding
  - Trade-off: eventual consistency vs SQL's ACID; mitigated by validation & testing
- **Socket.io 4.8.1** — Real-time WebSocket events
  - Why: automatic fallbacks, room-based broadcasting, reconnection handling
  - Chosen over raw WebSockets (no fallbacks), SSE (one-way), polling (high latency)
- **JWT + bcrypt** — Authentication
  - Stateless auth (scales across instances), password hashing with bcrypt
- **Winston** — Structured logging to track.log, error.log, combined.log

## Frontend
- **Vue.js** — Reactive UI framework
  - Lightweight, smaller learning curve than React, strong real-time support
- **Pinia** (or Vuex) — Global state management
  - Avoids prop drilling, enables centralized Socket.io event handling
- **vue-i18n** — Multi-language support

## Storage
- **Wasabi S3-compatible** (production) or **local filesystem** (development)
  - Rationale: S3 abstraction allows flexibility, Wasabi cheaper than AWS (~80% savings)
  - Sharp for image processing/optimization
  - Abstraction layer (common-storage/) prevents vendor lock-in

## Caching & Scheduling
- **node-cache** — In-memory caching (project settings, frequent lookups)
  - Invalidated after mutations to prevent stale data
- **node-schedule** — Cron jobs for scheduled tasks

## Email & Communication
- **Nodemailer** (SMTP) or **Resend** (HTTP API, recommended for cloud)
  - Flexible backend support
- **Firebase Admin SDK** — Push notifications (optional)

## Critical Architectural Decision: Centralized MongoDbCrudOpration
All MongoDB queries go through single abstraction function:
- **Why:** Enforces companyId filtering (prevents data leaks), consistent error handling, easy to audit/log
- **Trade-off:** Less type-safe than full ORM; mitigated by JSDoc + testing
- **Could improve:** TypeScript + Mongoose for better type safety in future

## Multi-Tenancy: Single DB vs Separate
- **Chosen:** Single database (company-scoped with companyId filtering)
  - Why: operational simplicity, cost-effective, easy cross-company features
  - Risk: companyId filtering critical (mitigated by centralized MongoDbCrudOpration)
  - Future: could shard by companyId as scale increases

## API Versioning
- **Chosen:** URL-based versioning (/api/v1, /api/v2)
  - Why: explicit, hard to miss, clear deprecation path
  - v2 preferred for new routes; v1 maintained for backward compatibility

## No Test Framework Currently
- Recommendation: Add Jest + Supertest when capacity available
- Would prevent regressions as codebase grows
