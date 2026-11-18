---
id: 023
title: Sprint 0 — stop the bleeding: exploitable findings and cost correctness
status: done
priority: high
depends_on: []
created: 2026-09-10
---

# 023 — Sprint 0 — stop the bleeding: exploitable findings and cost correctness

Status: done · sprint 0 · one week · branch `feat/sprint-0-stop-the-bleeding` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 0. Filed 2026-09-10.

## Goal
No exploitable finding survives, and spend accounting is correct everywhere.

## Scope
1. Merge the two open pull requests, housekeeping (#551) first and then task 017 (#552), so every later branch starts from the checkpointed engine.
2. Outbound fetches resolve before they validate, check every resolved address against private ranges, revalidate on each redirect, and cap size and time (`Modules/Agents/engine/pageAudit.js`).
3. Retrieval applies the page visibility rule the other read paths already use (`Modules/AI/ask.js`); the MCP document-read tool applies the token's project scope and visibility (`Modules/Mcp/tools.js`); the MCP path re-checks company membership like the REST path does (`Modules/Mcp/server.js`).
4. Performing an agent action evaluates the holder's permission catalogue entry, not only the registry (`Modules/Agents/actions.js`).
5. Pricing fails closed: an unpriced model refuses to start a billed run with a reason that names the missing price, and defaults ship for every configured vendor (`usage.js`, `runs.recordSpend`).
6. A test asserts the never-list and the action table can never overlap. A failed audit write fails the action. The undo path enforces the undo window and the caller's project visibility. Integration secrets are encrypted with the existing cloud-storage idiom, with a migration.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| G Undo | Run detail and audit → undo | extend | The undo window shown as a deadline and enforced, with the reason when it has passed; undo hidden outside the caller's visible projects |

## Defects closed
#1, #3, #4, #5, #6, #7, #8, #10, #11, #19 from the document's defect table.

## Out of scope
- Defect 2 (permission guards skipped for browser sessions) waits for Sprint 8, because it needs backend and frontend catalogue parity and a report-only stage first. Deliberate, not a miss.

## Acceptance
- [ ] The two data-access findings reproduce on the previous commit and fail to reproduce after; the in-process sweep books a non-zero cost on every configured provider.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- Six small pull requests, each with a test that reproduces the defect first. The only schema change is the secrets migration, run by the migrations runner. No flags.
- Overlaps 016 (undo window, budgets, never-list): 016 shipped 2026-09-05; this sprint fixes what the review found in it.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
