# Sprint 7 and 8 screens — headless first pass (task 034)

Finding prefix `S78`. A headless first pass over the screens in follow-ups 77, 83 and 94, so the
owner's own sweep starts from fewer defects. It does not replace that sweep.

**Harness.** A throwaway server from `e2e/support/server.js` on its own Mongo (port 27185) with the
standard fixture workspace (owner, admin, member, guest, two projects, three tasks), started with
`API_TOKEN_STRICT=true`, `AUDIT_CHAIN=true` (with a key), `AGENT_TAINT_ROUTING=on`, `CSP_MODE=report`
and a local stub answering the chat model (DeepSeek-compatible URL), so no paid call was made.
Seeded on top: an agent with one tainted run (a web page, an email and a knowledge passage) and one
clean run; three tokens with no expiry or over the maximum lifetime; the workspace in `enforce`
long enough for the member to be refused twice, then back to `report`; one audit row edited behind
the chain and one row written without a chain; a task in the owner-only project. Retrieval was
swept with the workspace's `knowledgeRetrieval` unset (off) and `on`.

**Matrix.** Nine captures (Ask with the "why this answer" panel open, Accounts → tokens with the
strict form open, the token-expiry list, the audit log on All and on Refusals, Instance →
Enforcement with a workspace's rows open, the security policy card, Instance → Knowledge with the
workspace open, the agent page with the tainted run expanded) × owner and member × 1280 and 390 px ×
light and dark = 72, plus Ask with retrieval on (8). Chrome driven by `playwright-core`; the tours,
the getting-started card and the notification prompt were suppressed. Each capture was checked for
horizontal page scroll, elements past the right edge, content scrolling sideways inside its own
view, raw i18n keys, console errors and failed API calls, and by eye. The whole matrix was run again
on a rebuilt bundle after the fixes. Screenshots are not committed.

Clean across the matrix: no raw i18n keys, no horizontal page scroll at page level. With retrieval
on and off the member's Ask sources and "why this answer" rows came only from the shared project
(the owner-only task appeared for the owner only); members see only their own tokens and no expiry
list; the run view is read-only for a member.

## Findings

Severity: high = content unreadable or unusable, medium = clearly wrong but usable, low = polish.
Follow-up column: which of rows 77, 83 and 94 the screen belongs to.

