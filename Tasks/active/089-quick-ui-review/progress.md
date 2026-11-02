# Progress: Quick UI/UX review

## Checklist

- [x] Branch `fix/ui-quick-review` from `origin/chore/pre-staging`
- [x] Local server on :4440, Vite dev on :5440 against the demo DB (read-only)
- [x] Walk surfaces at 1440 and 375
- [x] Fixes with before/after screenshots (7)
- [x] style:check and i18n:check pass
- [x] Report published: https://claude.ai/artifact/HrCzhKnXteBnoQ9gam4zTj (private; `report.html` here)

## Log

- 2026-11-02: walked all surfaces at 1440/375 (English forced in the browser; the demo owner's language is "ch" in the DB).
- Fixes 01–07 committed separately: auth shell width, rail label centring, project detail alignment, setup chip hover token, team activity time wrap, EmptyState box sizing, task properties column cascade.
- Four of the seven came from width/height plus padding on a content box; a global border-box reset is listed as a follow-up in the report.
- Attached timesheet-tabs screenshot could not be reproduced on chore/pre-staging; left to task 086 (owns views/Timesheet).
- Awaiting owner review; nothing pushed.
