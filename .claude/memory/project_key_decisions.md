---
name: AlianHub Key Architectural Decisions
description: Critical design decisions and constraints that shape AlianHub's architecture
type: project
---

# Key Architectural Decisions

## Multi-Tenancy: Every Operation Includes companyId
**Decision:** Company-scoped data within single database  
**Why:** Operational simplicity, cost-effective, enables cross-company features (invitations)  
**Risk:** Data leak if companyId filtering missed (CRITICAL SECURITY)  
**Mitigation:** Centralized MongoDbCrudOpration enforces companyId in all queries

## Centralized Database Abstraction: MongoDbCrudOpration()
**Decision:** All MongoDB queries through single function  
**Why:** Prevents data scoping bugs, consistent error handling, easy auditing  
**Risk:** Less type-safe than ORM  
**Mitigation:** JSDoc type hints, comprehensive testing

## Real-Time via Socket.io
**Decision:** WebSocket with Socket.io (not raw WebSockets, SSE, or polling)  
**Why:** Auto fallbacks, room-based broadcasting, connection management  
**Implication:** All data mutations must emit Socket.io events for LiveSync

## Single Shared MongoDB (Not Separate Databases)
**Decision:** One MongoDB cluster serves all companies  
**Why:** Operational simplicity, cost-effective  
**Risk:** Single point of failure (mitigated: MongoDB Atlas replication, regular backups)  
**Future:** Could shard by companyId if one customer needs isolated data

## Module-Based Organization (Not Layered)
**Decision:** Features organized in Modules/ by feature, not by layer (controller/service/model)  
**Why:** Easier to find related code, feature-focused development  
**Rule:** Each module has controller/, routes.js, helpers/, schema.js

## Express Middleware Error Handling (Not Async Throws)
**Decision:** Errors set req.errorMessageObject and call next() (middleware propagation)  
**Why:** Centralized error formatting, consistent response structure  
**Pattern:** try-catch wraps logic, catch sets req.errorMessageObject, calls next()

## Wasabi for Storage (Not AWS S3 or Local-Only)
**Decision:** Wasabi as default (S3-compatible), local filesystem fallback  
**Why:** ~80% cheaper than AWS, S3 API compatibility allows swaps  
**Flexibility:** Abstraction layer (common-storage/) supports Wasabi, local, MinIO, AWS

## JWT Stateless Authentication (Not Session Cookies)
**Decision:** JWT tokens stored in client localStorage  
**Why:** Stateless (scales across instances), works for mobile/desktop  
**Risk:** XSS vulnerability (mitigated: HTTPS, CSP headers, input sanitization)  
**Improvement:** Could use httpOnly cookies for better security

## Vue.js SPA + Backend API (Not Server-Side Rendering)
**Decision:** Vue.js frontend is separate SPA, backend is API-only  
**Why:** Independent scaling, modern architecture, mobile-friendly  
**Implication:** Frontend must handle offline state gracefully

## API Versioning: URL-Based (/api/v2/)
**Decision:** Version in URL path, not headers or query params  
**Why:** Explicit, hard to miss, clear deprecation path  
**Pattern:** v2 is preferred, v1 maintained for legacy clients

## In-Memory Cache with Manual Invalidation
**Decision:** node-cache for frequent reads, manual removeCache() after mutations  
**Why:** Simple, no distributed cache complexity, good for single-instance  
**Risk:** Stale data if removeCache() forgotten (mitigated: testing, patterns in CONVENTIONS.md)

## No Test Framework (Gap)
**Decision:** No Jest/Supertest configured currently  
**Why:** Legacy, low test coverage  
**Gap:** Risk of regressions, hard to verify refactors  
**Recommendation:** Add Jest + Supertest when capacity available
