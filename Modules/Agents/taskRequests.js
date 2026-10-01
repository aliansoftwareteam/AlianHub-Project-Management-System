const mongoose = require('mongoose');
const { DateTime, IANAZone } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { nonMembersOf, NOT_A_MEMBER } = require('../../Config/companyMembers');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const socketEmitter = require('../../event/socketEventEmitter');
const tools = require('../Automations/engine/tools');
const permissions = require('./permissions');
const { runAs, byline, toolNameOf } = require('./actingAgent');
const { descriptionBlockFrom } = require('../Tasks/helpers/descriptionBlock');

// Task changes an agent makes the way a person makes them: each goes through the task routes' own
// preparation (Modules/Tasks/helpers/taskWriteFields) and handler (taskMongo), as the person behind
// the agent, so the write guard, the history, the notifications and the counters are the web app's.
// The handlers pull in most of the task domain, so they are loaded on first use.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = Object.freeze(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
const PRIORITY_NAMES = Object.freeze({ URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' });
const TITLE_MAX = 250;
const DESCRIPTION_MAX = 20000;
const ESTIMATE_MAX_MINUTES = 100000;
const ASSIGNEES_MAX = 20;
const LIVE = 0;
const TRASHED = 1;
const ARCHIVED = 2;
const ARCHIVED_WITH_PARENT = 3;
const ASSIGN_MODES = Object.freeze(['set', 'add', 'remove']);
const LINK_KINDS = Object.freeze(['pr', 'branch', 'doc', 'url']);
const LINKS_MAX = 10;
const AGENT_NAME_MAX = 60;
const NO_KEY = '--';
const KEY_READS = 10;
const KEY_WAIT_MS = 30;
const CANNOT_OPEN_PROJECT = 'A person named here cannot open this project.';
const SUBTASK_MOVES_WITH_PARENT = 'A subtask moves with its parent: move the top-level task instead.';

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const oid = (value) => new mongoose.Types.ObjectId(String(value));

const personOf = (actor) => {
    const uid = idOf(actor && actor.userId);
    if (!OBJECT_ID.test(uid)) throw refuse('a task change needs a person to make it as');
    return uid;
};

/* Who a change is made as, and the agent it was made through: the activity log names both. `mark` is what the
 * history rows and the events of that change carry; `depth` is the depth of the event the agent answered. */
const whoOf = (actor, depth = 0) => {
    const uid = personOf(actor);
    if (!actor || actor.kind !== 'agent') return { uid, via: '', mark: null };
    const via = String(toolNameOf(actor)).slice(0, AGENT_NAME_MAX);
    return { uid, via, mark: { userId: uid, agentId: idOf(actor.agentId || actor.clientId) || null, agentName: via, depth: Math.max(0, Number(depth) || 0) } };
};

/* The person's name arrives escaped from the route's own preparation; the agent's is escaped here. */
const namedWith = (who, person, escapeText) => ({ ...person, Employee_Name: byline(escapeText(who.via), person.Employee_Name) });

const liveTask = async (companyId, taskId) => {
    const task = await tools.getTask(companyId, taskId);
    if (Number(task.deletedStatusKey) === TRASHED) throw refuse(`task ${taskId} not found`);
    return task;
};

const storedProject = async (companyId, projectId) => {
    const project = OBJECT_ID.test(idOf(projectId))
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId), deletedStatusKey: { $nin: [1] } }] }, 'findOne')
        : null;
    if (!project) throw refuse('project not found');
    return project;
};

const zoneOf = async (uid) => {
    const user = await Promise.resolve(MongoDbCrudOpration(dbCollections.GLOBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: oid(uid) }, { Time_Zone: 1 }] }, 'findOne')).catch(() => null);
    return user && user.Time_Zone && IANAZone.isValidZone(user.Time_Zone) ? user.Time_Zone : 'UTC';
};

/* A day is its start in the zone of the person the change is made as, as the date picker stores a picked day. */
const instantOf = (value, zone) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return null;
    const at = ISO_DAY.test(text) ? DateTime.fromISO(text, { zone }).startOf('day') : DateTime.fromISO(text, { setZone: true });
    return at.isValid ? at.toUTC().toISO() : null;
};

const sameInstant = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/* One task action as `who.uid`: the body the web app sends, the route's preparation, then its handler.
 * `beside` is what the handler takes from the server alone, never from a body. */
