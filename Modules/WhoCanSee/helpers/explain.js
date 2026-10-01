const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { ROLE_GUEST, isPrivileged } = require('../../../Config/roleTypes');
const { canReadProject, canEditProject, DETAILS } = require('../../../Config/projectAccess');
const { TEAM_PREFIX, canSeeSprint, sprintIdentities } = require('../../Sprints/helpers/sprintVisibility');
const { canUsePage, canManageShares } = require('../../Pages/helpers/pageAccess');
const { shareFor } = require('../../Pages/helpers/pageRules');
const { shareIsLive } = require('../../PublicShares/helpers/shareAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const KINDS = Object.freeze(['project', 'sprint', 'page']);
const TASK_CREATE = 'task.task_create';
// Any one of these lets a member rename, share or archive a sprint (Modules/Sprints/routes.js SPRINT_EDIT).
const SPRINT_MANAGE = ['project.project_sprint_name_edit', 'project.sprint_type_change', 'project.project_sprint_create'];
// A public doc link serves its subtree this many levels down (Modules/PublicShares/publicRenderer.js).
const SHARED_TREE_MAX_DEPTH = 12;
const CONCURRENCY = 8;
const REASON_ORDER = ['personal', 'author', 'named', 'admin', 'sprint_member', 'sprint_team', 'member', 'team', 'guest', 'role', 'everyone'];
const SPRINT_REASONS = { member: 'sprint_member', team: 'sprint_team', guest: 'guest' };
const LEVELS = ['view', 'edit', 'manage'];

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isId = (id) => OBJECT_ID.test(String(id || ''));
const findOne = (companyId, type, filter) => MongoDbCrudOpration(companyId, { type, data: [filter] }, 'findOne');

const mapLimit = async (items, limit, fn) => {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            out[index] = await fn(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
};

const activeMembers = async (companyId) => {
    const seats = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ ...ACTIVE_SEAT }, { userId: 1, roleType: 1 }],
    }, 'find');
    const members = new Map();
    (seats || []).forEach((seat) => {
        const uid = String(seat.userId || '');
        if (isId(uid) && !members.has(uid)) members.set(uid, seat.roleType);
    });
    return members;
};

const teamsIn = async (companyId, assignees) => {
    const ids = [...new Set((assignees || []).map(String).filter((a) => a.startsWith(TEAM_PREFIX)).map((a) => a.slice(TEAM_PREFIX.length)).filter(isId))];
    if (!ids.length) return [];
    return (await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
        data: [{ _id: { $in: ids.map(oid) } }, { name: 1, assigneeUsersArray: 1 }],
    }, 'find')) || [];
};

const throughList = (assignees, teams, uid, roleType) => {
    const list = (assignees || []).map(String);
    const guest = roleType === ROLE_GUEST;
    if (list.includes(uid)) return { reason: guest ? 'guest' : 'member' };
    const via = teams.filter((team) => list.includes(`${TEAM_PREFIX}${team._id}`) && (team.assigneeUsersArray || []).map(String).includes(uid));
    if (!via.length) return null;
    return guest ? { reason: 'guest' } : { reason: 'team', teamNames: via.map((team) => team.name).filter(Boolean) };
};

/* Only called for someone the read check already let in, so on a private space the one way in left is the role. */
const projectReason = (project, teams, uid, roleType) => {
    if (project.isPersonal === true) return { reason: 'personal' };
    if (isPrivileged(roleType)) return { reason: 'admin' };
    if (project.isPrivateSpace !== true) return { reason: 'everyone' };
    return throughList(project.AssigneeUserId, teams, uid, roleType) || { reason: 'role' };
};

const levelIn = async (companyId, uid, projectId, manage, edit) => {
    if ((await canEditProject(companyId, uid, projectId, manage)).allowed) return 'manage';
    if ((await canEditProject(companyId, uid, projectId, edit)).allowed) return 'edit';
    return 'view';
};

const liveLinks = async (companyId, kind, ownId, parentIds = []) => {
    const shares = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PUBLIC_SHARES,
        data: [{ entityType: kind, entityId: { $in: [ownId, ...parentIds].map(oid) } }],
    }, 'find');
    const links = [];
    for (const share of shares || []) {
        if (await shareIsLive(companyId, share)) {
            links.push({
                kind,
                fromParent: String(share.entityId) !== String(ownId),
                hasPassword: Boolean(share.passwordHash),
                expiresAt: share.expiresAt || null,
            });
        }
    }
    return links;
};

/* The docs above this one that a public link on them would also reach: the walk stops where the renderer's would. */
const sharingAncestors = async (companyId, page) => {
    const ids = [];
    const seen = new Set([String(page._id)]);
    let parentId = page.parentPageId;
    while (isId(parentId) && !seen.has(String(parentId)) && ids.length < SHARED_TREE_MAX_DEPTH) {
        seen.add(String(parentId));
        const parent = await findOne(companyId, SCHEMA_TYPE.PAGES, { _id: oid(parentId), deletedStatusKey: 0 });
        if (!parent || String(parent.visibility || '') === 'private') break;
        ids.push(String(parent._id));
        parentId = parent.parentPageId;
    }
    return ids;
};

