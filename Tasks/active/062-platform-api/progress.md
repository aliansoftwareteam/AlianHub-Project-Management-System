# Progress: Platform API — headless provisioning, config push, entitlements, usage and lifecycle

## Checklist

- [ ] T1 — `Modules/Platform`, guard, audit; instance routes accept the platform key
- [ ] T2 — `GET /status`
- [ ] T3 — `POST /provision` (headless setup, activation-pending owner)
- [ ] T4 — `PUT /config`
- [ ] T5 — `PUT /entitlements` with JWS verification and pull fallback
- [ ] T6 — `GET /usage`
- [ ] T7 — `POST /lifecycle` with live broadcast
- [ ] T8 — Owner activation link, login link, transfer; activation page
- [ ] T9 — `POST /rotate-key`
- [ ] T10 — `POST /support-session` (time-boxed, flagged support user)
- [ ] T11 — Docs, jest and e2e tests

## Last step

Not yet started.

## Blockers

Needs 061 T1–T2 merged first.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).
