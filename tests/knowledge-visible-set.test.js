const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const { resolveVisibleSet, RetrievalRefused } = require('../Modules/Knowledge/visibleSet');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000011';
const ADMIN = '6f0000000000000000000012';
const MEMBER = '6f0000000000000000000013';
const COLLEAGUE = '6f0000000000000000000014';
const STRANGER = '6f0000000000000000000015';
const SHARED = '6f0000000000000000000a01';
const SECRET = '6f0000000000000000000a02';
const OPEN_SPRINT = '6f0000000000000000000d01';
const PRIVATE_SPRINT = '6f0000000000000000000d02';

const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [COLLEAGUE]: 3, [STRANGER]: null };
const PROJECTS = { [OWNER]: [SHARED, SECRET], [ADMIN]: [SHARED, SECRET], [MEMBER]: [SHARED], [COLLEAGUE]: [SHARED], [STRANGER]: [SHARED] };

const seed = (type, doc) => String(mockDb.seed(type, { updatedAt: new Date('2026-09-01T00:00:00Z'), ...doc })._id);

const ask = (userId, over = {}) => retrieve({ companyId: C, caller: { kind: 'user', userId }, query: 'budget', ...over });
const idsOf = (result, sourceType) => result.passages.filter((p) => p.sourceType === sourceType).map((p) => p.sourceId).sort();

let rows;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
    getRoleType.mockImplementation(async (companyId, uid) => ROLES[uid]);
    visibleProjectIds.mockImplementation(async (companyId, uid) => PROJECTS[uid] || []);

    seed(SCHEMA_TYPE.SPRINTS, { _id: OPEN_SPRINT, projectId: SHARED, private: false, AssigneeUserId: [] });
    seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: SHARED, private: true, AssigneeUserId: [OWNER, COLLEAGUE] });

    rows = {
        privatePage: seed(SCHEMA_TYPE.PAGES, { title: 'Roadmap draft', rawText: 'the budget we have not announced', ProjectID: SHARED, visibility: 'private', createdBy: OWNER, deletedStatusKey: 0 }),
        projectPage: seed(SCHEMA_TYPE.PAGES, { title: 'Budget wiki', rawText: '', ProjectID: SHARED, visibility: 'project', createdBy: COLLEAGUE, deletedStatusKey: 0 }),
        companyPage: seed(SCHEMA_TYPE.PAGES, { title: 'Travel policy', rawText: 'the travel budget for everyone', visibility: 'project', createdBy: ADMIN, deletedStatusKey: 0 }),
        secretPage: seed(SCHEMA_TYPE.PAGES, { title: 'Budget of the secret project', ProjectID: SECRET, visibility: 'project', createdBy: OWNER, deletedStatusKey: 0 }),
        deletedPage: seed(SCHEMA_TYPE.PAGES, { title: 'Budget archive', ProjectID: SHARED, visibility: 'project', createdBy: OWNER, deletedStatusKey: 1 }),
        openTask: seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget review', TaskKey: 'SH-1', ProjectID: SHARED, sprintId: OPEN_SPRINT, deletedStatusKey: 0 }),
        sprintTask: seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget cuts', TaskKey: 'SH-2', ProjectID: SHARED, sprintId: PRIVATE_SPRINT, deletedStatusKey: 0 }),
        deletedTask: seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget leftovers', TaskKey: 'SH-3', ProjectID: SHARED, sprintId: OPEN_SPRINT, deletedStatusKey: 1 }),
        secretTask: seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget of the secret project', TaskKey: 'SE-1', ProjectID: SECRET, sprintId: OPEN_SPRINT, deletedStatusKey: 0 }),
    };
    rows.openComment = seed(SCHEMA_TYPE.COMMENTS, { message: 'budget looks fine', type: 'text', projectId: SHARED, sprintId: OPEN_SPRINT, taskId: rows.openTask, userId: COLLEAGUE });
    rows.sprintComment = seed(SCHEMA_TYPE.COMMENTS, { message: 'budget cut by half', type: 'text', projectId: SHARED, sprintId: PRIVATE_SPRINT, taskId: rows.sprintTask, userId: OWNER });
    rows.memberCall = seed(SCHEMA_TYPE.CALLS, { callId: 'call-1', title: 'Weekly', transcript: 'we went over the budget', participants: [OWNER, MEMBER], deletedStatusKey: 0 });
    rows.colleagueCall = seed(SCHEMA_TYPE.CALLS, { callId: 'call-2', title: 'One to one', transcript: 'my budget worries', participants: [COLLEAGUE], deletedStatusKey: 0 });
});

describe('a private page belongs to its author alone', () => {
    it('is returned to the owner who wrote it', async () => {
        expect(idsOf(await ask(OWNER), 'page')).toContain(rows.privatePage);
    });

    it('is not returned to a colleague in the same project, nor to an admin', async () => {
        expect(idsOf(await ask(COLLEAGUE), 'page')).not.toContain(rows.privatePage);
        expect(idsOf(await ask(ADMIN), 'page')).not.toContain(rows.privatePage);
    });

    it('carries the permission it was returned under', async () => {
        const passage = (await ask(OWNER)).passages.find((p) => p.sourceId === rows.privatePage);
        expect(passage.permission).toEqual({ visibility: 'private', via: 'owner' });
    });
});

