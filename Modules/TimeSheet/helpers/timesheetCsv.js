// TIME-04 — timesheet CSV (payroll) builder. Pure — no I/O — shared by the
// export controller and tests.

const CSV_HEADERS = ['User', 'Project', 'Date', 'Description', 'Billable', 'Hours'];

// RFC-4180 field escaping: quote when the value contains a comma, quote or newline.
const escapeCsv = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// LogStartTime is stored in Unix SECONDS.
const formatDate = (logStartSeconds) => {
    const d = new Date((Number(logStartSeconds) || 0) * 1000);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/* Build a payroll CSV string from time entries.
 * entry: { Loggeduser, ProjectId, LogStartTime(seconds), LogDescription,
 *          billable?, LogTimeDuration(minutes) }
 * maps:  { userMap: {id:name}, projectMap: {id:name} } — names fall back to id. */
const buildTimesheetCsv = (entries, { userMap = {}, projectMap = {} } = {}) => {
    const lines = [CSV_HEADERS.join(',')];
    (entries || []).forEach((e) => {
        if (!e) return;
        const user = userMap[e.Loggeduser] || e.Loggeduser || '';
        const project = projectMap[e.ProjectId] || e.ProjectId || '';
        const hours = ((Number(e.LogTimeDuration) || 0) / 60).toFixed(2);
        const billable = e.billable === false ? 'No' : 'Yes';
        lines.push([
            escapeCsv(user),
            escapeCsv(project),
            escapeCsv(formatDate(e.LogStartTime)),
            escapeCsv(e.LogDescription || ''),
            escapeCsv(billable),
            escapeCsv(hours),
        ].join(','));
    });
    return lines.join('\n');
};

module.exports = { CSV_HEADERS, escapeCsv, formatDate, buildTimesheetCsv };
