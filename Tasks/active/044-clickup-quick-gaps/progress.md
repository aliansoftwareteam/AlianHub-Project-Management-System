# 044 progress

- [x] 1 Custom fields on Board cards (#1183, build 650)
- [x] 2 Form responses link to their task (#1187, build 660)
- [x] 3 Language settings follow the person (#1184, build 651)
- [x] 4 Unblock stale agent templates (#1192, build 661)

## Log
- 2026-09-30: the owner asked to start the quick gaps from the build-645 re-check (#1180, build 646). All four slices started in parallel.
- 2026-09-30: the PC restarted under the load of 19 agents running full test suites. No work was lost: every slice had its commits in its worktree.
- 2026-10-01: agents resumed with the full suites left to CI. All four slices merged (builds 650–661).
  - **Slice 2** keeps `taskId` on a form response when the viewer can open the task, beside the new `task` link data; both are left out when the task is deleted or not openable.
  - **Slice 4** was larger than planned: an in-product agent acts only through a skill, so each template got a built-in skill (`fields.fill`, `prd.draft`, `wiki.upkeep`) and Field Filler got a registry action, `aifield.fill`, that runs the existing AI-field fill. `page.draft` now saves the page body, so an agent's draft no longer opens empty.
  - Checked in dark mode on the owner's local build 653 and 661.
- **Left for later:**
  - Field Filler skips a task whose description is under 40 characters.
  - On a shared browser, a local language setting saved before slice 3 is adopted once by the next person who has no account copy.
