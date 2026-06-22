// Personal reminders (COLLAB-03) — pure rule helpers. No DB / network /
// mongoose here so they can be unit-tested in isolation (see
// tests/collab-reminders-rules.test.js), mirroring autoArchiveRules.js.

// A reminder is "due" when it is not soft-deleted, has not already fired, and
// its scheduled time is at or before the reference moment.
function isReminderDue(reminder, now) {
    if (!reminder) return false;
    if (Number(reminder.deletedStatusKey) === 1) return false;
    if (reminder.fired === true) return false;
    if (!reminder.reminderAt) return false;
    const at = new Date(reminder.reminderAt).getTime();
    if (Number.isNaN(at)) return false;
    const ref = (now ? new Date(now) : new Date()).getTime();
    return at <= ref;
}

// Default human message for a reminder that has no custom text.
function reminderMessage(reminder) {
    const text = reminder && typeof reminder.reminderText === 'string' ? reminder.reminderText.trim() : '';
    return text || 'You have a reminder.';
}

// Build the in-app notification document for a due reminder. The shape mirrors
// the docs written by Modules/notification/prepare-notification-data
// (createNotificationsBody) — every `required` field on the notifications
// schema is populated. `key`/`type` use 'tasks' so it threads through the same
// in-app notification surface as task notifications; the recipient is the
// reminder owner, so userId, assigneeUsers and notSeen all carry that id.
function buildReminderNotification(reminder, now) {
    const ref = now ? new Date(now) : new Date();
    const owner = reminder && reminder.userId ? String(reminder.userId) : '';
    const projectId = reminder && reminder.projectId ? String(reminder.projectId) : '';
    const taskId = reminder && reminder.taskId ? String(reminder.taskId) : '';
    return {
        key: 'task_reminder',
        message: reminderMessage(reminder),
        projectId,
        taskId,
        type: 'tasks',
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

// Same generator shape used by prepare-notification-data/controllerV2.js.
function generateUniqueId() {
    const timestamp = new Date().getTime().toString(36);
    const randomString = Math.random().toString(36).substr(2, 5);
    return timestamp + randomString;
}

module.exports = {
    isReminderDue,
    reminderMessage,
    buildReminderNotification,
    generateUniqueId,
};