const asRoute = async (companyId, who, action, body, beside = {}) => {
    const { prepareTaskRequest, TASK_ACTION_FIELDS, TaskWriteRefusal, escapeText } = require('../Tasks/helpers/taskWriteFields');
    const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
    const request = { uid: who.uid, aud: String(companyId), headers: { companyid: String(companyId) }, body: { action, ...body } };
    try {
        const { payload } = await prepareTaskRequest(request, TASK_ACTION_FIELDS[action], action);
        if (who.via) {
            ['userData', 'user'].filter((key) => payload[key]).forEach((key) => { payload[key] = namedWith(who, payload[key], escapeText); });
        }
        const out = await runAs(who.mark, () => taskMongo[action]({ ...payload, ...beside }));
        if (out && out.status === false) throw refuse(out.statusText || out.message || `${action} changed nothing`);
        return out;
    } catch (error) {
        if (error instanceof TaskWriteRefusal) throw refuse(error.message);
        throw error;
    }
};

const taskRef = (task) => ({ _id: idOf(task._id), TaskName: task.TaskName || '', sprintId: idOf(task.sprintId), folderObjId: idOf(task.folderObjId) });

const EDITS = Object.freeze({
    TaskName: {
        clean: (value) => {
            const title = typeof value === 'string' ? value.trim() : '';
            if (!title || title.length > TITLE_MAX) throw refuse(`title needs 1 to ${TITLE_MAX} characters`);
            return title;
        },
        same: (task, value) => task.TaskName === value,
        previous: (task) => ({ TaskName: task.TaskName }),
        write: ({ companyId, who, task, value }) => asRoute(companyId, who, 'updateTaskName', { firebaseObj: { TaskName: value }, projectData: {}, taskData: taskRef(task), obj: {} }),
    },
    rawDescription: {
        clean: (value) => {
            if (typeof value !== 'string' || value.length > DESCRIPTION_MAX) throw refuse(`description needs text of at most ${DESCRIPTION_MAX} characters`);
            return value;
        },
        same: (task, value) => (task.rawDescription || '') === value,
        previous: (task) => ({ rawDescription: task.rawDescription === undefined ? null : task.rawDescription, descriptionBlock: task.descriptionBlock === undefined ? null : task.descriptionBlock }),
        write: ({ companyId, who, task, value }) => {
            return asRoute(companyId, who, 'updateDescription', { companyId, task: { _id: idOf(task._id) }, text: { blocks: descriptionBlockFrom(value), text: value } });
        },
    },
    Task_Priority: {
        clean: (value) => {
            const priority = String(value || '').toUpperCase();
            if (!PRIORITIES.includes(priority)) throw refuse(`priority needs one of ${PRIORITIES.join(', ')}`);
            return priority;
        },
        same: (task, value) => task.Task_Priority === value,
        previous: (task) => ({ Task_Priority: task.Task_Priority === undefined ? null : task.Task_Priority }),
        write: ({ companyId, who, task, value }) => asRoute(companyId, who, 'updatePriority', {
            firebaseObj: { Task_Priority: value }, projectData: {}, taskData: taskRef(task), isUpdateTask: true,
            priorityObj: { priorityName: PRIORITY_NAMES[task.Task_Priority] || '', newPriorityName: PRIORITY_NAMES[value] },
        }),
    },
    DueDate: {
        clean: (value, zone) => {
            if (value === null) return null;
            const due = instantOf(value, zone);
            if (!due) throw refuse('dueDate needs a date as YYYY-MM-DD or an ISO date and time, or null to clear it');
            return due;
        },
        same: (task, value) => sameInstant(task.DueDate, value),
        previous: (task) => ({ DueDate: task.DueDate || null, dueDateDeadLine: task.dueDateDeadLine || null }),
        write: ({ companyId, who, task, value, zone }) => {
            const earlier = (Array.isArray(task.dueDateDeadLine) ? task.dueDateDeadLine : []).filter((row) => row && row.date).map((row) => ({ date: new Date(row.date).toISOString() }));
            return asRoute(companyId, who, 'updateDueDate', {
                firebaseObj: { DueDate: value, dueDateDeadLine: value ? [...earlier, { date: value }] : earlier },
                project: {}, task: taskRef(task), obj: { notify: true }, timeZone: zone, isUpdateTask: true,
            });
        },
    },
    startDate: {
        clean: (value, zone) => {
            const start = instantOf(value, zone);
            if (!start) throw refuse('startDate needs a date as YYYY-MM-DD or an ISO date and time');
            return start;
        },
        same: (task, value) => sameInstant(task.startDate, value),
        previous: (task) => ({ startDate: task.startDate || null }),
        write: ({ companyId, who, task, value, zone }) => asRoute(companyId, who, 'updateStartDate', {
            firebaseObj: { startDate: value }, project: {}, task: taskRef(task), obj: { notify: true }, timeZone: zone, isUpdateTask: true,
        }),
    },
    totalEstimatedTime: {
        clean: (value) => {
            if (!Number.isInteger(value) || value < 0 || value > ESTIMATE_MAX_MINUTES) throw refuse(`estimateMinutes needs a whole number from 0 to ${ESTIMATE_MAX_MINUTES}`);
            return value;
        },
        same: (task, value) => (Number(task.totalEstimatedTime) || 0) === value,
        previous: (task) => ({ totalEstimatedTime: task.totalEstimatedTime === undefined ? null : task.totalEstimatedTime }),
        write: ({ companyId, who, task, value, note }) => asRoute(companyId, who, 'updateTaskTotalEstimate', {
            firebaseObj: { totalEstimatedTime: value }, projectData: {}, taskData: taskRef(task), obj: note ? { reason: note } : {},
        }),
    },
});

