const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const logger = require('../../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const { escapeRegex } = require('../../utils/escapeRegex');
const { hiddenSprintFilter, canSeeSprint, sprintIdentities, TEAM_PREFIX } = require('../Sprints/helpers/sprintVisibility');
const { keepTaskListProjectIds } = require('../Tasks/helpers/taskListProjects');
const { CLOSED_STATUS_TYPES } = require('../Tasks/helpers/taskSignals');
const { pageReachFilter } = require('../Pages/helpers/pageRules');
const { openProjects, tokenProjectIdsOf } = require('./ask');

// What the @ picker in the Ask box offers. Every row is read through the asker's own reach: projects
// they can open, lists they can see, tasks they may list, docs they can read and the people they work
// with. With no query it suggests the scoped project, what the asker opened lately and their own work.

const KIND_ORDER = ['project', 'list', 'task', 'page', 'person'];
const LIMITS = { project: 5, list: 5, task: 6, page: 4, person: 5 };
const MAX_QUERY = 60;
const RECENT_READ = 30;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const personName = (u) => clip(u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' '), 120);

const find = async (db, type, filter, fields, options) => (await MongoDbCrudOpration(db, {
    type, data: options ? [filter, fields, options] : [filter, fields],
}, 'find').catch(() => [])) || [];

/* One row per thing, in picker order, at most LIMITS of each kind. */
const shapeItems = (items) => {
    const seen = new Set();
    const counts = {};
    return items
        .filter((item) => item && item.id && item.title && KIND_ORDER.includes(item.kind))
        .filter((item) => {
            const key = `${item.kind}:${item.id}`;
            if (seen.has(key) || (counts[item.kind] || 0) >= LIMITS[item.kind]) return false;
            seen.add(key);
            counts[item.kind] = (counts[item.kind] || 0) + 1;
            return true;
        })
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
};

const reachOf = async (companyId, uid, tokenProjectIds) => {
    const [projects, roleType] = await Promise.all([openProjects(companyId, uid, tokenProjectIds), getRoleType(companyId, uid).catch(() => null)]);
    const openIds = projects.map((p) => String(p._id));
    const listed = openIds.length ? await keepTaskListProjectIds(companyId, uid, openIds) : [];
    const names = new Map(projects.map((p) => [String(p._id), p.ProjectName || '']));
    return { projects, openIds, listed, names, roleType, privileged: isPrivileged(roleType) };
};

const projectItem = (p) => ({ kind: 'project', id: String(p._id), title: clip(p.ProjectName, 120), sub: '' });
const listItem = (s, names) => ({ kind: 'list', id: String(s._id), title: clip(s.name, 120), sub: names.get(String(s.projectId)) || '', projectId: String(s.projectId) });
const taskItem = (t, names) => ({ kind: 'task', id: String(t._id), title: clip(t.TaskName, 160), sub: [t.TaskKey, names.get(String(t.ProjectID))].filter(Boolean).join(' · '), projectId: String(t.ProjectID) });
const pageItem = (p, names) => ({ kind: 'page', id: String(p._id), title: clip(p.title, 160), sub: p.ProjectID ? names.get(String(p.ProjectID)) || '' : '', projectId: p.ProjectID ? String(p.ProjectID) : '' });

const readLists = async (companyId, uid, reach, filter, limit) => {
    if (!reach.openIds.length) return [];
    const rows = await find(companyId, SCHEMA_TYPE.SPRINTS,
        { projectId: { $in: idForms(reach.openIds) }, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true }, ...filter },
        'name projectId private AssigneeUserId', { sort: { updatedAt: -1 }, limit: limit * 4 });
    const identities = reach.privileged ? null : await sprintIdentities(companyId, uid);
    return rows.filter((s) => !identities || canSeeSprint(s, identities)).slice(0, limit).map((s) => listItem(s, reach.names));
};

const taskFilter = async (companyId, uid, reach, extra) => ({
    ProjectID: { $in: reach.listed }, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true },
    ...(await hiddenSprintFilter(companyId, uid, reach.listed)), ...extra,
});

const readTasks = async (companyId, uid, reach, extra, limit) => {
    if (!reach.listed.length) return [];
    const rows = await find(companyId, SCHEMA_TYPE.TASKS, await taskFilter(companyId, uid, reach, extra), 'TaskName TaskKey ProjectID', { sort: { updatedAt: -1 }, limit });
    return rows.map((t) => taskItem(t, reach.names));
};

const readPages = async (companyId, uid, reach, extra, limit) => {
    const rows = await find(companyId, SCHEMA_TYPE.PAGES,
        { deletedStatusKey: { $ne: 1 }, ...extra, ...pageReachFilter({ uid, projectIds: idForms(reach.openIds) }) },
        'title ProjectID', { sort: { updatedAt: -1 }, limit });
    return rows.map((p) => pageItem(p, reach.names));
};

