const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const { memberProfiles } = require('../../utils/companyMembers');
const { hiddenSprintFilter, canSeeSprint, sprintIdentities, TEAM_PREFIX } = require('../Sprints/helpers/sprintVisibility');
const { keepTaskListProjectIds } = require('../Tasks/helpers/taskListProjects');
const { isBlockedTask, isClosedTask } = require('../Tasks/helpers/taskSignals');
const { deriveState } = require('../Sprints/scrumRules');
const { localDate } = require('./askIntent');

// A briefing is what Ask reads to say how a project, a list or a person is doing. The numbers are
// counted here from every task the asker can open, so the model quotes them instead of counting a
// sample; the tasks sent beside them are the ones worth naming.

const DAY = 24 * 60 * 60 * 1000;
const SOON_DAYS = 7;
const RECENT_DAYS = 7;
const ACTIVITY_DAYS = 14;
const MAX_READ = 600;
const MAX_TASK_SOURCES = 24;
const MAX_ACTIVITY = 25;
const MAX_ROWS = 12;
const BRIEFING_TOKENS = 1500;
const HIGH_PRIORITY = /^(urgent|high|highest|critical)$/i;
const ACTIVE_LIST_STATES = ['active', 'overdue'];

const TASK_FIELDS = 'TaskName TaskKey status statusKey statusType Task_Priority ProjectID sprintId DueDate AssigneeUserId relations updatedAt ParentTaskId';