const cannotOpen = async (companyId, projectId, userIds) => {
    const { canReadProject } = require('../../Config/projectAccess');
    for (const id of userIds) {
        if (!(await canReadProject(companyId, id, projectId)).allowed) return true;
    }
    return false;
};

/* The ids a write names as assignees, once each is an active member who can open the project. `held` stay nameable. */
const assignable = async (companyId, projectId, userIds, held = []) => {
    const named = Array.isArray(userIds) ? [...new Set(userIds.map(idOf))] : null;
    if (!named || named.length > ASSIGNEES_MAX || named.some((id) => !OBJECT_ID.test(id))) throw refuse(`assignees need a list of at most ${ASSIGNEES_MAX} member ids`);
    const added = named.filter((id) => !held.includes(id));
    if ((await nonMembersOf(companyId, added)).length) throw refuse(NOT_A_MEMBER);
    if (await cannotOpen(companyId, projectId, added)) throw refuse(CANNOT_OPEN_PROJECT);
    return named;
};

const peopleWhoOpen = async (companyId, projectId, userIds) => {
    const { canReadProject } = require('../../Config/projectAccess');
    const kept = [];
    for (const id of userIds) {
        if ((await canReadProject(companyId, id, projectId)).allowed) kept.push(id);
    }
    return kept;
};

const flatStatus = (row) => (row && row.convertStatus ? row.convertStatus : row);

/* The source project's statuses and task types, each with the destination's it becomes: the mapping a
 * person picks in the move dialog, chosen here by name, then by kind, then the destination's first. */
const mappedForMove = (source, destination) => {
    const statuses = (Array.isArray(destination.taskStatusData) ? destination.taskStatusData : []).map(flatStatus).filter(Boolean);
    const types = (Array.isArray(destination.taskTypeCounts) ? destination.taskTypeCounts : []).filter(Boolean);
    const named = (list, name, field) => list.find((row) => String(row[field] || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());
    const statusFor = (from) => named(statuses, from.name, 'name') || statuses.find((row) => row.type === from.type) || statuses.find((row) => row.type === 'default_active') || statuses[0];
    const typeFor = (from) => named(types, from.value, 'value') || named(types, from.name, 'name') || types[0];
    return {
        taskStatusData: (Array.isArray(source.taskStatusData) ? source.taskStatusData : []).map(flatStatus).filter(Boolean).map((from) => {
            const to = statusFor(from);
            return { key: from.key, name: from.name, type: from.type, convertStatus: to ? { key: to.key, name: to.name, type: to.type } : undefined };
        }),
        taskTypeCounts: (Array.isArray(source.taskTypeCounts) ? source.taskTypeCounts : []).filter(Boolean).map((from) => {
            const to = typeFor(from);
            return { key: from.key, name: from.name, value: from.value, convertType: to ? { key: to.key, value: to.value } : undefined };
        }),
    };
};

/* The move handler reads each row's status and type out of this mapping after it has taken the row off
 * its list, so a row the mapping does not cover is refused before anything is written. */
const coveredByMapping = (rows, mapping) => rows.every((row) => {
    const status = mapping.taskStatusData.find((entry) => entry.key === row.statusKey);
    const type = mapping.taskTypeCounts.find((entry) => entry.value === row.TaskType);
    return Boolean(status && status.convertStatus && type && type.convertType);
});

const sprintRef = async (companyId, sprint) => {
    const { sprintPlacementOf } = require('../Tasks/helpers/sprintPlacement');
    const { sprintArray } = (await sprintPlacementOf(companyId, sprint)).set;
    return {
        id: idOf(sprintArray.id), name: sprintArray.name,
        ...(sprintArray.folderId ? { folderId: idOf(sprintArray.folderId), folderName: sprintArray.folderName || '' } : {}),
    };
};

const destinationOf = async ({ companyId, actor, uid, params }) => {
    const { canReadProject } = require('../../Config/projectAccess');
    const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
    const { canSeeSprintById } = require('../Sprints/helpers/sprintVisibility');
    const projectId = idOf(params.projectId);
    const sprintId = idOf(params.sprintId);
    const sprint = OBJECT_ID.test(sprintId) && OBJECT_ID.test(projectId)
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: oid(sprintId), deletedStatusKey: { $nin: [1] } }] }, 'findOne')
        : null;
    if (!sprint || idOf(sprint.projectId) !== projectId) throw refuse('that list was not found in that project');
    if (!(await canReadProject(companyId, uid, projectId)).allowed) throw refuse('project not found');
    if (!isPrivileged(await getRoleType(companyId, uid)) && !(await canSeeSprintById(companyId, uid, sprintId))) throw refuse('that list was not found in that project');
    // A move is held to the key in the project it leaves and in the one it enters, as the task route holds it.
    for (const where of [{ taskId: idOf(params.taskId) }, { projectId }]) {
        const may = await permissions.holderMay(companyId, actor, 'task.move', where);
        if (!may.allowed) throw refuse(may.reason);
    }
    return { project: await storedProject(companyId, projectId), sprint };
};

