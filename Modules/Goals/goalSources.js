const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { isPrivileged } = require('../../Config/roleTypes');
const { sharedProjects, READER_CAP } = require('../AI/publicSources');
const { canSeeSprint, sprintIdentities } = require('../Sprints/helpers/sprintVisibility');
const { openableTasks } = require('../Tasks/helpers/taskReadAccess');
const { PRIVATE, PEOPLE } = require('./helpers/goalAccess');
const { GoalRefused, TASKS } = require('./helpers/goalRules');

/* One number is shown to every reader of a goal, so it is built only from lists and tasks that
 * every one of them can open (the rule Modules/AI/publicSources.js keeps for a shared thread).
 * - A private goal has one reader, its owner, who counts whatever they can open themselves.
 * - A goal shared with people counts what all of them can open, never a private list and never a
 *   personal list; past READER_CAP readers it is held to the workspace rule.
 * - A workspace goal counts public projects only, outside private lists.
 * A chat channel is a list outside the projects collection, so no rule ever admits one. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TRASHED = 1;
const KINDS = Object.freeze(['sprintIds', 'taskIds']);

const isId = (value) => OBJECT_ID.test(String(value || ''));
const unique = (values) => [...new Set(values.map(String))];
const oids = (ids) => unique(ids).filter(isId).map((id) => new mongoose.Types.ObjectId(id));
const find = async (companyId, type, filter, fields) => (await MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'find')) || [];
const byId = (rows) => new Map(rows.map((row) => [String(row._id), row]));
const none = () => ({ sprintIds: [], taskIds: [] });
const sourcesOf = (target) => ({ sprintIds: ((target.sources || {}).sprintIds || []).map(String), taskIds: ((target.sources || {}).taskIds || []).map(String) });
const holdsSources = (target) => target.kind === TASKS && KINDS.some((kind) => sourcesOf(target)[kind].length > 0);

/* One person reading with their own access: the owner of a private goal, or whoever links a source.
 * Someone without a live seat opens no project, so only the role needs the seat here. */
const soleReader = async (companyId, uid) => {
    const seat = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: String(uid), ...ACTIVE_SEAT }, { roleType: 1 }] }, 'findOne');
    return { sole: String(uid), readers: [String(uid)], privileged: Boolean(seat) && isPrivileged(seat.roleType) };
};

const audienceOf = async (companyId, goal) => {
    if (goal.visibility === PRIVATE) return soleReader(companyId, goal.ownerUserId);
    const named = unique([goal.ownerUserId, ...(goal.sharedWith || [])]);
    if (goal.visibility !== PEOPLE || named.length > READER_CAP) return { everyone: true };
    const seats = await find(companyId, SCHEMA_TYPE.COMPANY_USERS, { userId: { $in: named }, ...ACTIVE_SEAT }, { userId: 1 });
    return { readers: unique(seats.map((seat) => seat.userId)) };
};

const openProjects = async (companyId, audience, candidates) => {
    if (!candidates.length) return new Set();
    if (audience.everyone) {
        const projects = await find(companyId, SCHEMA_TYPE.PROJECTS, {
            _id: { $in: oids(candidates) }, isPrivateSpace: false, isPersonal: { $ne: true }, deletedStatusKey: { $nin: [TRASHED] },
        }, { _id: 1 });
        return new Set(projects.map((project) => String(project._id)));
    }
    const open = new Set((await sharedProjects(companyId, audience.readers)).map((project) => String(project._id)));
    if (audience.sole) return open;
    const personal = await find(companyId, SCHEMA_TYPE.PROJECTS, { _id: { $in: oids(candidates) }, isPersonal: true }, { _id: 1 });
    personal.forEach((project) => open.delete(String(project._id)));
    return open;
};

/* Splits sources into the ones the audience can open and the ones it cannot. A source that is not there answers as one that cannot be opened. */
const judge = async (companyId, audience, sources) => {
    const tasks = sources.taskIds.length ? await find(companyId, SCHEMA_TYPE.TASKS, { _id: { $in: oids(sources.taskIds) } }, 'ProjectID sprintId mainChat TaskName TaskKey') : [];
    const listIds = unique([...sources.sprintIds, ...tasks.map((task) => task.sprintId || '')]).filter(isId);
    const lists = listIds.length ? await find(companyId, SCHEMA_TYPE.SPRINTS, { _id: { $in: oids(listIds) } }, 'projectId private AssigneeUserId deletedStatusKey name') : [];
    const open = await openProjects(companyId, audience, unique([...lists.map((list) => list.projectId), ...tasks.map((task) => task.ProjectID)]).filter(isId));
    const identities = audience.sole && !audience.privileged ? await sprintIdentities(companyId, audience.sole) : [];
    const listById = byId(lists);
    const taskById = byId(tasks);

    const listOpen = (id) => {
        const list = listById.get(String(id));
        if (!list || Number(list.deletedStatusKey) === TRASHED || !open.has(String(list.projectId))) return false;
        return audience.sole ? (audience.privileged || canSeeSprint(list, identities)) : list.private !== true;
    };
    const taskOpen = (id) => {
        const task = taskById.get(String(id));
        return Boolean(task) && task.mainChat !== true && open.has(String(task.ProjectID)) && listOpen(task.sprintId);
    };
    const split = (ids, isOpen) => [ids.filter((id) => isOpen(id)), ids.filter((id) => !isOpen(id))];
    const [openLists, closedLists] = split(sources.sprintIds, listOpen);
    const [openTasks, closedTasks] = split(sources.taskIds, taskOpen);
    return { counted: { sprintIds: openLists, taskIds: openTasks }, skipped: { sprintIds: closedLists, taskIds: closedTasks }, rows: { sprintIds: listById, taskIds: taskById } };
};

