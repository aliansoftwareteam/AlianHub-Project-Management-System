# Socket & Real-Time Performance Enhancement Plan

**Goal:** Make AlianHub run smoothly at large scale (10k+ tasks, 500+ concurrent users) without timeouts, crashes, or sluggishness — focused on the Socket.io real-time layer plus the supporting MongoDB/cache layer.

**Scope:** Socket event pipeline, in-memory room tracking, DB connection pool, cache invalidation, and path to horizontal scaling.

---

## Issues by Severity

### Critical — O(n) Degradation Under Load

#### 1. `socketRef.rooms` is a Linear Array — O(n) on Every Event
- **Files:** `socket/socketinit.js:14`, `socket/controller/taskSocket.js:32`, all socket controllers
- **Problem:** Every DB mutation fires events; every handler calls `socketRef.rooms.filter(...)` on the whole global array. 500 users × 5 rooms = 2,500 entries scanned per event, per handler.
- **Fix:** Replace array with `Map<identifier, Set<roomEntry>>`. Index by prefix (`project_sprint_<pid>_<sid>`, `taskDetail_<tid>`, etc.) on join. Lookup becomes O(1).

#### 2. All 5 Handlers Fire on Every Event
- **Files:** `taskSocket.js:122-123`, `chatSocket.js:76-77`, `commentSocket.js:116-117`, `companiesSocket.js:72-73`, `userNotificationCount.js:40-41`
- **Problem:** Every `update`/`insert` event hits all 5 handlers. Each does the expensive `socketRef.rooms.filter()` before checking `changeData.module`.
- **Fix:** Use module-namespaced events: `task:update`, `comment:insert`, `companies:update`, etc. Only the relevant handler subscribes.

#### 3. `JSON.parse(JSON.stringify(data))` in Hot Paths
- **Files:** `taskSocket.js:29,31`, `commentSocket.js:48,78`
- **Problem:** Deep cloning a full task/comment document just to read a single `_id` or `projectId` field — on every event. Allocates memory, triggers GC, adds 3–15ms per call.
- **Fix:** Access fields directly: `changeData.data._id?.toString()`. If it's a Mongoose doc, call `.toObject()` once and reuse.

#### 4. No Automatic Room Cleanup on Disconnect
- **File:** `socket/socketinit.js:84-106`
- **Problem:** `disconnectNameSpace` only fires if the client explicitly calls it. Browser closes, network drops, mobile app kills → stale entries pile up in `socketRef.rooms` forever.
- **Fix:** Listen to Socket.io's native `disconnect` event and purge all entries for that socket automatically.

---

### Important — Significant Performance Impact

#### 5. `adapter.rooms.keys()` Scanned Inside Event Handlers
- **Files:** `taskSocket.js:44-53`, `commentSocket.js:54-64`, all handlers
- **Problem:** For each matching `socketRef.rooms` entry, code iterates over ALL namespace adapter rooms — O(m) per entry.
- **Fix:** Use `socket.rooms` (the joined rooms for the specific socket — typically 3–5) instead of `adapter.rooms.keys()`.

#### 6. MongoDB `maxPoolSize: 3` Per Tenant
- **File:** `utils/mongo-handler/mongoConnector.js:44`
- **Problem:** Only 3 concurrent queries per tenant. 50 concurrent requests → 47 queue up → timeouts. Most common cause of slow task operations.
- **Fix:** Bump to 10–20 with env override: `maxPoolSize: Number(process.env.MONGO_POOL_SIZE) || 10`. Also set `minPoolSize: 2`.

#### 7. Duplicate `socketRef.rooms` Entries on Re-join
- **Files:** `taskSocket.js:99`, `chatSocket.js:65`, `companiesSocket.js:8`
- **Problem:** Push without dedup. Tab refresh or reconnection → duplicate entries → events emitted multiple times to same room.
- **Fix:** Standardize on the dedup pattern from `commentSocket.js`. Extract to `socket/helper.js#upsertRoom`.

#### 8. Full Document Payload on Every Update
- **Files:** All `handleXxxChange` functions
- **Problem:** Sends full task object (10–50KB) over WebSocket even when only one field changed.
- **Fix:** For `update` events, emit only `{ _id, updatedFields }`. Full document only on `insert`. Requires small frontend change to apply patches instead of replacing.

#### 9. `getTotalSprintCount` Called on Every Task Create
- **File:** `modules/Tasks/helpers/mongo_helper.js:23`
- **Problem:** Sequential `await` DB query before every task write.
- **Fix:** Cache result in `node-cache` with 30s TTL, keyed by `companyId:sprintId`.

---

### Medium — Optimization Improvements

#### 10. No Tenant Isolation in `socketRef.rooms`
- **File:** `socket/socketinit.js:14`
- **Problem:** Shared globally. Company A's event scans Company B/C/D rooms too.
- **Fix:** `Map<companyId, RoomIndex>`. Each company has its own room state.

#### 11. Cache Invalidation Prefix Scan
- **File:** `utils/commonFunctions.js:15-19`
- **Problem:** `myCache.keys()` + `.filter()` on every prefix-based invalidation — O(n) per call.
- **Fix:** Maintain reverse index `Map<prefix, Set<fullKey>>`. O(1) deletion.

#### 12. No Debouncing of Rapid Events
- **Problem:** Bulk task reorder = 50 socket emits = 50 room scans + 50 broadcasts.
- **Fix:** Per-room 50ms debounce window. Coalesce events, emit once at window end.