const setArchived = async ({ companyId, who, taskId, to }) => {
    const task = await liveTask(companyId, taskId);
    const from = Number(task.deletedStatusKey) || LIVE;
    if (to === ARCHIVED && from !== LIVE) throw refuse('the task is already archived');
    if (to === LIVE && from === ARCHIVED_WITH_PARENT) throw refuse('this subtask was archived with its parent: restore the parent');
    if (to === LIVE && from !== ARCHIVED) throw refuse('the task is not archived');
    const project = await storedProject(companyId, task.ProjectID);
    await asRoute(companyId, who, 'updateArchiveDelete', {
        companyId, projectData: { ProjectName: project.ProjectName || '' }, sprintId: idOf(task.sprintId), task: { _id: idOf(task._id) }, deletedStatusKey: to,
    });
    return { task, from };
};

const flatStatuses = (project) => (Array.isArray(project.taskStatusData) ? project.taskStatusData : []).map(flatStatus).filter(Boolean);

/* An agent's status change writes the Done record itself: the work is its own, the close its person's, and nobody has checked it. */
const recordAgentStatus = async (companyId, task, from, patch, agent) => {
    const completionStore = require('../Tasks/helpers/completionStore');
    const { addWork } = require('../Tasks/helpers/completion');
    const outcome = await completionStore.forStatusChange(companyId, task._id, { toStatus: { statusType: patch.statusType, name: patch.status.text }, fromStatus: from, actor: agent });
    if (!outcome || outcome.error || !outcome.completion) return;
    const saved = await completionStore.save(companyId, task._id, addWork(outcome.completion, agent));
    if (saved) socketEmitter.emit('update', { type: 'update', data: saved, updatedFields: { completion: saved.completion }, module: 'task', companyId });
};

/* One status change through the task route, to any status the task's project defines. `agent` is the work entry of an agent making it for `who`. */
const setStatus = async ({ companyId, who, taskId, name, agent = null }) => {
    const task = await liveTask(companyId, taskId);
    const patch = await tools.resolveStatus(companyId, task.ProjectID, name);
    const from = { name: (task.status && task.status.text) || '', statusType: task.statusType || '' };
    if (patch.statusKey === task.statusKey) return { task, from, patch, changed: false };
    if (agent && require('./registry').DONE_STATUS_TYPES.includes(String(patch.statusType)) && (await require('./accounts').getPolicy(companyId)).requireCheckBeforeDone) {
        throw refuse('this workspace has a person check an agent\'s work before it is closed, so a person closes this task');
    }
    const rows = flatStatuses(await storedProject(companyId, task.ProjectID));
    const current = rows.find((row) => row.key === task.statusKey) || {};
    const next = rows.find((row) => row.key === patch.statusKey) || {};
    await asRoute(companyId, who, 'updateStatus', {
        newStatus: patch,
        prevStatus: { backColor: current.bgColor || '', color: current.textColor || '', statusName: current.name || from.name, bgColor: next.bgColor || '', textColor: next.textColor || '', updatedTaskName: patch.status.text },
        projectData: {}, task: { ...taskRef(task), statusType: task.statusType || '', status: task.status || {} }, isUpdateTask: true,
    }, agent ? { recordsCompletion: false } : {});
    if (agent) await runAs(who.mark, () => recordAgentStatus(companyId, task, from, patch, { ...agent, onBehalfOf: who.uid }));
    return { task, from, patch, changed: true };
};

