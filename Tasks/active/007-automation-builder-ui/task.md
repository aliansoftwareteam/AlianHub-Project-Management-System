---
id: 007
title: Automation sentence builder UI + v2 rule API
status: active
priority: high
depends_on: [005]
created: 2026-08-24
---

# Automation sentence builder UI + v2 rule API

## Goal
Task 005 built an engine nobody can reach: v2 rules had to be inserted straight into
MongoDB, because `createRule` only validates v1 shapes and there is no UI. Give users a way
to author rules — the blueprint's "Door 2", a sentence with tappable slots rendered entirely
from the registry manifest, plus the v2 CRUD API it needs.

## Scope
- **`helpers/ruleSchemaV2.js`** — validation returning a *list* of field-level errors, so the
  builder can mark the offending slot rather than showing one opaque failure. Validates the
  trigger and every action against the registry, conditions through the AST validator, and
  each action's config against that action's own schema.
- **v2 endpoints**: `GET /api/v2/automations`, `POST`, `PUT /:id`,
  `PATCH /:id/enabled`, `GET /:id/runs`. The v1 endpoints are untouched.
- **`views/Automations/AutomationsPage.vue`** — rule list plus the sentence builder
  (`When … in … / If … / Then …`), a live sentence preview, and inline errors.
- Route `/:cid/automations`, `env.AUTOMATIONS_V2`, and `Automations.*` i18n keys in `en.js`.

## Out of scope
- **Door 1 (recipe gallery)** and `AUTOMATION_TEMPLATES` — phase 2.
- **Door 3 (Vue Flow canvas)** — phase 4, deliberately, once the sentence builder has shown
  which rules people actually write.
- **"Test on a real task" / "matched 23 tasks in the last 30 days"** — the highest-value
  element on the blueprint's screen, and not built. It needs a dry-run endpoint that
  evaluates a draft rule against history without writing.
- Contextual entry points (task menu, kanban column header, post-bulk-edit toast).
- The run-history drawer. `GET /:id/runs` exists; nothing renders it yet.
- `branch` steps, and `condition` steps in the builder (the engine supports `condition`).

## Acceptance criteria
- [x] The builder renders triggers, condition fields, operators and action forms entirely from `GET /api/v2/automations/registry` — no action-specific frontend code.
- [x] An invalid rule is rejected with field-level errors, not a single opaque message.
- [x] A new rule is created disabled by default.
- [x] A rule saved in the builder reopens in the builder with the same conditions and steps.
- [x] The v1 endpoints and v1 rules keep working unchanged.
- [ ] A user can complete the flow in a browser — **not yet verified, see progress.md**.

## Constraints & notes
- The manifest-driven form is the load-bearing constraint: the moment an action needs a
  hand-written Vue form, the action library stops growing. Adding an action must stay
  "one file in `engine/actions` + one registry line, zero frontend changes".
- Only `en.js` carries feature blocks (`IntegrationsHub` exists in no other locale), so
  en-only matches precedent rather than skipping the other thirteen by accident.
- `IntegrationsHub.vue` already has a small v1 automations section. It is left alone; the
  two can coexist until v1 rules are migrated.

## Resources
- `resources/blueprint.md` — §05 is the UI spec this follows.
