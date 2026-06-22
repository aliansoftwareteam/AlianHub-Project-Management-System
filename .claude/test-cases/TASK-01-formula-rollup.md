# Test Cases — TASK-01 Formula / rollup custom fields (AHE-3747)

Two new **read-only** custom-field types:
- **Formula** — value computed from other numeric fields on the same task via a safe expression (`{Field Title}` refs, `+ - * / %`, parens).
- **Rollup** — aggregates one numeric field across a task's subtasks (sum / avg / count / min / max).

Both are computed **client-side at display time** from the live task store (`formulaEngine.js`) — dependency-free, **no `eval`**, no task write-path change, no new collection. Values stay live as the store updates over the socket.

## Architecture (why it can't break existing fields)
- Compute engine: `frontend/src/plugins/customFieldView/formulaEngine.js` (`computeCustomFieldValue`, 17/17 unit-tested).
- Definition schema: additive optional fields `formulaExpression` / `rollupSourceFieldId` / `rollupFunction` (custom-field DEFINITION only; task docs unchanged).
- All UI wiring is **additive** — new builder type entries, new config components, new read-only display components, and new `componentMap`/switch cases. No existing field-type case, validation, or render path was modified.
- Persistence rides the existing controller (`...updateObject` spread) — no backend write-path edit.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Types appear | open **+ Custom Field** | "Formula" + "Rollup" tiles listed (after re-seed / global records added — see Guards) |
| M2 | Create formula | pick Formula → title + expression `{Estimate} * 2` → save | field saved with `fieldType:'formula'`, `formulaExpression` persisted |
| M3 | Formula computes | task has numeric field Estimate=10 + the formula field | detail + table show **20** (read-only) |
| M4 | Formula bad/missing ref | expression references an empty/missing field | shows **—** (never errors, never `eval`) |
| M5 | Create rollup | pick Rollup → function `sum`, source = a number field → save | `rollupFunction:'sum'`, `rollupSourceFieldId` persisted; source hidden when function = `count` |
| M6 | Rollup sums subtasks | parent with 2 subtasks (number field 300 + 150) | parent shows **450**; avg 225; count 2; min 150; max 300 |
| M7 | Deleted subtask excluded | delete one subtask | rollup recomputes excluding it |
| M8 | Read-only | open a formula/rollup field on a task | value is display-only (no editable input, `pointer-event-none`) |
| M9 | Live update | change a referenced field / subtask value | computed value updates from the store |
| M10 | **Non-regression** | create/edit/display existing types (text, number, date, dropdown, money, textarea, email, phone, checkbox) | behave exactly as before — unchanged |

## Guards / non-regression
- **Existing installs:** the type tiles come from the global `GLOBAL_CUSTOM_FIELDS` collection, seeded from `utils/Tempates/customFields.js`. New companies get Formula/Rollup automatically; **existing companies need the two records added to that global collection** (re-seed or a one-off migration) — same maintained-records pattern as the project-view catalog. The compute/display/persistence all work regardless.
- Rollup needs the project's tasks in the store (`projectData/alltasks`); a guarded helper returns `[]` if unavailable, so rollup degrades to **—** rather than erroring.
- `count` ignores the source field by design.
- Frontend build clean (0 errors); engine logic covered by 17 node assertions.
