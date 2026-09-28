const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const { escapeRegex } = require('../../utils/escapeRegex');
const { hiddenSprintFilter, canSeeSprint, sprintIdentities, TEAM_PREFIX } = require('../Sprints/helpers/sprintVisibility');
const { deriveState } = require('../Sprints/scrumRules');
const { readIntent, dueWindow, zoneFor, localDate, mentionsSprint, DONE_TYPES } = require('./askIntent');

// The task list a structured question asks for, read from the same scope Ask's text search uses:
// the projects the asker can open (already narrowed by an API token), less the private sprints they
// are not on. Names the question may use are looked up inside that scope only, so a project, sprint
// or person the asker cannot see matches nothing and reads like a name that does not exist.

const STRUCTURED_LIMIT = 40;
const ACTIVE_SPRINT_STATES = ['active', 'overdue'];
const MAX_NAME_WORDS = 24;

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const oids = (ids) => ids.map(oid).filter(Boolean);
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const personName = (u) => clip(u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' '), 120);

const find = async (db, type, filter, fields, options) => (await MongoDbCrudOpration(db, {
    type, data: options ? [filter, fields, options] : [filter, fields],
}, 'find')) || [];

const projectContext = async (companyId, projects) => {
    const rows = await find(companyId, SCHEMA_TYPE.PROJECTS, { _id: { $in: oids(projects.map((p) => p._id)) } }, 'ProjectName ProjectCode taskStatusData AssigneeUserId');
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    return projects.map((p) => {
        const row = byId.get(String(p._id)) || {};
        return {
            id: String(p._id),
            name: p.ProjectName || row.ProjectName || '',
            code: row.ProjectCode || '',
            statuses: (Array.isArray(row.taskStatusData) ? row.taskStatusData : []).map((s) => ({ key: s.key, name: s.name, type: s.type })),
            people: (Array.isArray(row.AssigneeUserId) ? row.AssigneeUserId : []).map(String).filter((id) => !id.startsWith(TEAM_PREFIX)),
        };
    });
};

