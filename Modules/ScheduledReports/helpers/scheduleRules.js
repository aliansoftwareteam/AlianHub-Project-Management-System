// REP-08 — pure scheduling rules for emailed reports (no DB, no I/O): cadence
// math, config validation, and the email body. Kept pure so the prod cron and
// the dev /run-due endpoint share identical, testable logic. Unit-tested in
// tests/schedule-rules.test.js.

const CADENCES = ['daily', 'weekly', 'monthly'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cleanRecipients = (list) => {
    const arr = Array.isArray(list) ? list : String(list || '').split(/[,;\s]+/);
    return [...new Set(arr.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
};

const validateSchedule = (cfg = {}) => {
    const errors = [];
    const savedReportId = cfg.savedReportId ? String(cfg.savedReportId) : '';
    if (!savedReportId) errors.push('savedReportId is required');
    const cadence = CADENCES.includes(cfg.cadence) ? cfg.cadence : 'weekly';
    const recipients = cleanRecipients(cfg.recipients);
    if (!recipients.length) errors.push('at least one valid recipient email is required');
    const active = cfg.active === undefined ? true : !!cfg.active;
    return {
        valid: errors.length === 0,
        errors,
        value: errors.length ? null : { savedReportId, cadence, recipients, active },
    };
};

// Next run = `from` + cadence interval. Pure — the caller passes `from` (no
// Date.now() here) so the schedule advancement is deterministic and testable.
const computeNextRun = (cadence, from) => {
    const base = (from instanceof Date) ? from : new Date(from);
    if (isNaN(base.getTime())) return null;
    const d = new Date(base.getTime());
    if (cadence === 'daily') d.setUTCDate(d.getUTCDate() + 1);
    else if (cadence === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCDate(d.getUTCDate() + 7); // weekly (default)
    return d;
};

// A schedule is due when it's active, not deleted, and its nextRunAt has passed
// (or was never set). Advancement of nextRunAt makes the runner idempotent.
const isDue = (schedule, now) => {
    if (!schedule || !schedule.active || schedule.deletedStatusKey === 1) return false;
    const next = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;
    if (!next || isNaN(next.getTime())) return true;
    return next.getTime() <= new Date(now).getTime();
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Pure HTML body for an emailed report.
const reportEmailHtml = ({ name = 'Report', dimensionLabel = 'Group', metricLabel = 'Value', rows = [], total = 0 } = {}) => {
    const body = (rows || []).map((r) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(r.label)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${esc(r.value)}</td></tr>`).join('');
    return `<div style="font-family:Arial,Helvetica,sans-serif;color:#33384a">
<h2 style="margin:0 0 12px">${esc(name)}</h2>
<table style="border-collapse:collapse;min-width:320px">
<thead><tr><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd">${esc(dimensionLabel)}</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #ddd">${esc(metricLabel)}</th></tr></thead>
<tbody>${body || '<tr><td colspan="2" style="padding:10px;color:#999">No data.</td></tr>'}<tr><td style="padding:6px 10px;font-weight:bold">Total</td><td style="padding:6px 10px;text-align:right;font-weight:bold">${esc(total)}</td></tr></tbody>
</table>
<p style="color:#9aa0b4;font-size:12px;margin-top:14px">Scheduled report delivered by AlianHub.</p>
</div>`;
};

const reportEmailSubject = (name) => `AlianHub report: ${name || 'Scheduled report'}`;

module.exports = { CADENCES, cleanRecipients, validateSchedule, computeNextRun, isDue, reportEmailHtml, reportEmailSubject };
