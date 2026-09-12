---
id: 014
title: AI hub full test and fixes
status: active
priority: high
depends_on: [006, 010]
created: 2026-09-04
---

# 014 — AI hub full test and fixes

Status: active · every defect fixed and merged 2026-09-05 (PR #543, `1fd5d178`, build 20) · two items open: the member-role **browser** sweep of the `/ai` screens (the API half was covered by task 034 and its findings AGT-01 to AGT-11 fixed in PR #620; no `/ai` screen has ever been opened as a member) and the unchecked `agent_run` notification row, which still sends the agent id as the sender (`Modules/Agents/runs.js:340`)

Goal: every screen and flow under /ai works for owners and members, with refusal reasons visible, counts correct, and agent controls (pause, spend cap, allowed actions) honoured on every path including automation-triggered runs.

Inputs: `findings-browser.md` (my sweep), the static review (24 defects, in progress-review.md), agent F API report (to follow).

Workstreams: H backend (Modules/Agents, Modules/Automations/engine/actions/runAgent.js, tests) · I frontend (frontend/src/views/Ai/**, TaskDetailOverlay agent strip, Inbox.vue, locales).