const nameWords = (question) => [...new Set((String(question || '').match(/\p{L}[\p{L}'-]+/gu) || [])
    .map((w) => w.replace(/'s$/i, '').toLowerCase()))].slice(0, MAX_NAME_WORDS);

/* A guest reads the people on the projects shared with them; everyone else, the company's members. */
const memberContext = async (companyId, uid, { question, projects, roleType }) => {
    const words = nameWords(question);
    if (!words.length) return [];
    const seats = await find(companyId, SCHEMA_TYPE.COMPANY_USERS, { ...ACTIVE_SEAT }, { userId: 1 });
    let ids = seats.map((seat) => String(seat.userId));
    if (roleType === ROLE_GUEST) {
        const shared = new Set([String(uid), ...projects.flatMap((p) => p.people)]);
        ids = ids.filter((id) => shared.has(id));
    }
    if (!ids.length) return [];
    const rx = { $regex: `^(${words.map(escapeRegex).join('|')})(\\s|$)`, $options: 'i' };
    const users = await find(dbCollections.GLOBAL, SCHEMA_TYPE.USERS,
        { _id: { $in: oids(ids) }, $or: [{ Employee_Name: rx }, { Employee_FName: rx }, { Employee_LName: rx }] },
        { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 });
    return users.map((u) => ({ id: String(u._id), name: personName(u), first: u.Employee_FName || '', last: u.Employee_LName || '' }));
};

const sprintContext = async (companyId, uid, { projects, roleType, now }) => {
    const rows = await find(companyId, SCHEMA_TYPE.SPRINTS,
        { projectId: { $in: oids(projects.map((p) => p.id)) }, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true } },
        'name projectId private AssigneeUserId isScrum state endDate');
    const identities = isPrivileged(roleType) ? null : await sprintIdentities(companyId, uid);
    return rows
        .filter((sprint) => !identities || canSeeSprint(sprint, identities))
        .map((sprint) => ({ id: String(sprint._id), name: sprint.name || '', projectId: String(sprint.projectId), active: ACTIVE_SPRINT_STATES.includes(deriveState(sprint, now)) }));
};

const askerZone = async (uid) => {
    const user = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: oid(uid) }, { Time_Zone: 1 }] }, 'findOne').catch(() => null);
    return zoneFor(user && user.Time_Zone);
};

/* Due windows other than overdue default to work that is not done, unless the question names a status;
 * overdue is never done, whatever it names. */
const taskClauses = (intent, { now = new Date(), timeZone = 'UTC' } = {}) => {
    const clauses = [];
    const notDone = { statusType: { $nin: DONE_TYPES } };
    const window = intent.due ? dueWindow(intent.due, { now, timeZone }) : null;
    const status = intent.due === 'overdue' && intent.status && intent.status.type === 'done' ? null : intent.status;
    if (status && status.keys) clauses.push({ $or: status.keys.map((k) => ({ ProjectID: k.projectId, statusKey: k.key })) });
    else if (status && status.type === 'open') clauses.push(notDone);
    else if (status && status.type === 'done') clauses.push({ statusType: { $in: DONE_TYPES } });
    else if (status && status.type === 'active') clauses.push({ statusType: 'active' });
    if (window && (intent.due === 'overdue' || !status) && !(status && status.type === 'open')) clauses.push(notDone);
    if (window && window.none) clauses.push({ DueDate: null });
    else if (window && window.from) clauses.push({ DueDate: { $gte: window.from, $lt: window.before } });
    else if (window) clauses.push({ DueDate: { $lt: window.before, $ne: null } });
    if (intent.assignee && intent.assignee.none) clauses.push({ $or: [{ AssigneeUserId: { $size: 0 } }, { AssigneeUserId: null }] });
    else if (intent.assignee && intent.assignee.id) clauses.push({ AssigneeUserId: String(intent.assignee.id) });
    if (intent.sprint) clauses.push({ sprintId: { $in: idForms(intent.sprint.ids) } });
    return clauses;
};

const peopleNames = async (companyId, tasks) => {
    const ids = [...new Set(tasks.flatMap((t) => (Array.isArray(t.AssigneeUserId) ? t.AssigneeUserId : [])).map(String).filter((id) => !id.startsWith(TEAM_PREFIX)))];
    if (!ids.length) return new Map();
    const seats = await find(companyId, SCHEMA_TYPE.COMPANY_USERS, { userId: { $in: ids }, ...ACTIVE_SEAT }, { userId: 1 });
    const members = [...new Set(seats.map((seat) => String(seat.userId)))];
    const users = members.length
        ? await find(dbCollections.GLOBAL, SCHEMA_TYPE.USERS, { _id: { $in: oids(members) } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 })
        : [];
    return new Map(users.map((u) => [String(u._id), personName(u)]));
};

const statusText = (task, project) => {
    if (task.status && typeof task.status === 'object' && task.status.text) return task.status.text;
    if (typeof task.status === 'string' && task.status) return task.status;
    const defined = (project.statuses || []).find((s) => String(s.key) === String(task.statusKey));
    return (defined && defined.name) || task.statusType || '';
};

const sourceOf = (task, { project, people, timeZone }) => {
    const id = String(task._id);
    const status = statusText(task, project);
    const assignees = (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : []).map((a) => people.get(String(a))).filter(Boolean);
    const due = localDate(task.DueDate, timeZone);
    return {
        kind: 'task',
        id,
        ref: task.TaskKey || id.slice(-6),
        title: clip(task.TaskName, 160),
        project: project.name || '',
        projectId: String(task.ProjectID || ''),
        detail: [status, assignees.length ? assignees.join(', ') : 'unassigned', due ? `due ${due}` : 'no due date', task.Task_Priority].filter(Boolean).join(' · '),
        updatedAt: task.updatedAt,
        matchedBy: 'filter',
        status,
        assignees,
        dueDate: due || null,
        permission: { visibility: 'project', via: 'project' },
    };
};

const summaryOf = (intent, extra = {}) => {
    const out = {};
    if (intent.projects.length) out.projects = intent.projects;
    if (intent.status) out.status = intent.status.name || intent.status.type;
    if (intent.assignee) out.assignee = intent.assignee;
    if (intent.due) out.due = intent.due;
    if (intent.sprint) out.sprint = intent.sprint.current ? { current: true } : { name: intent.sprint.name };
    return { ...out, ...extra };
};

const windowDates = (due, { now, timeZone }) => {
    const window = due ? dueWindow(due, { now, timeZone }) : null;
    if (!window || window.none) return {};
    const lastDay = (at) => localDate(new Date(at.getTime() - 1), timeZone);
    return window.from ? { dueFrom: localDate(window.from, timeZone), dueTo: lastDay(window.before) } : { dueBefore: localDate(window.before, timeZone) };
};

/* `projects` are the rows Ask may search, as openProjects returns them. Returns null when the question
 * names nothing; otherwise the ids of the projects it names (to narrow the text search), the intent
 * summary, and the matching tasks as sources, which is empty when the question asks for no list. */
const structuredTasks = async (companyId, uid, { question, projects, now = new Date(), limit = STRUCTURED_LIMIT }) => {
    const quick = readIntent(question, { selfId: uid, projects: projects.map((p) => ({ id: String(p._id), name: p.ProjectName || '' })) });
    if (!quick.needsContext) {
        return quick.projectIds.length ? { narrowIds: quick.projectIds, intent: summaryOf(quick), sources: [] } : null;
    }

    const roleType = await getRoleType(companyId, uid).catch(() => null);
    const scoped = await projectContext(companyId, projects);
    const [members, sprints] = await Promise.all([
        memberContext(companyId, uid, { question, projects: scoped, roleType }),
        mentionsSprint(question) ? sprintContext(companyId, uid, { projects: scoped, roleType, now }) : [],
    ]);
    const intent = readIntent(question, { selfId: uid, projects: scoped, members, sprints });
    if (!intent.filtered) {
        return intent.projectIds.length ? { narrowIds: intent.projectIds, intent: summaryOf(intent), sources: [] } : null;
    }

    const timeZone = await askerZone(uid);
    const scopeIds = intent.projectIds.length ? intent.projectIds : scoped.map((p) => p.id);
    const match = { deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true }, ProjectID: { $in: scopeIds }, ...(await hiddenSprintFilter(companyId, uid, scopeIds)) };
    const clauses = taskClauses(intent, { now, timeZone });
    if (clauses.length) match.$and = clauses;
    const sort = intent.due && intent.due !== 'none' ? { DueDate: 1, updatedAt: -1 } : { updatedAt: -1 };

    const [total, tasks] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [match] }, 'countDocuments'),
        find(companyId, SCHEMA_TYPE.TASKS, match, 'TaskName TaskKey status statusKey statusType Task_Priority ProjectID DueDate AssigneeUserId sprintId updatedAt', { sort, limit }),
    ]);
    const people = await peopleNames(companyId, tasks);
    const projectById = new Map(scoped.map((p) => [p.id, p]));
    const sources = tasks.map((task) => sourceOf(task, { project: projectById.get(String(task.ProjectID)) || {}, people, timeZone }));

    return {
        narrowIds: intent.projectIds,
        intent: summaryOf(intent, {
            ...windowDates(intent.due, { now, timeZone }),
            timeZone,
            today: localDate(now, timeZone),
            total: Number(total) || 0,
            listed: sources.length,
        }),
        sources,
    };
};

module.exports = { structuredTasks, taskClauses, STRUCTURED_LIMIT };