const OVERVIEW = [
    /\bwhat(?:'s|’s| is| has been)?\s+(?:going on|happening|new|up|changed|the status|the state)\b/i,
    /\b(?:status|progress|overview|summary|summari[sz]e|recap|update|updates|health|standup|stand-up|briefing|snapshot)\b/i,
    /\bhow (?:is|are|'s)\b.*\b(?:doing|going|looking|tracking|progressing)\b/i,
    /\b(?:on track|at risk|risks?|blockers?|blocked|bottlenecks?|behind)\b/i,
    /\b(?:catch me up|where (?:are|do) we stand|who(?:'s|’s| is) (?:working|doing)|working on what|who works on)\b/i,
];

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const clip = (s, n) => String(s == null ? '' : s)
    .replace(/<\/?(?:b|i|u|em|strong|span)(?:\s[^>]*)?>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
const suffix = (id) => String(id).slice(-6);
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const find = async (companyId, type, filter, fields, options) => (await MongoDbCrudOpration(companyId, {
    type, data: options ? [filter, fields, options] : [filter, fields],
}, 'find').catch(() => [])) || [];

const isOverviewQuestion = (question) => OVERVIEW.some((rx) => rx.test(String(question || '')));

const statusOf = (task, statuses = []) => {
    if (task.status && typeof task.status === 'object' && task.status.text) return task.status.text;
    if (typeof task.status === 'string' && task.status) return task.status;
    const defined = statuses.find((s) => String(s.key) === String(task.statusKey));
    return (defined && defined.name) || task.statusType || 'No status';
};

const assigneesOf = (task) => (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : []).map(String).filter((id) => id && !id.startsWith(TEAM_PREFIX));
const dueOf = (task) => {
    const at = task.DueDate ? new Date(task.DueDate).getTime() : NaN;
    return Number.isNaN(at) ? null : at;
};
const isOverdue = (task, now) => !isClosedTask(task) && dueOf(task) !== null && dueOf(task) < now;
const isDueSoon = (task, now) => !isClosedTask(task) && dueOf(task) !== null && dueOf(task) >= now && dueOf(task) < now + SOON_DAYS * DAY;
const isRecentlyDone = (task, now) => isClosedTask(task) && task.updatedAt && new Date(task.updatedAt).getTime() >= now - RECENT_DAYS * DAY;
const isHigh = (task) => !isClosedTask(task) && HIGH_PRIORITY.test(String(task.Task_Priority || ''));
const inProgress = (task) => String(task.statusType || '').toLowerCase() === 'active';

const bump = (map, key, field) => {
    const row = map.get(key) || { open: 0, overdue: 0, active: 0, done: 0, total: 0 };
    row[field] += 1;
    map.set(key, row);
};

/* Exact counts over `tasks`. `statuses` are the project's own, in its order, so the breakdown reads
 * the way the board does. */
const summarize = (tasks, { statuses = [], now = Date.now() } = {}) => {
    const byStatus = new Map(statuses.map((s) => [s.name, 0]));
    const people = new Map();
    const lists = new Map();
    const out = { total: tasks.length, done: 0, open: 0, overdue: 0, dueSoon: 0, noDue: 0, unassigned: 0, blocked: 0, high: 0, active: 0, recentlyDone: 0 };
    tasks.forEach((task) => {
        const closed = isClosedTask(task);
        const name = statusOf(task, statuses);
        byStatus.set(name, (byStatus.get(name) || 0) + 1);
        const list = String(task.sprintId || '');
        if (list) bump(lists, list, 'total');
        if (closed) {
            out.done += 1;
            if (list) bump(lists, list, 'done');
            if (isRecentlyDone(task, now)) out.recentlyDone += 1;
            return;
        }
        out.open += 1;
        const overdue = isOverdue(task, now);
        if (list) bump(lists, list, 'open');
        if (list && overdue) bump(lists, list, 'overdue');
        if (overdue) out.overdue += 1;
        if (isDueSoon(task, now)) out.dueSoon += 1;
        if (dueOf(task) === null) out.noDue += 1;
        if (isBlockedTask(task)) out.blocked += 1;
        if (isHigh(task)) out.high += 1;
        if (inProgress(task)) out.active += 1;
        const who = assigneesOf(task);
        if (!who.length) out.unassigned += 1;
        who.forEach((id) => {
            bump(people, id, 'open');
            if (overdue) bump(people, id, 'overdue');
            if (inProgress(task)) bump(people, id, 'active');
        });
    });
    out.pctDone = pct(out.done, out.total);
    out.byStatus = [...byStatus.entries()].filter(([, n]) => n > 0).map(([name, count]) => ({ name, count }));
    out.people = people;
    out.lists = lists;
    return out;
};

const healthOf = (s) => {
    if (!s.open) return s.total ? 'everything is done' : 'no tasks yet';
    if (s.overdue && (s.overdue >= Math.max(1, Math.ceil(s.open * 0.25)) || s.blocked)) return 'off track';
    if (s.overdue || s.blocked) return 'at risk';
    return 'on track';
};

const countsLine = (s) => [
    `${plural(s.total, 'task')}: ${s.done} done, ${s.open} open (${s.pctDone}% done)`,
    `${s.active} started (in an active status, not done)`,
    `${s.overdue} overdue`,
    `${s.dueSoon} due in the next ${SOON_DAYS} days`,
    `${s.blocked} blocked`,
    `${s.high} high or urgent priority`,
    `${s.unassigned} open with nobody assigned`,
    `${s.noDue} open with no due date`,
    `${s.recentlyDone} finished in the last ${RECENT_DAYS} days`,
].join('; ');

const peopleLines = (s, names) => [...s.people.entries()]
    .sort((a, b) => b[1].open - a[1].open)
    .slice(0, MAX_ROWS)
    .map(([id, row]) => `- ${names.get(id) || 'A former member'}: ${row.open} open, ${row.active} started, ${row.overdue} overdue`);

const listLines = (s, lists, now, timeZone) => [...s.lists.entries()]
    .map(([id, row]) => ({ row, list: lists.get(id) }))
    .filter(({ list }) => list)
    .sort((a, b) => b.row.open - a.row.open)
    .slice(0, MAX_ROWS)
    .map(({ row, list }) => `- ${listWords(list, now, timeZone)}: ${row.total} tasks, ${row.done} done (${pct(row.done, row.total)}%), ${row.open} open, ${row.overdue} overdue`);

const listWords = (list, now, timeZone) => {
    const state = deriveState(list, new Date(now));
    if (state === 'none') return `"${list.name}"`;
    const dates = [list.startDate && localDate(list.startDate, timeZone), list.endDate && localDate(list.endDate, timeZone)].filter(Boolean).join(' to ');
    const words = { planned: 'planned sprint', active: 'active sprint', overdue: 'sprint past its end date', closed: 'closed sprint' };
    return `"${list.name}" (${words[state] || 'sprint'}${dates ? `, ${dates}` : ''})`;
};

/* The briefing as lines of text: the project (or list, or person) source's detail. */
const briefingText = ({ heading, summary, names = new Map(), lists = new Map(), now = Date.now(), timeZone = 'UTC', extra = [] }) => {
    const lines = [
        `${heading.replace(/[.\s]+$/, '')}. Today is ${localDate(new Date(now), timeZone)}. Overall: ${healthOf(summary)}.`,
        `Counts (exact, every task the asker can open): ${countsLine(summary)}.`,
    ];
    if (summary.byStatus.length) lines.push(`By status: ${summary.byStatus.map((s) => `${s.name} ${s.count}`).join(', ')}.`);
    const people = peopleLines(summary, names);
    if (people.length) lines.push('Open work by person:', ...people);
    const listRows = listLines(summary, lists, now, timeZone);
    if (listRows.length > 1) lines.push('By list:', ...listRows);
    lines.push(...extra);
    return lines.join('\n');
};

const REASONS = [
    ['overdue', (t, now) => isOverdue(t, now), (a, b) => dueOf(a) - dueOf(b)],
    ['blocked', (t) => !isClosedTask(t) && isBlockedTask(t), null],
    ['high priority', (t) => isHigh(t), null],
    ['due soon', (t, now) => isDueSoon(t, now), (a, b) => dueOf(a) - dueOf(b)],
    ['started', (t) => !isClosedTask(t) && inProgress(t), null],
    ['recently done', (t, now) => isRecentlyDone(t, now), null],
];

/* The tasks worth naming, most pressing first, each with every reason it was picked. */
const pickTasks = (tasks, { now = Date.now(), limit = MAX_TASK_SOURCES } = {}) => {
    const picked = new Map();
    const newest = (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    REASONS.forEach(([reason, test, order]) => {
        tasks.filter((t) => test(t, now)).sort(order || newest).forEach((task) => {
            const id = String(task._id);
            if (picked.has(id)) picked.get(id).reasons.push(reason);
            else if (picked.size < limit) picked.set(id, { task, reasons: [reason] });
        });
    });
    return [...picked.values()];
};

const taskRef = (task) => task.TaskKey || suffix(task._id);

const taskSource = ({ task, reasons }, { project, statuses, names, lists, blockers, timeZone }) => {
    const who = assigneesOf(task).map((id) => names.get(id)).filter(Boolean);
    const due = localDate(task.DueDate, timeZone);
    const list = lists.get(String(task.sprintId || ''));
    const blockedBy = (Array.isArray(task.relations) ? task.relations : [])
        .filter((r) => String((r && r.type) || '').toLowerCase() === 'blocked_by')
        .map((r) => blockers.get(String(r.taskId)))
        .filter(Boolean);
    return {
        kind: 'task',
        id: String(task._id),
        ref: taskRef(task),
        title: clip(task.TaskName, 160),
        project: project.name,
        projectId: String(task.ProjectID || ''),
        detail: [
            reasons.join(', '),
            statusOf(task, statuses),
            who.length ? who.join(', ') : 'unassigned',
            due ? `due ${due}` : 'no due date',
            task.Task_Priority ? `priority ${String(task.Task_Priority).toLowerCase()}` : '',
            list ? `list ${list.name}` : '',
            blockedBy.length ? `blocked by ${blockedBy.join(', ')}` : '',
            task.updatedAt ? `updated ${localDate(task.updatedAt, timeZone)}` : '',
        ].filter(Boolean).join(' · '),
        updatedAt: task.updatedAt,
        matchedBy: 'briefing',
        permission: { visibility: 'project', via: 'project' },
    };
};

const activityLine = (row, { keys, timeZone }) => {
    const text = clip(row.Message, 220);
    if (!text) return '';
    const key = row.TaskId ? keys.get(String(row.TaskId)) : '';
    return `- ${localDate(row.createdAt, timeZone)} · ${text}${key ? ` [${key}]` : ''}`;
};

const namesOf = async (companyId, ids) => {
    const wanted = [...new Set(ids.map(String))].filter((id) => /^[a-f0-9]{24}$/i.test(id));
    if (!wanted.length) return new Map();
    const users = await memberProfiles(companyId, wanted, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 }).catch(() => []);
    return new Map(users.map((u) => [String(u._id), clip(u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' '), 80)]));
};

const visibleLists = async (companyId, uid, projectIds, now) => {
    const rows = await find(companyId, SCHEMA_TYPE.SPRINTS,
        { projectId: { $in: idForms(projectIds) }, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true } },
        'name projectId private AssigneeUserId isScrum state startDate endDate');
    const privileged = isPrivileged(await getRoleType(companyId, uid).catch(() => null));
    const identities = privileged ? null : await sprintIdentities(companyId, uid);
    return new Map(rows.filter((s) => !identities || canSeeSprint(s, identities)).map((s) => [String(s._id), {
        _id: s._id, name: s.name || '', projectId: s.projectId, isScrum: s.isScrum, state: s.state, startDate: s.startDate, endDate: s.endDate,
        active: ACTIVE_LIST_STATES.includes(deriveState(s, new Date(now))),
    }]));
};

/* The keys of the tasks a blocked task waits on, read inside the projects the asker can open. */
const blockerKeys = async (companyId, uid, tasks, openIds) => {
    const keys = new Map(tasks.map((t) => [String(t._id), taskRef(t)]));
    const missing = [...new Set(tasks.flatMap((t) => (Array.isArray(t.relations) ? t.relations : [])
        .filter((r) => String((r && r.type) || '').toLowerCase() === 'blocked_by')
        .map((r) => String(r.taskId))))].filter((id) => !keys.has(id) && /^[a-f0-9]{24}$/i.test(id));
    if (missing.length && openIds.length) {
        const rows = await find(companyId, SCHEMA_TYPE.TASKS, {
            _id: { $in: missing.map(oid) }, ProjectID: { $in: openIds }, deletedStatusKey: { $ne: 1 },
            ...(await hiddenSprintFilter(companyId, uid, openIds)),
        }, 'TaskKey TaskName');
        rows.forEach((t) => keys.set(String(t._id), taskRef(t)));
    }
    return keys;
};

/* Null when the asker may not list tasks in any of the projects. */
const readTasks = async (companyId, uid, projectIds, extra = {}) => {
    const listed = await keepTaskListProjectIds(companyId, uid, projectIds);
    if (!listed.length) return null;
    return find(companyId, SCHEMA_TYPE.TASKS, {
        ProjectID: { $in: listed }, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true },
        ...(await hiddenSprintFilter(companyId, uid, listed)), ...extra,
    }, TASK_FIELDS, { sort: { updatedAt: -1 }, limit: MAX_READ });
};

const statusesOf = async (companyId, projectIds) => {
    const rows = await find(companyId, SCHEMA_TYPE.PROJECTS, { _id: { $in: projectIds.map(oid).filter(Boolean) } }, 'ProjectName taskStatusData description');
    return new Map(rows.map((p) => [String(p._id), {
        name: p.ProjectName || '',
        description: clip(p.description, 500),
        statuses: (Array.isArray(p.taskStatusData) ? p.taskStatusData : []).map((s) => ({ key: s.key, name: s.name, type: s.type })),
    }]));
};

const activityOf = async (companyId, { projectId, tasks, timeZone, now }) => {
    const keys = new Map(tasks.map((t) => [String(t._id), taskRef(t)]));
    const rows = await find(companyId, SCHEMA_TYPE.HISTORY,
        { ProjectId: { $in: idForms(projectId) }, createdAt: { $gte: new Date(now - ACTIVITY_DAYS * DAY) } },
        'Message TaskId createdAt', { sort: { createdAt: -1 }, limit: MAX_ACTIVITY * 3 });
    // A row about a task the asker cannot open (a private list they are not on) stays out. A change is often
    // written twice, once for the project and once for its task: the task's line is kept.
    const visible = rows.filter((row) => !row.TaskId || keys.has(String(row.TaskId)));
    const texts = new Set(visible.filter((row) => row.TaskId).map((row) => `${localDate(row.createdAt, timeZone)}|${clip(row.Message, 220)}`));
    const seen = new Set();
    return visible
        .filter((row) => row.TaskId || !texts.has(`${localDate(row.createdAt, timeZone)}|${clip(row.Message, 220)}`))
        .map((row) => activityLine(row, { keys, timeZone }))
        .filter((line) => line && !seen.has(line) && seen.add(line))
        .slice(0, MAX_ACTIVITY);
};

const activitySource = (lines, { id, name, projectId }) => (lines.length ? {
    kind: 'activity',
    id: `activity:${id}`,
    ref: `activity:${suffix(id)}`,
    title: `Recent activity in ${name}`,
    project: name,
    projectId,
    detail: `Newest first, last ${ACTIVITY_DAYS} days:\n${lines.join('\n')}`,
    matchedBy: 'briefing',
    permission: { visibility: 'project', via: 'project' },
} : null);

/* `project` is a row openProjects returned for this asker. */
const projectBriefing = async (companyId, uid, { project, openIds = [], now = Date.now(), timeZone = 'UTC' }) => {
    const projectId = String(project._id);
    const [meta, tasks, lists] = await Promise.all([
        statusesOf(companyId, [projectId]),
        readTasks(companyId, uid, [projectId]),
        visibleLists(companyId, uid, [projectId], now),
    ]);
    if (!tasks) return null;
    const info = meta.get(projectId) || { name: project.ProjectName || '', statuses: [], description: '' };
    const summary = summarize(tasks, { statuses: info.statuses, now });
    const picks = pickTasks(tasks, { now });
    const [names, blockers, activity] = await Promise.all([
        namesOf(companyId, [...summary.people.keys(), ...picks.flatMap((p) => assigneesOf(p.task))]),
        blockerKeys(companyId, uid, tasks, openIds.length ? openIds : [projectId]),
        activityOf(companyId, { projectId, tasks, timeZone, now }),
    ]);
    const ctx = { project: info, statuses: info.statuses, names, lists, blockers, timeZone };
    const overview = {
        kind: 'project',
        id: projectId,
        ref: `project:${suffix(projectId)}`,
        title: clip(info.name, 160),
        project: clip(info.name, 160),
        projectId,
        detail: briefingText({
            heading: `Briefing for project "${info.name}"${info.description ? ` — ${info.description}` : ''}`,
            summary, names, lists, now, timeZone,
        }),
        matchedBy: 'briefing',
        permission: { visibility: 'project', via: 'project' },
    };
    return [overview, activitySource(activity, { id: projectId, name: info.name, projectId }), ...picks.map((p) => taskSource(p, ctx))].filter(Boolean);
};

/* A list (sprint) the asker can see, inside a project they can open. Null when either is not so. */
const listBriefing = async (companyId, uid, { listId, projects, now = Date.now(), timeZone = 'UTC' }) => {
    const openIds = projects.map((p) => String(p._id));
    const row = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: oid(listId), deletedStatusKey: { $ne: 1 } }, 'projectId'] }, 'findOne').catch(() => null);
    const projectId = row ? String(row.projectId) : '';
    if (!projectId || !openIds.includes(projectId)) return null;
    const lists = await visibleLists(companyId, uid, [projectId], now);
    const list = lists.get(String(listId));
    if (!list) return null;
    const [meta, tasks] = await Promise.all([statusesOf(companyId, [projectId]), readTasks(companyId, uid, [projectId], { sprintId: { $in: idForms(listId) } })]);
    if (!tasks) return null;
    const info = meta.get(projectId) || { name: '', statuses: [] };
    const summary = summarize(tasks, { statuses: info.statuses, now });
    const picks = pickTasks(tasks, { now, limit: Math.max(MAX_TASK_SOURCES, 30) });
    const [names, blockers] = await Promise.all([
        namesOf(companyId, [...summary.people.keys(), ...picks.flatMap((p) => assigneesOf(p.task))]),
        blockerKeys(companyId, uid, tasks, openIds),
    ]);
    const overview = {
        kind: 'list',
        id: String(listId),
        ref: `list:${suffix(listId)}`,
        title: clip(list.name, 160),
        project: info.name,
        projectId,
        detail: briefingText({ heading: `Briefing for list ${listWords(list, now, timeZone)} in project "${info.name}"`, summary, names, lists: new Map(), now, timeZone, extra: [] }),
        matchedBy: 'briefing',
        permission: { visibility: 'project', via: 'project' },
    };
    return [overview, ...picks.map((p) => taskSource(p, { project: info, statuses: info.statuses, names, lists, blockers, timeZone }))];
};

