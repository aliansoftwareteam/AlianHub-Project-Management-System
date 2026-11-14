# 087 — example questions against the demo (TechNova, 2026-11-02)

No model key is configured on this machine, so `/ask/stream` answered with `configured: false` and the sources it **would** have sent. The context below is real output from the local server (port 4420, demo DB, signed in as the demo owner). The "expected answer" lines are written by hand from that context only, to show what a grounded answer looks like. They are **not** model output.

Counts were checked by hand against the database: Platform Engineering has 12 live tasks, `close` ×2, `active` ×8, `default_active` ×2.

## 1. "What is going on in this project?" (scope: Platform Engineering)

Briefing sent first (`[project:61a0d2]`, abridged):

```
Overall: off track.
12 tasks: 2 done, 10 open (17% done); 8 started (in an active status, not done); 1 overdue;
8 due in the next 7 days; 1 blocked; 3 high or urgent priority; 0 open with nobody assigned;
1 open with no due date; 2 finished in the last 7 days.
By status: Backlog 2, Ready 4, In Progress 2, In Review 1, QA 1, Done 2.
Open work by person:
- Omar Haddad: 4 open, 4 started, 0 overdue
- Nina Petrova: 3 open, 3 started, 1 overdue
- Basyierah Balqis, Grace Kim, Raj Iyer, Chloe Dubois: 1 open each
```

Then `[activity:61a0d2]` (22 lines, newest first, e.g. "Omar Haddad has changed Status as QA. [ENG-3]", "Grace Kim has linked this task — it now is blocked by ENG-2. [ENG-11]"), then the tasks worth naming:

```
[ENG-2]  overdue, high priority, started · In Review · Nina Petrova · due 2026-11-02 · priority high
[ENG-11] blocked, high priority, due soon · Backlog · Grace Kim · due 2026-11-06 · blocked by ENG-2, ENG-3
[ENG-3]  high priority, due soon, started · QA · Omar Haddad, Chloe Dubois · due 2026-11-04
[ENG-1]  due soon, started · Ready · Omar Haddad · due 2026-11-04
… ENG-4, ENG-5, ENG-12, ENG-6, ENG-7 (due soon), ENG-10, ENG-9 (done this week)
```

Expected answer (hand-written from the context):

> Platform Engineering is off track: 2 of 12 tasks are done (17%), 1 is overdue and 1 is blocked [project:61a0d2].
> **At risk** — the SSO redirect loop fix is overdue in review with Nina Petrova [ENG-2]; the 4.18 release notes are blocked by it and by the API rate limits work [ENG-11]; rate limits is in QA, due 2026-11-04 [ENG-3].
> **Who is on what** — Omar Haddad has 4 open, Nina Petrova 3 (one overdue) [project:61a0d2].
> **Recent activity** — ENG-3 moved to QA and went to Chloe Dubois; ENG-11 was linked as blocked by ENG-2 and ENG-3 [activity:61a0d2].

## 2. "What is Omar working on?" with `@Omar Haddad` (person)

```
[person:619f5a] Omar Haddad: 4 tasks, 0 done, 4 open; 0 overdue; 4 due in the next 7 days; 1 high priority.
By status: Ready 2, In Progress 1, QA 1. Open work by project: Platform Engineering 4.
[ENG-3] high priority, due soon · QA · due 2026-11-04
[ENG-1] due soon · Ready · due 2026-11-04
[ENG-4] due soon · In Progress · due 2026-11-05
[ENG-6] due soon · Ready · due 2026-11-08
```

Expected answer: four open tasks, all in Platform Engineering and all due this week, nothing overdue; the API rate limits work is in QA [ENG-3]…

## 3. "How is this list doing?" with `@List` (IT Operations)

```
[list:61a232] List "List" in IT Operations: 8 tasks, 3 done, 5 open (38%); 1 overdue; 1 blocked; 2 high or urgent.
By status: Reported 3, Investigating 1, Monitoring 1, Postmortem 1, Resolved 2.
Raj Iyer: 3 open, 2 started, 1 overdue · Grace Kim: 1 open
[OPS-1] INC-311 SSO sign-in failures for EU customers: overdue, high priority · Investigating · Raj Iyer · due 2026-11-02
```

## 4. "Find the onboarding doc" (no project, no @)

No briefing is added: the overview words are not in the question, so Ask behaves as before (here: no match).

## Screenshots

- `screenshots/1-picker-bare-at-suggestions.jpg` — `@` alone, scope Platform Engineering: grouped Projects / Lists / Tasks, scoped project first.
- `screenshots/2-chip-before-pick-fix.jpg` — a picked project as a chip (this build still removed the `@word`; fixed afterwards).
- `screenshots/3-asked-turn-keeps-chip-no-model.jpg` — the asked turn keeps its chip; the no-model note shows because no key is configured.
- `screenshots/4-picker-search-person.jpg` — `@omar` finds the person, with the key hint.
- `screenshots/5-person-chip-name-in-sentence.jpg` — after the pick fix: the name replaces `@omar` in the sentence and the chip carries the id.
