// TIME-02 billable rules. Pure — no I/O — shared by controllers and tests.
//
// `billable` is a boolean flag on each time entry. Entries written before this
// feature have no field at all; those count as BILLABLE (matching the schema
// default of true), so only an explicit `false` is treated as non-billable.

const normalizeBillable = (v) => v !== false;

/* Split an array of time entries into billable / non-billable minute totals.
 * Each entry: { billable?: boolean, LogTimeDuration: number (minutes) }. */
const summarize = (entries) => {
    let billableMinutes = 0;
    let nonBillableMinutes = 0;
    let billableEntries = 0;
    let nonBillableEntries = 0;
    (entries || []).forEach((e) => {
        const mins = Number(e && e.LogTimeDuration) || 0;
        if (e && e.billable === false) {
            nonBillableMinutes += mins;
            nonBillableEntries += 1;
        } else {
            billableMinutes += mins;
            billableEntries += 1;
        }
    });
    return {
        billableMinutes,
        nonBillableMinutes,
        billableEntries,
        nonBillableEntries,
        totalMinutes: billableMinutes + nonBillableMinutes,
    };
};

module.exports = { normalizeBillable, summarize };