describe('a task in a private sprint', () => {
    it('is left out for a member the sprint is not shared with', async () => {
        expect(idsOf(await ask(MEMBER), 'task')).toEqual([rows.openTask]);
    });

    it('is returned to a member the sprint is shared with, and to an admin', async () => {
        expect(idsOf(await ask(COLLEAGUE), 'task')).toEqual([rows.openTask, rows.sprintTask].sort());
        expect(idsOf(await ask(ADMIN), 'task')).toEqual([rows.openTask, rows.sprintTask, rows.secretTask].sort());
    });

    it('takes its comments with it', async () => {
        expect(idsOf(await ask(MEMBER), 'comment')).toEqual([rows.openComment]);
        expect(idsOf(await ask(COLLEAGUE), 'comment')).toEqual([rows.openComment, rows.sprintComment].sort());
    });
});

describe('a comment is visible only where its task is', () => {
    const comment = (over) => seed(SCHEMA_TYPE.COMMENTS, { message: 'budget follow-up', type: 'text', projectId: SHARED, sprintId: OPEN_SPRINT, userId: OWNER, ...over });

    it('is left out when its task is deleted, though the comment itself is live', async () => {
        const onDeletedTask = comment({ taskId: rows.deletedTask });
        expect(idsOf(await ask(OWNER), 'comment')).not.toContain(onDeletedTask);
    });

    it('is left out when its task is in a private sprint the caller is not on, though the comment names an open sprint', async () => {
        const onSprintTask = comment({ taskId: rows.sprintTask });
        expect(idsOf(await ask(MEMBER), 'comment')).not.toContain(onSprintTask);
        expect(idsOf(await ask(COLLEAGUE), 'comment')).toContain(onSprintTask);
    });

    it('is left out when its task is in a project the caller cannot open, though the comment names one they can', async () => {
        const onSecretTask = comment({ taskId: rows.secretTask });
        expect(idsOf(await ask(MEMBER), 'comment')).not.toContain(onSecretTask);
        expect(idsOf(await ask(ADMIN), 'comment')).toContain(onSecretTask);
    });

    it('is left out once deleted', async () => {
        const deleted = comment({ taskId: rows.openTask, isDeleted: true });
        expect(idsOf(await ask(OWNER), 'comment')).not.toContain(deleted);
    });
});

describe('every read stays in the caller\'s company', () => {
    it('searches, rechecks and follows comments to their tasks only in the company asked about', async () => {
        await ask(COLLEAGUE);
        const byId = (type) => mockDb.calls.filter((c) => c.type === type && c.data[0] && c.data[0]._id);
        expect(byId(SCHEMA_TYPE.COMMENTS).length).toBeGreaterThan(0);
        expect(byId(SCHEMA_TYPE.TASKS).length).toBeGreaterThanOrEqual(2);
        expect(byId(SCHEMA_TYPE.PAGES).length).toBeGreaterThan(0);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect([...new Set(mockDb.calls.map((c) => String(c.companyId)))]).toEqual([C]);
    });
});

describe('what everyone in the company can see', () => {
    it('includes a company-wide page that has no project', async () => {
        const result = await ask(MEMBER);
        expect(idsOf(result, 'page')).toEqual([rows.projectPage, rows.companyPage].sort());
        expect(result.passages.find((p) => p.sourceId === rows.companyPage).permission).toEqual({ visibility: 'company', via: 'company' });
    });

    it('never includes a deleted row or a project the caller cannot open', async () => {
        const result = await ask(MEMBER);
        const all = result.passages.map((p) => p.sourceId);
        [rows.deletedPage, rows.deletedTask, rows.secretPage, rows.secretTask].forEach((id) => expect(all).not.toContain(id));
    });

    it('returns a transcript only to the people who were on the call', async () => {
        expect(idsOf(await ask(MEMBER), 'transcript')).toEqual([rows.memberCall]);
        expect(idsOf(await ask(ADMIN), 'transcript')).toEqual([]);
    });

    it('never returns a deleted call transcript, even to someone who was on the call', async () => {
        const deletedCall = seed(SCHEMA_TYPE.CALLS, { callId: 'call-3', title: 'Old', transcript: 'the budget we dropped', participants: [MEMBER], deletedStatusKey: 1 });
        expect(idsOf(await ask(MEMBER), 'transcript')).not.toContain(deletedCall);
    });
});

describe('the caller', () => {
    it('is refused when they hold no role in the company', async () => {
        await expect(ask(STRANGER)).rejects.toBeInstanceOf(RetrievalRefused);
        expect(mockDb.calls.filter((c) => [SCHEMA_TYPE.TASKS, SCHEMA_TYPE.PAGES, SCHEMA_TYPE.COMMENTS, SCHEMA_TYPE.CALLS].includes(c.type))).toEqual([]);
    });

    it('is refused when an agent or MCP caller names no user, or an unknown kind', async () => {
        await expect(resolveVisibleSet({ companyId: C, caller: { kind: 'agent', agentId: 'a1' } })).rejects.toBeInstanceOf(RetrievalRefused);
        await expect(resolveVisibleSet({ companyId: C, caller: { kind: 'robot', userId: MEMBER } })).rejects.toBeInstanceOf(RetrievalRefused);
    });

    it('is resolved on every call rather than remembered from the last one', async () => {
        expect((await ask(MEMBER)).passages.length).toBeGreaterThan(0);
        ROLES[MEMBER] = null;
        try {
            await expect(ask(MEMBER)).rejects.toBeInstanceOf(RetrievalRefused);
        } finally {
            ROLES[MEMBER] = 3;
        }
    });

    it('never gains a project by naming one in the scope', async () => {
        const result = await ask(MEMBER, { scope: { projectId: SECRET } });
        expect(result.passages).toEqual([]);
        expect(result.scope).toMatchObject({ projectId: SECRET, projects: 0 });
    });
});
