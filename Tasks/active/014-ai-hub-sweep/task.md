# 014 — AI hub full test and fixes

Status: in progress · 2026-09-04 · branch `fix/ai-hub-sweep` (from `beta`)

Goal: every screen and flow under /ai works for owners and members, with refusal reasons visible, counts correct, and agent controls (pause, spend cap, allowed actions) honoured on every path including automation-triggered runs.

Inputs: `findings-browser.md` (my sweep), the static review (24 defects, in progress-review.md), agent F API report (to follow).

Workstreams: H backend (Modules/Agents, Modules/Automations/engine/actions/runAgent.js, tests) · I frontend (frontend/src/views/Ai/**, TaskDetailOverlay agent strip, Inbox.vue, locales).
