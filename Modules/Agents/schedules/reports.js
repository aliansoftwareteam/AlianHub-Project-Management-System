const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { CLOSED_STATUS_TYPES, isClosedTask, isBlockedTask, blockedClauses, taskRef } = require('../../Tasks/helpers/taskSignals');
const { riskReasons, riskWindow } = require('../../UserDashboard/atRisk');
const { standupWindow } = require('../team');
const { DAY_MS } = require('../../../utils/localDay');
const { Notification_key } = require('../../../Config/notificationKey');

// The built-in report skills. Each reads facts with the queries Home already uses,
// inside the task filter of the person the schedule runs as, and returns them as
// sections; the model only writes the summary line on top.

const REPORT_KEYS = Object.freeze(['daily_briefing', 'deadline_watch', 'mentions_digest', 'weekly_status']);
const TITLES = Object.freeze({
    daily_briefing: 'Daily briefing',
    deadline_watch: 'Deadline watch',
    mentions_digest: '@mentions digest',
    weekly_status: 'Weekly status',
});
const SECTION_LABELS = Object.freeze({
    due_today: 'Due today',
    overdue: 'Overdue',
    new_assignments: 'New assignments',
    mentions: 'Mentions',
    due_soon: 'Due soon',
    at_risk: 'At risk',
    unanswered: 'Waiting for your reply',
    project: 'Project',
});
const DEFAULT_DAYS = 3;
const MAX_DAYS = 30;
const LISTED = 10;
const CANDIDATES = 400;
const WEEK_MS = 7 * DAY_MS;
const PROJECTS_LISTED = 20;
const EXCERPT = 160;
const TASK_FIELDS = { TaskName: 1, TaskKey: 1, ProjectID: 1, sprintId: 1, sprintArray: 1, folderObjId: 1, statusType: 1, status: 1, DueDate: 1, relations: 1, AssigneeUserId: 1, createdAt: 1, updatedAt: 1 };
const LIVE = { deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true } };

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const timeOf = (value) => (value ? new Date(value).getTime() : NaN);
const daysOf = (options) => {
    const n = Number(options && options.days);
    return Number.isInteger(n) && n >= 1 && n <= MAX_DAYS ? n : DEFAULT_DAYS;
};

const findTasks = (companyId, scope, filter, { sort = { DueDate: 1 }, limit = CANDIDATES } = {}) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS, data: [{ $and: [scope, LIVE, filter] }, TASK_FIELDS, { sort, limit }],
}, 'find').then((rows) => rows || []);

const projectNames = async (companyId, tasks) => {
    const ids = [...new Set(tasks.map((t) => String(t.ProjectID || '')).filter(Boolean))];
    if (!ids.length) return {};
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: idForms(ids) } }, { ProjectName: 1 }] }, 'find').catch(() => []);
    return Object.fromEntries((rows || []).map((p) => [String(p._id), p.ProjectName || '']));
};

const itemOf = (task, names, extra = {}) => ({
    ...taskRef(task),
    projectName: names[String(task.ProjectID)] || '',
    dueDate: task.DueDate || null,
    status: (task.status && (task.status.text || task.status.value)) || '',
    ...extra,
});

const section = (key, items, extra = {}) => ({ key, label: SECTION_LABELS[key], total: items.length, items: items.slice(0, LISTED), ...extra });

/* Tasks among `ids` the owner can open, keyed by id. */
const visibleByIds = async (companyId, scope, ids) => {
    const wanted = [...new Set(ids.map(String))].map(oid).filter(Boolean);
    if (!wanted.length) return {};
    const rows = await findTasks(companyId, scope, { _id: { $in: wanted } }, { limit: wanted.length });
    return Object.fromEntries(rows.map((t) => [String(t._id), t]));
};

const mentionsOf = (companyId, ownerId, since) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.MENTIONS,
    data: [{ mentionIds: String(ownerId), mainChat: { $ne: true }, createdAt: { $gte: since } }, {}, { sort: { createdAt: -1 }, limit: 200 }],
}, 'find').then((rows) => (rows || []).filter((m) => String(m.userId) !== String(ownerId))).catch(() => []);

const excerptOf = (mention) => String(mention.comment_message || mention.comment_reply_message || mention.comment_mediaName || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, EXCERPT);

