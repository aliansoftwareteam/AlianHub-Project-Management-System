// TIME-06 time-entry reminder rules. Pure — no I/O — shared by the service and tests.

const REMINDER_KEY = 'time_entry_reminder';

/* Members who still need a nudge: those with an email who are NOT in the set of
 * users that already logged time in the window.
 *
 * `allowedUserIds` is optional. When it is an array, recipients are further
 * restricted to that set (the per-company "send only to selected users"
 * policy) — an empty array therefore yields no one. When it is null/undefined
 * there is no restriction (legacy "everyone" behaviour). */
const usersNeedingReminder = ({ users = [], loggedUserIds = [], allowedUserIds = null } = {}) => {
    const logged = new Set((loggedUserIds || []).map((id) => String(id)));
    const allowed = Array.isArray(allowedUserIds)
        ? new Set(allowedUserIds.map((id) => String(id)))
        : null;
    return (users || []).filter((u) => u && u._id && u.Employee_Email
        && !logged.has(String(u._id))
        && (allowed === null || allowed.has(String(u._id))));
};

const reminderSubject = () => 'Reminder: log your time';

const reminderHtml = (name) => {
    const who = name ? String(name).split(' ')[0] : 'there';
    return `<p>Hi ${who},</p>`
        + `<p>This is a friendly reminder to log your time for today in AlianHub. `
        + `Keeping your timesheet up to date helps your team and keeps approvals on track.</p>`
        + `<p>— AlianHub</p>`;
};

module.exports = { REMINDER_KEY, usersNeedingReminder, reminderSubject, reminderHtml };
