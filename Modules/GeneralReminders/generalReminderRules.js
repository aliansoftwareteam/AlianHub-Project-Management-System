// General-purpose reminders — pure rule helpers. No DB / network / mongoose here
// so they can be unit-tested in isolation, mirroring Modules/Reminders/remindersRules.js.
//
// This module is deliberately independent of Modules/Reminders (the task-scoped
// "Remind me" flow). These reminders are standalone: they carry their own title,
// description, notify lead-time, attachments and recipient.

// notifyBefore sentinel: the user chose "Don't notify" — the reminder still
// lives on their list, it just never raises a notification.
const DONT_NOTIFY = -1;

// The preset lead times offered by the UI, in minutes.
const NOTIFY_PRESETS = {
    ON_DUE_DATE: 0,
    TEN_MINUTES: 10,
    ONE_HOUR: 60,
};

// Lead time in minutes. Anything unparseable falls back to 0 ("on due date").
// DONT_NOTIFY (-1) is preserved; negative values other than the sentinel are
// clamped to 0 so a bad payload can never schedule a notification in the past.
function normalizeNotifyBefore(value) {
    const lead = Number(value);
    if (!Number.isFinite(lead)) return 0;
    if (lead === DONT_NOTIFY) return DONT_NOTIFY;
    return lead > 0 ? Math.floor(lead) : 0;
}

// remindAt shifted back by the lead time — the moment the notification fires.
// Returns null when the input isn't a usable date.
function computeNotifyAt(remindAt, notifyBefore) {
    if (!remindAt) return null;
    const at = new Date(remindAt).getTime();
    if (Number.isNaN(at)) return null;
    const lead = normalizeNotifyBefore(notifyBefore);
    if (lead <= 0) return new Date(at);
    return new Date(at - (lead * 60 * 1000));
}

// A reminder is "due" when it is not soft-deleted, not already completed, has
// not already fired, the user hasn't opted out of notification, and its firing
// moment is at or before the reference moment.
function isReminderDue(reminder, now) {
    if (!reminder) return false;
    if (Number(reminder.deletedStatusKey) === 1) return false;
    if (reminder.isDone === true) return false;
    if (reminder.fired === true) return false;
    if (Number(reminder.notifyBefore) === DONT_NOTIFY) return false;
    if (!reminder.remindAt) return false;
    const at = reminder.notifyAt
        ? new Date(reminder.notifyAt).getTime()
        : new Date(reminder.remindAt).getTime();
    if (Number.isNaN(at)) return false;
    const ref = (now ? new Date(now) : new Date()).getTime();
    return at <= ref;
}

// Plain-text title. Used for the email subject, so it must stay free of markup.
function reminderMessage(reminder) {
    const title = reminder && typeof reminder.title === 'string' ? reminder.title.trim() : '';
    return title || 'You have a reminder.';
}

// Longest description we inline into the notification list before truncating —
// the sidebar row is narrow and this keeps it readable.
const NOTIFICATION_DESC_LIMIT = 180;

// Body for the in-app notification. The notification sidebar renders this with
// v-html (Header.vue), so BOTH the title and the description must be escaped —
// they are user input and would otherwise be an injection vector.
function reminderNotificationMessage(reminder) {
    const title = escapeHtml(reminderMessage(reminder));
    const raw = reminder && typeof reminder.description === 'string' ? reminder.description.trim() : '';
    if (!raw) return `<b>${title}</b>`;
    const clipped = raw.length > NOTIFICATION_DESC_LIMIT
        ? `${raw.slice(0, NOTIFICATION_DESC_LIMIT).trimEnd()}…`
        : raw;
    return `<b>${title}</b><br/><span style="color:#6B6B70;">${escapeHtml(clipped)}</span>`;
}

// The shared `notifications` schema marks projectId as required, but a
// standalone reminder belongs to no project. This sentinel keeps the document
// valid without touching that shared schema. It is deliberately not a real id:
// Header/helper.js#openRoute looks the project up, finds nothing, and bails out
// with an info toast instead of navigating — the desired no-op for a reminder
// that has nowhere to link to.
const GENERAL_REMINDER_SCOPE = 'general-reminder';

