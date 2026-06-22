# Test Cases — "+ View" icon-fallback crash fix

**Bug:** Clicking **+ View** threw `Cannot read properties of undefined (reading 'icon')`
and white-screened the dropdown. Root cause: `projectComponentsIcons(keyName)`
(commonFunction.js) returned `undefined` when a catalog record's `keyName` was not in
its hardcoded icon array, and callers read `.icon` / `.activeIcon` directly. Since the
PROJECT_TAB_COMPONENTS catalog is user-maintained (records added to existing companies),
the frontend must not assume every keyName is known.

**Fix:** `projectComponentsIcons()` now returns a default-icon fallback object
(`{ icon, activeIcon, keyName }`) instead of `undefined` — one change that protects every
caller (the "+ View" dropdown, the active tab strip, and the template / project-creation /
project-settings catalogs, ~10 call sites total). Added optional-chaining at the two
directly affected spots (ViewsDropdown, ViewsList) as belt-and-suspenders.

## Manual / regression test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| R1 | Known views | open "+ View" with all 5 new views in the catalog | dropdown renders; each view shows its proper icon; no console error |
| R2 | Unknown keyName | catalog record with a keyName not in the icon array | dropdown still renders; that row shows the default icon; **no crash** |
| R3 | Tab strip | a project with a view whose keyName is unknown | the horizontal view tab renders with the default icon, not a blank/crash |
| R4 | Template / settings catalogs | open Template detail, Create Project view-picker, Project listing settings | all render with icons or the default; no `reading 'icon'` error |
| R5 | Add a view | "+ View" → pick a new view → Add | adds normally; tab appears with correct label + icon |

## Guards / non-regression
- Pure hardening: the helper's contract changes from "may return undefined" to "always
  returns an icon object". No behavior change for known keyNames (same icons as before).
- Fallback icon is `comp_gantt_*` (guaranteed present); no new assets.
- Frontend-only; no backend, schema, or catalog change.
