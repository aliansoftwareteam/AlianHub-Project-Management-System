const { getTask, recordAutomationAudit, DeterministicError } = require('../tools');
const notices = require('../noticeRecipients');
const { textHtml } = require('../../../Template/emailText');
const { decodeCommentText } = require('../../../Comments/helpers/plainText');
const { Notification_key } = require('../../../../Config/notificationKey');

const CHANGE_TYPE = 'automation_notify';
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const plainTask = (task) => (task && task.toObject ? task.toObject() : task);

/* The rendered template as plain text: a task name the web app stored escaped is decoded once, so every
 * surface escapes the same text exactly once. */
const textOf = (config) => decodeCommentText(config.message).replace(/\s+/g, ' ').trim().slice(0, notices.MAX_MESSAGE * 2);

/* The rule is the sender: the pipeline drops the sender from the recipients, and looks it up by object id. */
const send = async ({ companyId, task, text, recipients, context }) => {
    // Required here: the pipeline pulls in storage and the user controllers, which must not load just because the engine did.
    const { handleNotificationtFun } = require('../../../notification/prepare-notification-data/controllerV2');
    const now = new Date();
    await handleNotificationtFun({ body: {
        createdAt: now, updatedAt: now,
        key: Notification_key.TASK_NOTIFICATION, type: 'tasks', changeType: CHANGE_TYPE,
        // The Inbox renders this row from changeData through i18n; message is for push and email, which take HTML.
        changeData: { ruleId: String(context.ruleId), ruleName: context.ruleName || '', runId: context.runId || null, taskKey: task.TaskKey || '', taskName: decodeCommentText(task.TaskName), text },
        message: textHtml(text),
        companyId: String(companyId), projectId: String(task.ProjectID || ''), taskId: String(task._id),
        userId: String(context.ruleId), assigneeUsers: recipients, notSeen: recipients, directUsers: recipients,
        isSelected: false, folderId: task.folderObjId ? String(task.folderObjId) : '', sprintId: String(task.sprintId || ''), comments_id: '',
    } });
};

module.exports = {
    key: 'notify',
    label: 'Send a notification',
    appliesTo: ['task'],
    scopes: ['task.notify'],
    schema: {
        recipients: { type: 'user_multi', label: 'Recipients', required: true, roles: notices.ROLES },
        message: { type: 'textarea', label: 'Message', required: true, supportsTemplates: true },
        includeActor: { type: 'boolean', label: 'Also notify the person who caused the event' },
    },
    validate: (config) => notices.configErrors(config),

    /* What run() would do, without sending or taking a rate-limit slot. */
    async preview({ companyId, task, config, context = {} }) {
        const plan = await notices.planNotice({ companyId, task: plainTask(task), config, context });
        return { wouldNotify: plan.recipients, skipped: plan.skipped };
    },

    async run({ companyId, entity, config, context = {} }) {
        if (!OBJECT_ID.test(String(context.ruleId || ''))) throw new DeterministicError('a notification needs the rule that sends it');
        const text = textOf(config);
        if (!text) throw new DeterministicError('notification message is empty');
        const task = plainTask(await getTask(companyId, entity.id));
        const plan = await notices.planNotice({ companyId, task, config, context });

        const notified = [];
        const skipped = [...plan.skipped];
        for (const person of plan.recipients) {
            // eslint-disable-next-line no-await-in-loop
            if (await notices.claimSlot(companyId, context.ruleId, person.userId, Date.now())) notified.push(person);
            else skipped.push({ ...person, reason: 'rate_limited' });
        }

        if (notified.length) {
            await send({ companyId, task, text, recipients: notified.map((person) => person.userId), context });
            recordAutomationAudit(companyId, context, {
                action: 'automation.task.notify',
                entityType: 'task',
                entityId: String(task._id),
                entityName: task.TaskName || '',
                meta: { runId: context.runId || null, ruleId: context.ruleId || null, notified: notified.map((person) => person.userId) },
            });
        }
        return { changed: notified.length > 0, notified, skipped };
    },
};