/* A guest finds the people on the projects shared with them; everyone else, the company's members. */
const readPeople = async (companyId, uid, reach, rx) => {
    const seats = await find(companyId, SCHEMA_TYPE.COMPANY_USERS, { ...ACTIVE_SEAT }, { userId: 1 });
    let ids = seats.map((seat) => String(seat.userId)).filter((id) => OBJECT_ID.test(id));
    if (reach.roleType === ROLE_GUEST) {
        const rows = await find(companyId, SCHEMA_TYPE.PROJECTS, { _id: { $in: reach.openIds.map(oid) } }, 'AssigneeUserId');
        const shared = new Set([String(uid), ...rows.flatMap((p) => (Array.isArray(p.AssigneeUserId) ? p.AssigneeUserId : []).map(String).filter((id) => !id.startsWith(TEAM_PREFIX)))]);
        ids = ids.filter((id) => shared.has(id));
    }
    if (!ids.length) return [];
    const users = await find(dbCollections.GLOBAL, SCHEMA_TYPE.USERS,
        { _id: { $in: ids.map(oid) }, $or: [{ Employee_Name: rx }, { Employee_FName: rx }, { Employee_LName: rx }] },
        { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 }, { limit: LIMITS.person });
    return users.map((u) => ({ kind: 'person', id: String(u._id), title: personName(u), sub: '' }));
};

const search = async (companyId, uid, reach, query) => {
    const rx = { $regex: escapeRegex(query), $options: 'i' };
    const [lists, tasks, pages, people] = await Promise.all([
        readLists(companyId, uid, reach, { name: rx }, LIMITS.list),
        readTasks(companyId, uid, reach, { $or: [{ TaskName: rx }, { TaskKey: rx }] }, LIMITS.task),
        readPages(companyId, uid, reach, { title: rx }, LIMITS.page),
        readPeople(companyId, uid, reach, rx),
    ]);
    const named = new RegExp(escapeRegex(query), 'i');
    const projects = reach.projects.filter((p) => named.test(p.ProjectName || '')).map(projectItem);
    return [...projects, ...lists, ...tasks, ...pages, ...people];
};

/* Recently opened projects, tasks and docs, each read again through the asker's reach. */
const recentItems = async (companyId, uid, reach) => {
    const visits = await find(companyId, SCHEMA_TYPE.RECENTVISITS, { userId: String(uid), entityType: { $in: ['project', 'task', 'page'] } }, 'entityType entityId', { sort: { visitedAt: -1 }, limit: RECENT_READ });
    const idsOf = (type) => visits.filter((v) => v.entityType === type).map((v) => String(v.entityId)).filter((id) => OBJECT_ID.test(id));
    const order = new Map(visits.map((v, i) => [`${v.entityType}:${v.entityId}`, i]));
    const projectIds = idsOf('project').filter((id) => reach.openIds.includes(id));
    const [tasks, pages] = await Promise.all([
        idsOf('task').length ? readTasks(companyId, uid, reach, { _id: { $in: idsOf('task').map(oid) } }, LIMITS.task) : [],
        idsOf('page').length ? readPages(companyId, uid, reach, { _id: { $in: idsOf('page').map(oid) } }, LIMITS.page) : [],
    ]);
    const projects = reach.projects.filter((p) => projectIds.includes(String(p._id))).map(projectItem);
    return [...projects, ...tasks, ...pages].sort((a, b) => (order.get(`${a.kind}:${a.id}`) ?? 99) - (order.get(`${b.kind}:${b.id}`) ?? 99));
};

const suggest = async (companyId, uid, reach, projectId) => {
    const scoped = reach.projects.find((p) => String(p._id) === String(projectId || ''));
    const [lists, recent, mine] = await Promise.all([
        scoped ? readLists(companyId, uid, { ...reach, openIds: [String(scoped._id)] }, {}, LIMITS.list) : [],
        recentItems(companyId, uid, reach),
        readTasks(companyId, uid, reach, { AssigneeUserId: String(uid), statusType: { $nin: CLOSED_STATUS_TYPES } }, LIMITS.task),
    ]);
    const fallback = reach.projects.slice(0, LIMITS.project).map(projectItem);
    return [...(scoped ? [projectItem(scoped)] : []), ...recent, ...lists, ...mine, ...fallback];
};

/* GET /api/v1/ai/ask/mentions?q=&projectId= */
const mentions = async (req, res) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const uid = req.uid ? String(req.uid) : '';
        if (!companyId || !uid) return res.status(401).send({ status: false, statusText: 'companyId and an authenticated user are required.', code: 'unauthenticated' });
        const query = clip(typeof req.query.q === 'string' ? req.query.q : '', MAX_QUERY);
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
        const reach = await reachOf(companyId, uid, tokenProjectIdsOf(req));
        if (reach.roleType === null) return res.status(403).send({ status: false, statusText: 'You are not a member of this company.', code: 'not_member' });
        const items = query ? await search(companyId, uid, reach, query) : await suggest(companyId, uid, reach, projectId);
        return res.send({ status: true, data: { items: shapeItems(items), suggested: !query } });
    } catch (error) {
        logger.error(`ai ask mentions: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

module.exports = { mentions, shapeItems, KIND_ORDER, LIMITS };