// Build the in-app notification document. Shape mirrors the docs written by
// Modules/notification/prepare-notification-data (createNotificationsBody) so it
// threads through the existing in-app notification surface — every `required`
// field on the notifications schema is populated. The recipient is the reminder
// owner, so userId, assigneeUsers, notSeen and receiverID all carry that id.
function buildReminderNotification(reminder, now) {
    const ref = now ? new Date(now) : new Date();
    const owner = reminder && reminder.userId ? String(reminder.userId) : '';
    return {
        key: 'general_reminder',
        message: reminderNotificationMessage(reminder),
        projectId: GENERAL_REMINDER_SCOPE,
        taskId: '',
        type: 'reminder',
        userId: owner,
        assigneeUsers: owner ? [owner] : [],
        notSeen: owner ? [owner] : [],
        receiverID: owner,
        companyId: reminder && reminder.companyId ? String(reminder.companyId) : '',
        notificationType: 'push',
        isSchedule: false,
        isSeen: false,
        notificationStatus: 'in-process',
        uniqueId: generateUniqueId(),
        createdAt: ref,
        updatedAt: ref,
    };
}

// --- email ---------------------------------------------------------------
// Plain string builders, mirroring Modules/TimeSheet/helpers/reminderRules.js
// and Modules/ScheduledReports/helpers/scheduleRules.js. Kept pure so they can
// be unit-tested without a transport.

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function reminderEmailSubject(reminder) {
    return `Reminder: ${reminderMessage(reminder)}`;
}

// Formats the due moment for the email body. Kept simple and locale-free so the
// output is stable regardless of server locale.
function formatRemindAt(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toUTCString().replace(' GMT', ' UTC');
}

function reminderEmailHtml(reminder, userName) {
    const title = escapeHtml(reminderMessage(reminder));
    const greeting = userName ? `Hi ${escapeHtml(userName)},` : 'Hi,';
    const description = reminder && reminder.description ? String(reminder.description).trim() : '';
    const when = formatRemindAt(reminder && reminder.remindAt);
    const files = Array.isArray(reminder && reminder.attachments) ? reminder.attachments : [];

    let body = ''
        + '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#191A2B;line-height:1.6;">'
        + `<p style="margin:0 0 14px;">${greeting}</p>`
        + '<p style="margin:0 0 14px;">This is your reminder:</p>'
        + '<div style="padding:14px 16px;background:#F7F8FC;border-left:3px solid #2F3990;border-radius:0 6px 6px 0;">'
        + `<div style="font-size:16px;font-weight:600;color:#191A2B;">${title}</div>`;
    if (description) {
        body += `<div style="margin-top:6px;color:#4B4D60;">${escapeHtml(description)}</div>`;
    }
    if (when) {
        body += `<div style="margin-top:10px;font-size:12px;color:#84869B;">Due: ${escapeHtml(when)}</div>`;
    }
    body += '</div>';

    if (files.length) {
        body += '<p style="margin:16px 0 6px;font-weight:600;">Attachments</p><ul style="margin:0;padding-left:18px;color:#4B4D60;">';
        files.forEach((f) => {
            const name = escapeHtml((f && f.name) || 'file');
            const url = f && f.url ? String(f.url) : '';
            body += url
                ? `<li><a href="${escapeHtml(url)}" style="color:#2F3990;">${name}</a></li>`
                : `<li>${name}</li>`;
        });
        body += '</ul>';
    }

    body += '<p style="margin:18px 0 0;font-size:12px;color:#84869B;">You are receiving this because a reminder was set for you.</p></div>';
    return body;
}

// Same generator shape used by prepare-notification-data/controllerV2.js.
function generateUniqueId() {
    const timestamp = new Date().getTime().toString(36);
    const randomString = Math.random().toString(36).substr(2, 5);
    return timestamp + randomString;
}

module.exports = {
    GENERAL_REMINDER_SCOPE,
    DONT_NOTIFY,
    NOTIFY_PRESETS,
    normalizeNotifyBefore,
    computeNotifyAt,
    isReminderDue,
    reminderMessage,
    reminderNotificationMessage,
    buildReminderNotification,
    reminderEmailSubject,
    reminderEmailHtml,
    generateUniqueId,
};