const typeNamed = (project, wanted) => {
    const name = String(wanted || '').trim().toLowerCase();
    return (Array.isArray(project.taskTypeCounts) ? project.taskTypeCounts : []).filter(Boolean)
        .find((type) => String(type.value || '').toLowerCase() === name || String(type.name || '').toLowerCase() === name);
};

const linksFrom = (given, actor) => {
    const { attribution } = require('./actor');
    const by = attribution(actor);
    if (!Array.isArray(given) || given.length > LINKS_MAX) throw refuse(`links need a list of at most ${LINKS_MAX}`);
    return given.map((link) => {
        const url = String((link && link.url) || '').trim();
        if (!/^https?:\/\//i.test(url) || url.length > 2000) throw refuse('each link needs a valid http(s) url');
        return {
            _id: String(new mongoose.Types.ObjectId()), url,
            kind: LINK_KINDS.includes(link.kind) ? link.kind : (/\/pull\/\d+|\/merge_requests\/\d+/.test(url) ? 'pr' : 'url'),
            label: String(link.label || '').slice(0, 200), addedBy: by.actorId, actorType: by.actorType, agentId: by.agentId || null, addedAt: new Date().toISOString(),
        };
    });
};

/* What a new task is created with beyond its title, each value checked the way the matching change checks it. */
const createFieldsOf = async ({ companyId, actor, who, project, fields }) => {
    const given = fields && typeof fields === 'object' ? fields : {};
    const unknown = Object.keys(given).filter((name) => !require('./registry').CREATE_FIELDS.includes(name));
    if (unknown.length) throw refuse(`${unknown.join(', ')} cannot be set when a task is created`);
    const zone = await zoneOf(who.uid);
    const set = {};
    if (given.rawDescription !== undefined) {
        set.rawDescription = EDITS.rawDescription.clean(given.rawDescription);
        set.descriptionBlock = descriptionBlockFrom(set.rawDescription);
    }
    if (given.Task_Priority !== undefined) set.Task_Priority = EDITS.Task_Priority.clean(given.Task_Priority);
    if (given.DueDate !== undefined && given.DueDate !== null) {
        set.DueDate = EDITS.DueDate.clean(given.DueDate, zone);
        set.dueDateDeadLine = [{ date: set.DueDate }];
    }
    if (given.startDate !== undefined) set.startDate = EDITS.startDate.clean(given.startDate, zone);
    if (set.startDate && set.DueDate && new Date(set.startDate) > new Date(set.DueDate)) throw refuse('startDate is after dueDate');
    if (given.totalEstimatedTime !== undefined) set.totalEstimatedTime = EDITS.totalEstimatedTime.clean(given.totalEstimatedTime);
    if (given.AssigneeUserId !== undefined) set.AssigneeUserId = await assignable(companyId, idOf(project._id), given.AssigneeUserId);
    if (given.status !== undefined) Object.assign(set, await tools.resolveStatus(companyId, project._id, given.status));
    if (given.TaskType !== undefined) {
        const type = typeNamed(project, given.TaskType);
        if (!type) throw refuse(`taskType needs one of ${(project.taskTypeCounts || []).map((row) => row && row.name).filter(Boolean).join(', ') || 'the project\'s task types'}`);
        set.TaskType = type.value;
        set.TaskTypeKey = type.key;
    }
    if (given.links !== undefined) set.links = linksFrom(given.links, actor);
    return set;
};

/* The list a new task lands in: the one named, or the project's oldest one the person can see. */
const listFor = async (companyId, uid, project, sprintId) => {
    const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
    const { canSeeSprint, sprintIdentities } = require('../Sprints/helpers/sprintVisibility');
    const projectId = idOf(project._id);
    const filter = sprintId
        ? { _id: OBJECT_ID.test(idOf(sprintId)) ? oid(sprintId) : null, deletedStatusKey: { $nin: [1] } }
        : { projectId: { $in: idForms(projectId) }, deletedStatusKey: { $in: [0, null] } };
    const lists = (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [filter, null, { sort: { createdAt: 1 }, limit: 50 }] }, 'find')) || [];
    const seesAll = isPrivileged(await getRoleType(companyId, uid));
    const identities = seesAll ? [] : await sprintIdentities(companyId, uid);
    const list = lists.find((row) => idOf(row.projectId) === projectId && (seesAll || canSeeSprint(row, identities)));
    if (!list) throw refuse(sprintId ? 'that list was not found in that project' : 'that project has no list to add a task to');
    return list;
};

