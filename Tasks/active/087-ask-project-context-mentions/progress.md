# 087 — progress

## 2026-11-02

- Branch `feat/ask-mentions` from `origin/chore/pre-staging` (ca7f83412).
- Read the Ask page, composer, stream route, `askContext.js`, `askStructured.js`, `taskContext.js`, global search. An `@` picker already existed (projects, tasks, docs; 2+ characters; flat list); a pinned project sent only its name and description.
- Sampled the demo DB read-only (TechNova): task, history and `recentVisits` shapes.
- No model key is configured on this machine (no `.env` key, `ANTHROPIC_API_KEY` unset): answers cannot be generated locally; the context the model would receive is verified instead.
- Backend: `Modules/AI/askBriefing.js` (project, list and person briefings: exact counts, per-status / per-person / per-list rows, 14-day activity from `history`, the tasks worth naming with why), wired through `askContext.pin()`; a pinned task now also brings its comments, subtasks and linked docs (`taskContext`). Briefing answers may use 1500 tokens instead of 900.
- Backend: `GET /api/v1/ai/ask/mentions` (`Modules/AI/askMentions.js`): search or suggestions over projects, lists, tasks, docs and people, through the asker's reach. Route added, so the follow-up docs PR runs `npm run api:doc` (Rule 4).
- Shared code touched: `Modules/AI/askStructured.js` now exports `askerZone` (one line).
- Frontend: the `@` picker opens on a bare `@`, calls the new route, groups rows under headings, puts recent picks (localStorage, per company) first, shows kind icons on chips and keeps the chips on the asked turn. "Why these sources" names the new kinds.
- Tests: `tests/ai-ask-briefing.test.js` (26), `tests/ai-ask-mentions.test.js` (7), `frontend/tests/unit/askMentions.spec.js` (7), `askComposer.spec.js` updated (+1). All `tests/ai-ask*` pass; convention failures (plain-words, ci-e2e-shards, ai-core-boundary, style-check baseline form, role-playbooks) are identical on a clean base checkout.
- i18n: 11 new `Ask.*` keys, backfilled; `menu_context_hint` dropped (no longer used). `i18n:check` and `style:check` pass.
- Browser check (local :4420, demo DB, TechNova, model not configured): bare `@` suggestions, `@pla` search, `@omar` person search, Enter/Tab pick, chip on the asked turn. Briefings checked through the stream route against the DB by hand (Platform Engineering 12/2 done, IT Operations list 8/3, Omar 4 open). See `examples.md` and `screenshots/`.
- Fixed after the real-data check: list names read as "undefined" (a Mongoose document spread); "in progress" counted Ready (an active-type status), now "started"; activity lines written twice (project and task rows) kept once; a doubled period after a description.
- Picking a mention now puts its name where the `@word` was, so the question reads as a sentence ("How is Omar Haddad doing this week?"); before, the word was removed ("What is going on in and…").
- The stale English copy of `Ask.composer_placeholder` in the other locales was updated to the new text.

## Open

- Answers not generated: no model key here. Needs one run with a key: ask "What is going on in this project?" on Platform Engineering and check the answer cites `[project:…]` and task refs and keeps the briefing's numbers.
- `npm run api:doc` for `GET /api/v1/ai/ask/mentions` belongs in the follow-up docs PR (Rule 4).
- The command palette's one-shot Ask (`POST /api/v1/ai/ask`) does not take `@` context or briefings yet.