const mentionItems = async (companyId, scope, mentions) => {
    const tasks = await visibleByIds(companyId, scope, mentions.map((m) => m.taskId).filter(Boolean));
    const names = await projectNames(companyId, Object.values(tasks));
    return mentions.filter((m) => tasks[String(m.taskId)]).map((m) => itemOf(tasks[String(m.taskId)], names, {
        at: m.createdAt || null, authorId: String(m.userId || ''), excerpt: excerptOf(m), commentId: String(m.comment_id || ''),
    }));
};

const assignedNotices = (companyId, ownerId, since) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.NOTIFICATIONS,
    data: [{ receiverID: String(ownerId), key: Notification_key.TASK_ASSIGNEE, createdAt: { $gte: since } }, { taskId: 1 }, { limit: 200 }],
}, 'find').then((rows) => new Set((rows || []).map((r) => String(r.taskId || '')).filter(Boolean))).catch(() => new Set());

const dailyBriefing = async ({ companyId, ownerId, scope, now, tzOffset }) => {
    const window = standupWindow({ now: now.getTime(), tzOffset });
    const start = window.todayStart.getTime();
    const end = window.todayEnd.getTime();
    const [open, notified, mentions] = await Promise.all([
        findTasks(companyId, scope, { AssigneeUserId: String(ownerId), statusType: { $nin: CLOSED_STATUS_TYPES } }),
        assignedNotices(companyId, ownerId, window.yesterdayStart),
        mentionsOf(companyId, ownerId, window.yesterdayStart),
    ]);
    const names = await projectNames(companyId, open);
    const since = window.yesterdayStart.getTime();
    const dueToday = open.filter((t) => timeOf(t.DueDate) >= start && timeOf(t.DueDate) < end);
    const overdue = open.filter((t) => timeOf(t.DueDate) < start)
        .map((t) => itemOf(t, names, { daysLate: Math.ceil((start - timeOf(t.DueDate)) / DAY_MS) }))
        .sort((a, b) => b.daysLate - a.daysLate);
    const fresh = open.filter((t) => notified.has(String(t._id)) || timeOf(t.createdAt) >= since);
    const mentioned = await mentionItems(companyId, scope, mentions);
    return [
        section('due_today', dueToday.map((t) => itemOf(t, names))),
        section('overdue', overdue),
        section('new_assignments', fresh.map((t) => itemOf(t, names))),
        section('mentions', mentioned),
    ];
};

const deadlineWatch = async ({ companyId, scope, now, tzOffset, options }) => {
    const days = daysOf(options);
    const window = riskWindow({ now: now.getTime(), tzOffset });
    const start = window.todayStart.getTime();
    const horizon = new Date(start + (days + 1) * DAY_MS);
    const soonEnd = new Date(Math.max(window.soonEnd.getTime(), horizon.getTime()));
    const rows = await findTasks(companyId, scope, { statusType: { $nin: CLOSED_STATUS_TYPES }, $or: [{ DueDate: { $lt: soonEnd } }, ...blockedClauses()] });
    const names = await projectNames(companyId, rows);
    const dueSoon = rows.filter((t) => timeOf(t.DueDate) >= start && timeOf(t.DueDate) < horizon.getTime());
    const atRisk = rows.map((t) => ({ task: t, ...riskReasons(t, window) })).filter((r) => r.reasons.length)
        .sort((a, b) => b.daysLate - a.daysLate)
        .map(({ task, reasons, daysLate }) => itemOf(task, names, { reasons, daysLate }));
    return [section('due_soon', dueSoon.map((t) => itemOf(t, names)), { days }), section('at_risk', atRisk)];
};

const mentionsDigest = async ({ companyId, ownerId, scope, now }) => {
    const since = new Date(now.getTime() - WEEK_MS);
    const mentions = await mentionsOf(companyId, ownerId, since);
    const replies = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS, data: [{ userId: String(ownerId), isDeleted: { $ne: true }, createdAt: { $gte: since } }, { taskId: 1, createdAt: 1 }, { limit: 1000 }],
    }, 'find').catch(() => []);
    const lastReply = {};
    (replies || []).forEach((c) => {
        const key = String(c.taskId || '');
        lastReply[key] = Math.max(lastReply[key] || 0, timeOf(c.createdAt) || 0);
    });
    const waiting = mentions.filter((m) => !(lastReply[String(m.taskId)] >= timeOf(m.createdAt)));
    return [section('unanswered', await mentionItems(companyId, scope, waiting))];
};