/* The key is assigned just after the create answers, as it is for a person, who sees it arrive a moment later. */
const keyOnceAssigned = async (companyId, taskId) => {
    for (let read = 0; read < KEY_READS; read += 1) {
        const row = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId) }, { TaskKey: 1 }] }, 'findOne');
        if (row && row.TaskKey && row.TaskKey !== NO_KEY) return row.TaskKey;
        await new Promise((resolve) => { setTimeout(resolve, KEY_WAIT_MS); });
    }
    return '';
};

const createThroughRoute = async ({ companyId, who, project, placement, parent, title, set }) => {
    const rows = flatStatuses(project);
    const opening = rows.find((row) => row.type === 'default_active') || rows[0];
    if (!opening) throw refuse('that project has no statuses');
    const firstType = (Array.isArray(project.taskTypeCounts) && project.taskTypeCounts[0]) || {};
    const assignees = set.AssigneeUserId || [];
    const data = {
        TaskName: title, TaskKey: NO_KEY, AssigneeUserId: assignees, watchers: [...new Set([...assignees, who.uid])], DueDate: '', dueDateDeadLine: [],
        TaskType: parent ? (parent.TaskType || 'task') : (firstType.value || firstType.name || 'task'),
        TaskTypeKey: parent ? (parent.TaskTypeKey || 1) : firstType.key,
        ParentTaskId: parent ? idOf(parent._id) : '', isParentTask: !parent, ProjectID: idOf(project._id), CompanyId: String(companyId),
        status: { text: opening.name, key: opening.key, value: opening.value || '', type: opening.type }, statusType: opening.type, statusKey: opening.key,
        Task_Leader: who.uid, Task_Priority: 'MEDIUM', deletedStatusKey: 0,
        ...placement, ...set,
    };
    const created = await asRoute(companyId, who, 'create', {
        data, user: {},
        projectData: { _id: idOf(project._id), CompanyId: String(companyId), lastTaskId: project.lastTaskId || 0, ProjectName: project.ProjectName || '', ProjectCode: project.ProjectCode || '' },
        indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: data.statusKey },
    });
    if (!created || !created.id) throw refuse('the task was not created');
    return { taskId: idOf(created.id), key: await keyOnceAssigned(companyId, created.id), title };
};

