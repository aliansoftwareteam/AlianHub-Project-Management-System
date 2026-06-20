# Billable Flag — Test Cases

**Feature:** TIME-02 — Billable vs non-billable flag on time entries
**Backend:** `billable` field on the `timesheets` schema; persisted in `manualLogTime`; `Modules/TimeSheet/helpers/billableRules.js` + `getBillableSummary` (`POST /api/v1/timesheet/billable-summary`)
**Frontend:** billable toggle in `AddTimeLog.vue`; `BillableSummary.vue` readout in the User Timesheet toolbar
**Unit tests:** `tests/billable-rules.test.js` (7 cases, all green)
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| BF-01 | Toggle present, defaults billable | On a task, open **Add Time Log** | Observe the Billable row | A toggle labelled **Billable** is shown, checked by default | | ⬜ |
| BF-02 | Log a billable entry | Add Time Log open, toggle ON | Fill time + description, **Save** | Entry saved with `billable: true` | | ⬜ |
| BF-03 | Log a non-billable entry | Add Time Log open | Turn the toggle OFF (label flips to **Non-billable**), Save | Entry saved with `billable: false` | | ⬜ |
| BF-04 | Edit preserves/sets billable | An entry exists | Open **Edit Time Log**, flip the toggle, Update | Saved entry reflects the new billable value | | ⬜ |
| BF-05 | Summary readout | Entries exist for the selected week | Open User Timesheet | Toolbar shows **Billable: Xh Ym · Non-billable: Ah Bm** for the period | | ⬜ |
| BF-06 | Summary follows the week | Multiple weeks have entries | Change the RangePicker week | The billable/non-billable totals recompute for the new period | | ⬜ |
| BF-07 | Legacy entries count billable | Entries logged before this feature (no flag) | View summary | Those minutes appear under **Billable** (schema default) | | ⬜ |
| BF-08 | Scope matches the view | Member vs owner/admin | Compare summaries | Member sees own totals; owner/admin sees the team totals shown in the view | | ⬜ |
| BF-09 | Summary endpoint (API) | Known mix of billable/non-billable entries | `POST /api/v1/timesheet/billable-summary` `{userArray, start, end}` (seconds) | `{ billableMinutes, nonBillableMinutes, billableEntries, nonBillableEntries, totalMinutes }` correct | | ⬜ |
| BF-10 | Filter by project | Entries across projects | Pass `projectArray` to the summary | Totals limited to those projects | | ⬜ |

**Total:** 10 cases (UI/API — run on the dev server). Pure billable rules covered by 7 automated unit tests.