const weeklyStatus = async ({ companyId, scope, now, tzOffset }) => {
    const since = new Date(now.getTime() - WEEK_MS);
    const todayStart = riskWindow({ now: now.getTime(), tzOffset }).todayStart.getTime();
    const rows = await findTasks(companyId, scope, { $or: [{ statusType: { $nin: CLOSED_STATUS_TYPES } }, { updatedAt: { $gte: since } }] }, { sort: { updatedAt: -1 }, limit: 1000 });
    const names = await projectNames(companyId, rows);
    const byProject = new Map();
    rows.forEach((t) => {
        const id = String(t.ProjectID || '');
        if (!byProject.has(id)) byProject.set(id, { done: [], in_progress: [], blocked: [], slipped: [] });
        const bucket = byProject.get(id);
        if (isClosedTask(t)) { if (timeOf(t.updatedAt) >= since.getTime()) bucket.done.push(t); return; }
        if (isBlockedTask(t)) bucket.blocked.push(t);
        if (timeOf(t.DueDate) < todayStart) bucket.slipped.push(t);
        else if (String(t.statusType || '') !== 'default_active') bucket.in_progress.push(t);
    });
    return [...byProject.entries()]
        .map(([projectId, b]) => ({ projectId, b, activity: b.done.length + b.in_progress.length + b.blocked.length + b.slipped.length }))
        .filter((p) => p.activity > 0)
        .sort((x, y) => y.activity - x.activity)
        .slice(0, PROJECTS_LISTED)
        .map(({ projectId, b }) => ({
            key: 'project', projectId, label: names[projectId] || SECTION_LABELS.project,
            counts: { done: b.done.length, in_progress: b.in_progress.length, blocked: b.blocked.length, slipped: b.slipped.length },
            total: b.blocked.length + b.slipped.length,
            items: [...b.blocked, ...b.slipped.filter((t) => !b.blocked.includes(t))].slice(0, 5).map((t) => itemOf(t, names, { reasons: [isBlockedTask(t) ? 'blocked' : 'slipped'] })),
        }));
};

const GATHER = Object.freeze({ daily_briefing: dailyBriefing, deadline_watch: deadlineWatch, mentions_digest: mentionsDigest, weekly_status: weeklyStatus });

const countsOf = (sections) => Object.fromEntries(sections.filter((s) => s.key !== 'project').map((s) => [s.key, s.total]));

/* ctx: { companyId, ownerId, scope (the owner's task filter), now, tzOffset, options } */
const gather = async (key, ctx) => {
    const fn = GATHER[key];
    if (!fn) throw Object.assign(new Error(`unknown report "${key}"`), { deterministic: true });
    const sections = await fn(ctx);
    return { key, title: TITLES[key], sections, counts: countsOf(sections) };
};

const lineOf = (item) => {
    const bits = [[item.taskKey, item.taskName].filter(Boolean).join(' '), item.projectName ? `(${item.projectName})` : ''];
    if (item.daysLate) bits.push(`- ${item.daysLate}d late`);
    if (item.excerpt) bits.push(`- "${item.excerpt}"`);
    return `  - ${bits.filter(Boolean).join(' ')}`;
};

/* The plain-text body for email, a comment or a page. */
const textOf = (report, { agentName, summary } = {}) => {
    const lines = [`${report.title}${agentName ? ` from ${agentName}` : ''}`];
    if (summary) lines.push('', summary);
    report.sections.forEach((s) => {
        lines.push('');
        if (s.key === 'project') {
            const c = s.counts;
            lines.push(`${s.label}: ${c.done} done, ${c.in_progress} in progress, ${c.blocked} blocked, ${c.slipped} slipped`);
        } else {
            lines.push(`${s.label} (${s.total})`);
        }
        if (s.key !== 'project' && !s.items.length) lines.push('  - none');
        s.items.forEach((item) => lines.push(lineOf(item)));
        if (s.total > s.items.length && s.key !== 'project') lines.push(`  - and ${s.total - s.items.length} more`);
    });
    return lines.join('\n');
};

/* What the model sees: the facts only, no ids. */
const promptOf = (report) => JSON.stringify({
    report: report.title,
    sections: report.sections.map((s) => ({
        section: s.label, total: s.total, ...(s.counts ? { counts: s.counts } : {}),
        items: s.items.map((i) => ({ task: [i.taskKey, i.taskName].filter(Boolean).join(' '), project: i.projectName, due: i.dueDate, ...(i.reasons ? { reasons: i.reasons } : {}), ...(i.excerpt ? { said: i.excerpt } : {}) })),
    })),
});

module.exports = { REPORT_KEYS, TITLES, DEFAULT_DAYS, MAX_DAYS, gather, textOf, promptOf, daysOf };