const projectSubject = async (companyId, id) => {
    const project = await findOne(companyId, SCHEMA_TYPE.PROJECTS, { _id: oid(id) });
    if (!project) return null;
    const projectId = String(project._id);
    const teams = await teamsIn(companyId, project.AssigneeUserId);
    return {
        title: project.ProjectName || '',
        canRead: async (uid) => (await canReadProject(companyId, uid, projectId)).allowed === true,
        level: (uid) => levelIn(companyId, uid, projectId, [DETAILS], [TASK_CREATE]),
        reason: (uid, roleType) => projectReason(project, teams, uid, roleType),
        links: () => liveLinks(companyId, 'client_view', projectId),
    };
};

/* Chat channels share the sprint collection but live in no project, so they have no explainer. */
const sprintSubject = async (companyId, id) => {
    const sprint = await findOne(companyId, SCHEMA_TYPE.SPRINTS, { _id: oid(id) });
    if (!sprint || !isId(sprint.projectId)) return null;
    const project = await findOne(companyId, SCHEMA_TYPE.PROJECTS, { _id: oid(sprint.projectId) });
    if (!project) return null;
    const projectId = String(project._id);
    const teams = await teamsIn(companyId, [...(project.AssigneeUserId || []), ...(sprint.AssigneeUserId || [])]);
    return {
        title: sprint.name || '',
        canRead: async (uid, roleType) => (await canReadProject(companyId, uid, projectId)).allowed === true
            && (isPrivileged(roleType) || canSeeSprint(sprint, await sprintIdentities(companyId, uid))),
        level: (uid) => levelIn(companyId, uid, projectId, [SPRINT_MANAGE], [TASK_CREATE]),
        reason: (uid, roleType) => {
            if (sprint.private !== true) return projectReason(project, teams, uid, roleType);
            if (isPrivileged(roleType)) return { reason: 'admin' };
            const shared = throughList(sprint.AssigneeUserId, teams, uid, roleType);
            return shared ? { ...shared, reason: SPRINT_REASONS[shared.reason] } : projectReason(project, teams, uid, roleType);
        },
        links: () => liveLinks(companyId, 'sprint', String(sprint._id)),
    };
};

/* Who a doc is shared with by name is shown to the people who manage that list, and to each named person
 * about themselves; every other reader sees the rest of the answer. */
const pageSubject = async (companyId, id, caller) => {
    const page = await findOne(companyId, SCHEMA_TYPE.PAGES, { _id: oid(id), deletedStatusKey: 0 });
    if (!page) return null;
    const isPrivate = String(page.visibility || '') === 'private';
    const project = isId(page.ProjectID) ? await findOne(companyId, SCHEMA_TYPE.PROJECTS, { _id: oid(page.ProjectID) }) : null;
    const teams = project ? await teamsIn(companyId, project.AssigneeUserId) : [];
    const seesNamed = await canManageShares(companyId, page, caller);
    const namedOnly = async (uid) => Boolean(shareFor(page, uid)) && !(await canUsePage(companyId, page, uid, { named: false }));
    return {
        title: page.title || '',
        canRead: async (uid) => (await canUsePage(companyId, page, uid)) && (uid === caller || seesNamed || !(await namedOnly(uid))),
        level: async (uid) => ((await canUsePage(companyId, page, uid, { edit: true })) ? 'edit' : 'view'),
        reason: async (uid, roleType) => {
            if (await namedOnly(uid)) return { reason: 'named' };
            if (isPrivate) return { reason: 'author' };
            return project ? projectReason(project, teams, uid, roleType) : { reason: 'everyone' };
        },
        links: async () => (isPrivate ? [] : liveLinks(companyId, 'page', String(page._id), await sharingAncestors(companyId, page))),
    };
};

const SUBJECTS = { project: projectSubject, sprint: sprintSubject, page: pageSubject };

const groupsOf = (entries) => {
    const groups = new Map();
    entries.forEach(({ uid, can, reason, teamNames = [] }) => {
        const key = `${reason}:${can}`;
        if (!groups.has(key)) groups.set(key, { reason, can, userIds: [], teamNames: [] });
        const group = groups.get(key);
        group.userIds.push(uid);
        teamNames.forEach((name) => { if (!group.teamNames.includes(name)) group.teamNames.push(name); });
    });
    return [...groups.values()].sort((a, b) => (REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason))
        || (LEVELS.indexOf(b.can) - LEVELS.indexOf(a.can)));
};

/*
 * Who in the company can read the item, why, and what they can do. Every person is put through
 * the same read and write checks the API enforces, so the answer cannot drift from enforcement;
 * only the grouping into reasons is worked out here. Null when the caller cannot read the item.
 */
const explain = async (kind, companyId, itemId, callerUid) => {
    const subjectOf = SUBJECTS[kind];
    const company = String(companyId || '');
    const caller = String(callerUid || '');
    if (!subjectOf || !isId(company) || !isId(itemId) || !isId(caller)) return null;

    const members = await activeMembers(company);
    if (!members.has(caller)) return null;
    const subject = await subjectOf(company, String(itemId), caller);
    if (!subject || !(await subject.canRead(caller, members.get(caller)))) return null;

    const entries = await mapLimit([...members], CONCURRENCY, async ([uid, roleType]) => {
        if (uid !== caller && !(await subject.canRead(uid, roleType))) return null;
        return { uid, can: await subject.level(uid), ...(await subject.reason(uid, roleType)) };
    });
    return {
        kind,
        id: String(itemId),
        title: subject.title,
        groups: groupsOf(entries.filter(Boolean)),
        links: await subject.links(),
    };
};

module.exports = { KINDS, explain };