| # | Screen | Role | Width / theme | Finding | Severity | Row | Fixed? |
|---|---|---|---|---|---|---|---|
| S78-01 | Ask (landing under the answer) | both | all / both | The landing is 48 px wider than its column (`width: 100%` plus the body's padding): at 390 the composer's Ask button is cut at the right edge and the view scrolls sideways; at 1280 the column sits 24 px off centre | medium | 77 | yes — `139f8cf1` |
| S78-02 | Ask | both | all / both | "3 open tasks you can see — ." when no open task has a shape: the list after the dash is empty | low | 77 | yes — `71813b2d` |
| S78-03 | Audit log | owner | 390 / both | The filter tabs are wider than the bar: labels wrap to two lines and "Refusals" is cut at the screen edge | medium | 77 | yes — `aded73ed` |
| S78-04 | Audit log | owner | all / both | A row from an earlier day shows only the clock ("23:23" for yesterday's unchained row), so it reads as today | medium | 77 | yes — `2aa9bc47` |
| S78-05 | Accounts → tokens, token-expiry list | owner | 390 / both | "exceeds the maximum lifetime · works until …" chip runs 37 px past the card; the meta line breaks inside words ("never use / d", "used 2 / 3/09/2026") | medium | 77, 83 | yes — `fa86652a` |
| S78-06 | Accounts → My account and the strict token form | both | all / both | Stacked fields have no space between them: each label sits on the input above, and the Link account button on the last input | low | 77 | yes — `330ed4bb` |
| S78-07 | Instance → Enforcement | owner | 1280 / both | The workspace's Mode select is squeezed to "Rep" by the table | medium | 83 | yes — `1baa9285` |
| S78-08 | Instance console, every tab (Enforcement, Knowledge, Egress, Health…) | owner | all / both | Cards stack edge to edge: a tab renders one root element, so the body's gap never reaches its banner and cards (banner on the first card, the security policy card on the decisions card) | low | 83, 94 | yes — `0273295e` |
| S78-09 | Instance → Enforcement, Egress, Instruction guard, Knowledge (by URL); Audit log (by URL) | member | all / both | These four instance tabs have no settings nav item, so the settings guard never sent a non-owner away: a member saw the console's tab strip and "Only the instance owner can do this." twice. The server refuses every call. Separately, a page the nav hides (the audit log for a member) mounted and fired its own refused request before the redirect | medium | 83, 94 | yes — `c81e487d` |
| S78-10 | Agent page → recent runs (run view) | both | all / both | The run's status chip shows the stored code ("done", "waiting_approval") | low | 83 | yes — `a8105291` |
| S78-11 | Instance → Enforcement → security policy card | owner | 390 / both | Once reports exist, the blocked-source table is wider than the card and pushes the console body 14 px sideways | medium | 94 | yes — `8f193559` |
| S78-12 | Every screen with a coloured chip (integrity states, "Report", readiness, "Read external content", expiry chips) | both | all / dark | `:root[data-theme="dark"] .ah-chip` out-specifies the `.ah-chip--ok/--warn/--danger/--brand` backgrounds, so in dark every coloured chip is coloured text on the neutral grey chip ("Broken at #2" red on grey) | medium | 77, 83, 94 | no — `tokens.css` is in open PR #898 |
| S78-13 | Audit log | owner | all / both | When the entity name is the id (a refusal's permission key, `settings.settings_member_list`), the id line repeats it under the name | low | 77 | no — whether to hide an id equal to the name, given "names aren't covered by the integrity check", is a product call |
| S78-14 | Instance → Knowledge | owner | all / both | The banner says "The indexer is on: KNOWLEDGE_INDEXER=tenant" while the only workspace reads "Indexer · off"; true (the switch is available) but reads as a contradiction | low | 94 | no — wording decision |
| S78-15 | Instance → Enforcement, Knowledge, Egress (cards) | owner | all / both | Paragraphs inside a card keep their default margins inside the card's flex column, so lead text and the next line are ~40 px apart while other gaps are 8 px (security policy card: lead → "Set in the environment…") | low | 94 | no — shared `.in-card` rule; worth one pass across the console |
| S78-16 | Instance → Enforcement | owner | all / both | "…and on every other server within 0 seconds." when the cache TTL is 0 | low | 83 | no — copy for the zero case |
| S78-17 | Security policy card | owner | all / both | In report mode the card recorded 13 `font-src` reports for `fonts.gstatic.com` during the sweep. The app's own fonts come from `fonts.gstatic.com/s/`, which the policy allows, and a later capture of the violations on Ask, the audit log, Enforcement and the signed-out pages raised none; the stored row keeps only the host, so the card cannot say which URL was blocked | medium | 94 | no — needs a look before `CSP_MODE=enforce` |
| S78-18 | Instance → Health (seen in passing) | owner | 1280 / light | The setup checklist ("3/5 Set up this instance", struck-through steps, "Back up now", "Dismiss") renders as unstyled text and browser-default buttons | low | — | no — outside the listed screens |
| — | Instance console tab strip | owner | 390 / both | Only about one tab fits beside "Instance" and "Admin guide" | medium | 83, 94 | already UIX-13 |
| — | Ask | both | all / both | `Firebase: No Firebase App '[DEFAULT]'` page error on load | low | 77 | already UIX-20 |

Fixed: 11. Open: 7 new (S78-12 to S78-18), plus two already on the UI sweep list.

By follow-up row:

- **77** (Ask "why this answer", tokens under strict mode, audit integrity and refusals):
  6 fixed (S78-01 to S78-06), 2 open (S78-12, S78-13).
- **83** (Enforcement, token-expiry list, run view): 5 fixed (S78-05, S78-07 to S78-10),
  2 open (S78-12, S78-16).
- **94** (Knowledge tab, security policy card): 3 fixed (S78-08, S78-09, S78-11), 4 open
  (S78-12, S78-14, S78-15, S78-17).

## What the owner's sweep still covers

States this pass did not reach: Ask with no model connected (the server needs a restart without a
provider), the "not yet verified" integrity state (covered by `auditLogIntegrity.spec.js`), a
knowledge re-index running, a CSP policy in `enforce`, a stopped token (past its grace), and any
browser other than Chrome.