const executors = {
    async 'task.status.change'({ companyId, actor, params, depth }) {
        const who = whoOf(actor, depth);
        const { workEntry } = require('./actions');
        const name = params.status && (params.status.name || params.status.text);
        const { task, from, patch, changed } = await setStatus({ companyId, who, taskId: params.taskId, name, agent: who.via ? workEntry(actor) : null });
        return {
            result: { status: patch.status.text, statusType: patch.statusType, changed },
            undo: changed ? { kind: 'statusChange', taskId: idOf(task._id), previous: from.name } : null, entityId: task._id, entityName: task.TaskName,
        };
    },

    async 'task.add'({ companyId, actor, params, depth }) {
        const who = whoOf(actor, depth);
        const title = EDITS.TaskName.clean(params.title);
        const project = await storedProject(companyId, params.projectId);
        const list = await sprintRef(companyId, await listFor(companyId, who.uid, project, params.sprintId));
        const set = await createFieldsOf({ companyId, actor, who, project, fields: params.fields });
        const placement = { sprintId: list.id, sprintArray: list, ...(list.folderId ? { folderObjId: list.folderId } : {}) };
        const made = await createThroughRoute({ companyId, who, project, placement, parent: null, title, set });
        return { result: made, undo: { kind: 'task', taskId: made.taskId, projectId: idOf(project._id) }, entityId: made.taskId, entityName: title };
    },

    async 'subtask.add'({ companyId, actor, params, depth }) {
        const who = whoOf(actor, depth);
        const parent = await liveTask(companyId, params.taskId);
        const title = EDITS.TaskName.clean(params.title);
        const project = await storedProject(companyId, parent.ProjectID);
        const set = await createFieldsOf({ companyId, actor, who, project, fields: params.fields });
        const placement = { sprintId: idOf(parent.sprintId), sprintArray: parent.sprintArray || {} };
        const made = await createThroughRoute({ companyId, who, project, placement, parent, title, set });
        return { result: { subtaskId: made.taskId, key: made.key, title }, undo: { kind: 'subtask', subtaskId: made.taskId, parentTaskId: idOf(parent._id) }, entityId: params.taskId };
    },

    async 'task.edit'({ companyId, actor, params, depth }) {
        const who = whoOf(actor, depth);
        const { uid } = who;
        const task = await liveTask(companyId, params.taskId);
        const given = params.fields && typeof params.fields === 'object' ? params.fields : {};
        const names = Object.keys(given);
        const unknown = names.filter((name) => !Object.hasOwn(EDITS, name));
        if (unknown.length) throw refuse(`${unknown.join(', ')} cannot be changed here`);
        if (!names.length) throw refuse('name at least one field to change');
        const zone = await zoneOf(uid);
        const wanted = names.map((name) => ({ name, value: EDITS[name].clean(given[name], zone) }));
        const start = wanted.find((change) => change.name === 'startDate');
        const due = wanted.find((change) => change.name === 'DueDate');
        if (start && due && due.value && new Date(start.value) > new Date(due.value)) throw refuse('startDate is after dueDate');

        const changes = wanted.filter(({ name, value }) => !EDITS[name].same(task, value));
        const previous = {};
        for (const { name, value } of changes) {
            await EDITS[name].write({ companyId, who, task, value, zone, note: String(params.note || '').slice(0, 500) });
            Object.assign(previous, EDITS[name].previous(task));
        }
        const changed = changes.map((change) => change.name);
        return { result: { changed }, undo: changed.length ? { kind: 'update', taskId: idOf(task._id), previous } : null, entityId: task._id, entityName: task.TaskName };
    },

    async 'task.assignees.set'({ companyId, actor, params, depth }) {
        const who = whoOf(actor, depth);
        const task = await liveTask(companyId, params.taskId);
        const mode = String(params.mode || '');
        if (!ASSIGN_MODES.includes(mode)) throw refuse(`mode needs one of ${ASSIGN_MODES.join(', ')}`);
        const held = (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : []).map(String);
        const named = await assignable(companyId, idOf(task.ProjectID), params.userIds, mode === 'remove' && Array.isArray(params.userIds) ? params.userIds.map(idOf) : held);
        if (!named.length && mode !== 'set') throw refuse('userIds names no one');
        const added = mode === 'remove' ? [] : named.filter((id) => !held.includes(id));
        const removed = mode === 'add' ? [] : held.filter((id) => (mode === 'set' ? !named.includes(id) : named.includes(id)));

        const { employeeNameOf } = require('../Tasks/helpers/taskWriteFields');
        const change = async (id, type) => asRoute(companyId, who, 'updateAssignee', {
            firebaseObj: { AssigneeUserId: id }, projectData: {}, taskData: taskRef(task), employeeName: await employeeNameOf(id), type, isUpdateTask: true,
        });
        for (const id of removed) await change(id, 'assigneRemove');
        for (const id of added) await change(id, 'assigneeAdd');
        const assignees = [...held.filter((id) => !removed.includes(id)), ...added];
        const touched = added.length + removed.length > 0;
        return { result: { assignees, added, removed }, undo: touched ? { kind: 'assign', taskId: idOf(task._id), previous: held } : null, entityId: task._id, entityName: task.TaskName };
    },

    async 'task.field.set'({ companyId, actor, params, depth }) {
        const who = whoOf(actor, depth);
        const { uid } = who;
        const task = await liveTask(companyId, params.taskId);
        const fieldId = idOf(params.fieldId);
        const { fieldAppliesToTask } = require('../CustomField/helpers/fieldTaskTypes');
        const { storedValueOf, isTaskFieldOf } = require('../CustomField/helpers/fieldValueInput');
        const definition = OBJECT_ID.test(fieldId)
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ _id: oid(fieldId) }] }, 'findOne')
            : null;
        if (!isTaskFieldOf(definition, task.ProjectID)) throw refuse('that custom field is not one this task\'s project has');
        const title = definition.fieldTitle || 'The field';
        if (!fieldAppliesToTask(definition, task)) throw refuse(`${title} is not used for this task's type`);
        const read = storedValueOf(definition, params.value, { zone: await zoneOf(uid) });
        if (read.error) throw refuse(`${title} ${read.error}`);

        const held = task.customField && task.customField[fieldId] !== undefined ? task.customField[fieldId] : null;
        await asRoute(companyId, who, 'updateTaskCustomField', { companyId, taskId: idOf(task._id), customFieldId: fieldId, updateDetail: { fieldValue: read.value, _id: fieldId } });
        return { result: { fieldId, title: definition.fieldTitle || '' }, undo: { kind: 'update', taskId: idOf(task._id), previous: { [`customField.${fieldId}`]: held } }, entityId: task._id, entityName: task.TaskName };
    },

    async 'task.move'({ companyId, actor, params, depth }) {
        const who = whoOf(actor, depth);
        const { uid } = who;
        const task = await liveTask(companyId, params.taskId);
        if (task.ParentTaskId) throw refuse(SUBTASK_MOVES_WITH_PARENT);
        if ((Number(task.deletedStatusKey) || LIVE) !== LIVE) throw refuse('an archived task is restored before it is moved');
        const destination = await destinationOf({ companyId, actor, uid, params });
        const destinationId = idOf(destination.project._id);
        if (idOf(task.sprintId) === idOf(destination.sprint._id)) throw refuse('the task is already in that list');

        const { loadSubtree } = require('../Tasks/helpers/taskTree');
        const subtree = await loadSubtree(companyId, task._id, { filter: { deletedStatusKey: { $nin: [TRASHED] } } });
        const source = await storedProject(companyId, task.ProjectID);
        const sameProject = idOf(source._id) === destinationId;
        const mapping = sameProject ? { taskStatusData: source.taskStatusData || [], taskTypeCounts: source.taskTypeCounts || [] } : mappedForMove(source, destination.project);
        if (!sameProject && !coveredByMapping([task, ...subtree], mapping)) throw refuse('a status or task type on this task is not one its project defines, so it cannot be carried into another project');

        const carried = (ids) => (sameProject ? (ids || []).map(String) : peopleWhoOpen(companyId, destinationId, (ids || []).map(String).filter((id) => OBJECT_ID.test(id))));
        const body = {
            companyId,
            projectData: { id: destinationId, ProjectCode: destination.project.ProjectCode || '', ProjectName: destination.project.ProjectName || '' },
            sprintObj: await sprintRef(companyId, destination.sprint),
            oldSprintObj: { id: idOf(task.sprintId), folderId: idOf(task.folderObjId) || null, name: (task.sprintArray && task.sprintArray.name) || '', folderName: (task.sprintArray && task.sprintArray.folderName) || '' },
            oldProject: { id: idOf(source._id), ProjectName: source.ProjectName || '', ...mapping },
            assignee: await carried(task.AssigneeUserId),
            watcher: await carried(task.watchers),
        };
        await asRoute(companyId, who, 'moveTask', { ...body, moveTaskId: idOf(task._id), isSubTask: subtree.length > 0 });

        return { result: { projectId: destinationId, sprintId: idOf(destination.sprint._id), moved: 1 + subtree.length }, undo: null, entityId: task._id, entityName: task.TaskName };
    },

    async 'task.archive'({ companyId, actor, params, depth }) {
        const { task, from } = await setArchived({ companyId, who: whoOf(actor, depth), taskId: params.taskId, to: ARCHIVED });
        return { result: { archived: true }, undo: { kind: 'archive', taskId: idOf(task._id), previous: from }, entityId: task._id, entityName: task.TaskName };
    },

    async 'task.restore'({ companyId, actor, params, depth }) {
        const { task, from } = await setArchived({ companyId, who: whoOf(actor, depth), taskId: params.taskId, to: LIVE });
        return { result: { archived: false }, undo: { kind: 'archive', taskId: idOf(task._id), previous: from }, entityId: task._id, entityName: task.TaskName };
    },
};

module.exports = { executors, setArchived, setStatus, whoOf, asRoute, liveTask, storedProject, LINK_KINDS, LINKS_MAX, PRIORITIES, ASSIGN_MODES, TITLE_MAX, DESCRIPTION_MAX, ESTIMATE_MAX_MINUTES, ASSIGNEES_MAX, SUBTASK_MOVES_WITH_PARENT, CANNOT_OPEN_PROJECT };