const noNames = () => ({ sprintIds: {}, taskIds: {} });

/* What one person is told about the sources they are shown: the name of a list they can open, and of a
 * task the task read itself would give them. A source they cannot open has no entry, whoever linked it. */
const namesFor = async (companyId, uid, sources) => {
    const names = noNames();
    if (!KINDS.some((kind) => sources[kind].length)) return names;
    const { counted, rows } = await judge(companyId, await soleReader(companyId, uid), sources);
    const readable = new Set((await openableTasks(companyId, uid, counted.taskIds)).map((row) => String(row._id)));
    const taskIds = counted.taskIds.filter((id) => readable.has(String(id)));
    const projectOf = { sprintIds: (id) => String(rows.sprintIds.get(String(id)).projectId), taskIds: (id) => String(rows.taskIds.get(String(id)).ProjectID) };
    const projectIds = unique([...counted.sprintIds.map(projectOf.sprintIds), ...taskIds.map(projectOf.taskIds)]);
    const projectNames = byId(projectIds.length ? await find(companyId, SCHEMA_TYPE.PROJECTS, { _id: { $in: oids(projectIds) } }, 'ProjectName') : []);
    const placed = (projectId) => ({ projectId, projectName: (projectNames.get(projectId) || {}).ProjectName || '' });
    counted.sprintIds.forEach((id) => {
        names.sprintIds[id] = { id, name: rows.sprintIds.get(id).name || '', ...placed(projectOf.sprintIds(id)) };
    });
    taskIds.forEach((id) => {
        const task = rows.taskIds.get(id);
        names.taskIds[id] = { id, name: task.TaskName || '', key: task.TaskKey || '', ...placed(projectOf.taskIds(id)) };
    });
    return names;
};

const namesOf = (names, sources) => Object.fromEntries(KINDS.map((kind) => [kind, Object.fromEntries(sources[kind].filter((id) => names[kind][id]).map((id) => [id, names[kind][id]]))]));

const merged = (sets) => Object.fromEntries(KINDS.map((kind) => [kind, unique(sets.flatMap((set) => set[kind] || []))]));

const firstSkipped = (skipped) => {
    const kind = KINDS.find((key) => skipped[key].length);
    return kind ? [kind, skipped[kind][0]] : null;
};

const WHAT = Object.freeze({ sprintIds: 'list', taskIds: 'task' });

/* A new source must be one the person linking it can open, and then one every reader of the goal can.
 * The first refusal says nothing a missing id would not; the second is told to someone who can open the source. */
const requireCountable = async (companyId, uid, goal, sources, at = 'sources') => {
    const fieldOf = ([kind, id]) => `${at}.${kind}.${sources[kind].indexOf(id)}`;
    const own = firstSkipped((await judge(companyId, await soleReader(companyId, uid), sources)).skipped);
    if (own) throw new GoalRefused(fieldOf(own), `is not a ${WHAT[own[0]]} you can open`, { code: 'source_not_found' });
    const { skipped } = await judge(companyId, await audienceOf(companyId, goal), sources);
    const shared = firstSkipped(skipped);
    if (shared) {
        throw new GoalRefused(fieldOf(shared), 'cannot be counted on this goal: not everyone who reads the goal can open it. Share the goal with fewer people, or use a number target instead', { code: 'source_not_shared', sources: skipped });
    }
};

/* The sources `goal` counts today that `next`, the same goal with other readers, would leave out. */
const wouldDrop = async (companyId, goal, next) => {
    const targets = (goal.targets || []).filter(holdsSources);
    if (!targets.length) return none();
    const [before, after] = await Promise.all([audienceOf(companyId, goal), audienceOf(companyId, next)]);
    const dropped = none();
    for (const target of targets) {
        const sources = sourcesOf(target);
        const [now, then] = [await judge(companyId, before, sources), await judge(companyId, after, sources)];
        KINDS.forEach((kind) => dropped[kind].push(...now.counted[kind].filter((id) => !then.counted[kind].includes(id))));
    }
    return { sprintIds: unique(dropped.sprintIds), taskIds: unique(dropped.taskIds) };
};

module.exports = { READER_CAP, KINDS, audienceOf, judge, namesFor, namesOf, noNames, merged, requireCountable, wouldDrop, sourcesOf, holdsSources, none };