#### 13. `waitQueueTimeoutMS: 30000` Too High
- **File:** `utils/mongo-handler/mongoConnector.js:43`
- **Problem:** Queued queries wait up to 30s before failing. Users see 30s spinner before error.
- **Fix:** Reduce to 5000ms. Combine with Fix #6 to prevent queuing in the first place.

---

### Scaling — Horizontal Scale Readiness

#### 14. No Redis Adapter — Single-Process Socket.io
- **File:** `socket/socketinit.js:47`
- **Problem:** Socket state is in-memory. Multi-instance deployment can't broadcast events across instances.
- **Fix:** Add `@socket.io/redis-adapter`, opt-in via `REDIS_URL` env var. Default-off so single-node deployments are unaffected.

#### 15. `node-cache` is Per-Process
- **Files:** `Config/config.js:10`, used everywhere
- **Problem:** Each process has its own cache. Cache miss across instances.
- **Fix:** Abstract cache behind interface. Use Redis backend when `REDIS_URL` set; fallback to `node-cache`.

---

## Summary Table

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | `rooms` array O(n) scan | Critical | Medium |
| 2 | All 5 handlers fire on every event | Critical | Low |
| 3 | `JSON.parse(JSON.stringify)` in hot path | Critical | Low |
| 4 | No auto-disconnect cleanup | Critical | Low |
| 5 | `adapter.rooms.keys()` scan per entry | Important | Medium |
| 6 | `maxPoolSize: 3` per tenant | Important | Low |
| 7 | Duplicate rooms on re-join | Important | Low |
| 8 | Full document in update events | Important | Medium |
| 9 | `getTotalSprintCount` uncached | Important | Low |
| 10 | No tenant isolation in rooms | Medium | Medium |
| 11 | Cache prefix scan O(n) | Medium | Low |
| 12 | No event debouncing | Medium | Medium |
| 13 | `waitQueueTimeoutMS` too high | Medium | Low |
| 14 | No Redis adapter | Scaling | High |
| 15 | `node-cache` per-process | Scaling | High |

---

## Execution Phases

### Phase 1 — Quick Wins (1–2 days, zero-risk) — ✅ COMPLETE (2026-05-22)
Touches only backend, no frontend coordination needed.
- [x] Fix #2 — namespaced events (`event/socketEventEmitter.js` wraps EventEmitter; 5 socket controllers + notification middleware migrated to `<module>:<event>` listeners)
- [x] Fix #3 — removed `JSON.parse(JSON.stringify)` from `taskSocket.js`, `commentSocket.js`, `companiesSocket.js`
- [x] Fix #4 — added native `socket.on('disconnect')` cleanup in `socket/socketinit.js`
- [x] Fix #6 — `maxPoolSize` 3 → 10, `minPoolSize` 2 added, env-overridable via `MONGO_POOL_SIZE` / `MONGO_MIN_POOL_SIZE`
- [x] Fix #13 — `waitQueueTimeoutMS` 30000 → 5000, env-overridable via `MONGO_WAIT_QUEUE_TIMEOUT_MS`

**Verification:** `npm test` → 20/20 pass. All touched files `node --check` clean. Namespaced emitter routing verified with a smoke harness.

### Phase 2 — Core Refactor (3–5 days)
Rework the room index. Backend-only.
- [ ] Fix #1 — `Map`-based room index
- [ ] Fix #5 — use `socket.rooms` not `adapter.rooms.keys()`
- [ ] Fix #7 — shared `upsertRoom` helper
- [ ] Fix #9 — cache `getTotalSprintCount`

### Phase 3 — Payload + Debounce (2–3 days)
Requires small frontend coordination for Fix #8.
- [ ] Fix #8 — emit `updatedFields` only (no full doc)
- [ ] Fix #11 — cache reverse index
- [ ] Fix #12 — debounce rapid events

### Phase 4 — Horizontal Scale (1 week, optional)
For multi-instance deployments.
- [ ] Fix #10 — tenant-isolated room map
- [ ] Fix #14 — Redis adapter (opt-in)
- [ ] Fix #15 — Redis cache abstraction (opt-in)

---

## Expected Impact

| Metric | Before | After Phase 1+2 | After Phase 3+4 |
|--------|--------|-----------------|-----------------|
| Event broadcast latency (500 users) | ~150ms | ~5ms | ~3ms |
| Memory growth per day | Unbounded (stale rooms) | Stable | Stable |
| Task update DB queue wait | Up to 30s | < 100ms | < 100ms |
| WebSocket payload per update | 10–50KB | 10–50KB | < 1KB |
| Horizontal scaling | Not supported | Not supported | Multi-instance |

---

## Files Touched (Reference)

**Socket layer:**
- `socket/socketinit.js`
- `socket/helper.js`
- `socket/controller/taskSocket.js`
- `socket/controller/chatSocket.js`
- `socket/controller/commentSocket.js`
- `socket/controller/companiesSocket.js`
- `socket/controller/userNotificationCount.js`
- `event/socketEventEmitter.js`

**Emitter call sites (for namespaced events):**
- `modules/Tasks/helpers/taskMongo/*.js`
- `modules/Tasks/helpers/mongo_helper.js`
- `modules/Comments/controller.js`
- `modules/MainChats/controller.js`
- `modules/Company/eventController.js`

**DB layer:**
- `utils/mongo-handler/mongoConnector.js`
- `utils/mongo-handler/mongoQueries.js`
- `middlewares/mongoConnector/helper.js`
- `middlewares/mongoConnector/mongoConnection.js`

**Cache layer:**
- `Config/config.js`
- `utils/commonFunctions.js`
- `modules/Project/controller/getProjectList.js`

---

**Author:** Plan prepared 2026-05-22  
**Status:** Awaiting approval to begin Phase 1