/* One person's open work across the projects the asker can open. Null when the person holds no seat here. */
const personBriefing = async (companyId, uid, { personId, projects, now = Date.now(), timeZone = 'UTC' }) => {
    const names = await namesOf(companyId, [personId]);
    const name = names.get(String(personId));
    if (!name) return null;
    const openIds = projects.map((p) => String(p._id));
    const tasks = (await readTasks(companyId, uid, openIds, { AssigneeUserId: String(personId) })) || [];
    const meta = await statusesOf(companyId, [...new Set(tasks.map((t) => String(t.ProjectID)))]);
    const open = tasks.filter((t) => !isClosedTask(t));
    const summary = summarize(tasks, { now });
    const byProject = new Map();
    open.forEach((t) => byProject.set(String(t.ProjectID), (byProject.get(String(t.ProjectID)) || 0) + 1));
    const extra = byProject.size ? ['Open work by project:', ...[...byProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ROWS)
        .map(([id, n]) => `- ${(meta.get(id) || {}).name || 'A project'}: ${n} open`)] : [];
    const personSummary = { ...summary, people: new Map(), lists: new Map() };
    const picks = pickTasks(tasks, { now });
    const allNames = await namesOf(companyId, picks.flatMap((p) => assigneesOf(p.task)));
    const blockers = await blockerKeys(companyId, uid, tasks, openIds);
    const overview = {
        kind: 'person',
        id: String(personId),
        ref: `person:${suffix(personId)}`,
        title: name,
        project: '',
        projectId: '',
        detail: briefingText({ heading: `Briefing for ${name}'s assigned work`, summary: personSummary, now, timeZone, extra }),
        matchedBy: 'briefing',
        permission: { visibility: 'project', via: 'project' },
    };
    return [overview, ...picks.map((p) => {
        const info = meta.get(String(p.task.ProjectID)) || { name: '', statuses: [] };
        return taskSource(p, { project: info, statuses: info.statuses, names: allNames, lists: new Map(), blockers, timeZone });
    })];
};

const BRIEFING_SYSTEM = `
- A source of kind project, list or person is a BRIEFING counted from every task in it the asker can
  open. Its numbers are exact: take every count and percentage from it, never from counting the task
  sources, which are only the ones worth naming. An activity source lists the latest changes, newest first.
- For a question about how a project, list or person is doing, open with one sentence on the overall
  state (done %, open, overdue, blocked) and cite the briefing. Then short sections, only where there
  is something to say: Progress (by status, by list), At risk (overdue, blocked and what blocks them,
  due soon; name each task with its ref), Who is working on what, Recent activity. Use the names the
  sources use. Never invent a person, date or task.`;

module.exports = {
    isOverviewQuestion, summarize, pickTasks, briefingText, activityLine, healthOf,
    projectBriefing, listBriefing, personBriefing, BRIEFING_SYSTEM, BRIEFING_TOKENS, MAX_TASK_SOURCES,
};
