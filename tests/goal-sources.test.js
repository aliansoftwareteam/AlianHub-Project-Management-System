/* Task 046 M3: which lists and tasks a goal may count. One number is shown to every reader of a
   goal, so it is built only from what every one of them can open. The route handlers run over
   fakeMongo with the real project scope, personal-list rule and sprint privacy. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const goals = require('../Modules/Goals/controller');
const counts = require('../Modules/Goals/goalCounts');
const sources = require('../Modules/Goals/goalSources');
const publicSources = require('../Modules/AI/publicSources');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const AUTHOR = '6f0000000000000000000003';
const NAMED = '6f0000000000000000000004';
const COLLEAGUE = '6f0000000000000000000005';
const GUEST = '6f0000000000000000000006';
const DEACTIVATED = '6f0000000000000000000008';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [AUTHOR]: 3, [NAMED]: 3, [COLLEAGUE]: 3, [GUEST]: 0 };
const MISSING = '6f00000000000000000000ff';
const PROJECT = '6f0000000000000000000a99';

let seq = 0;
const nextId = (prefix) => `6f${prefix}${String(++seq).padStart(20, '0')}`;

const project = (over = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: nextId('a0'), ProjectName: 'Project', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...over });
const list = (proj, over = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: nextId('b0'), projectId: String(proj._id), name: 'List', private: false, AssigneeUserId: [], deletedStatusKey: 0, ...over })._id);
const task = (proj, sprintId, over = {}) => String(mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: nextId('f0'), TaskName: 'Task', ProjectID: String(proj._id), sprintId, deletedStatusKey: 0, isParentTask: true, statusType: 'default_active', ...over,
})._id);
const done = { statusType: 'close' };
const sprintRow = (id) => mockDb.store[SCHEMA_TYPE.SPRINTS].find((row) => String(row._id) === id);

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const call = async (handler, uid, { body, id, targetId, query, apiToken } = {}) => {
    const res = response();
    await handler({ headers: { companyid: C }, aud: C, uid, body, query: query || {}, params: { id, targetId }, apiToken }, res);
    return res;
};
const stored = () => mockDb.store[SCHEMA_TYPE.GOALS] || [];
const goalRow = (id) => stored().find((row) => String(row._id) === id);

/* A goal made through the handler, so it is its maker's and passes every rule a real one does. */
const goal = async (uid, body = {}) => (await call(goals.createGoal, uid, { body: { name: 'Ship it', ...body } })).body.data._id;
const link = (uid, id, linked) => call(goals.addTarget, uid, { id, body: { name: 'Tasks done', kind: 'tasks', sources: linked } });
const refusalOf = (res) => ({ statusCode: res.statusCode, field: res.body.field, code: res.body.code });
const ACCEPTED = { statusCode: 200, field: undefined, code: undefined };
const notFound = (field) => ({ statusCode: 400, field, code: 'source_not_found' });
const notShared = (field) => ({ statusCode: 400, field, code: 'source_not_shared' });
const LIST = 'sources.sprintIds.0';
const TASK = 'sources.taskIds.0';

let world;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
    jest.clearAllMocks();
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: DEACTIVATED, roleType: 3, status: 2, isDelete: true });

    const open = project({ ProjectName: 'Open' });
    const team = project({ ProjectName: 'Private, author and named on it', isPrivateSpace: true, AssigneeUserId: [AUTHOR, NAMED] });
    const solo = project({ ProjectName: 'Private, author alone', isPrivateSpace: true, AssigneeUserId: [AUTHOR] });
    const personal = project({ ProjectName: 'Personal list of the author', isPrivateSpace: true, isPersonal: true, personalOwner: AUTHOR, AssigneeUserId: [AUTHOR] });
    const adminPersonal = project({ ProjectName: 'Personal list of the admin', isPrivateSpace: true, isPersonal: true, personalOwner: ADMIN, AssigneeUserId: [ADMIN] });
    const chatSpace = mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: nextId('c0'), default: false });

    const openList = list(open);
    const secondOpenList = list(open, { name: 'Second' });
    const privateList = list(open, { name: 'Private list, author on it', private: true, AssigneeUserId: [AUTHOR] });
    const teamList = list(team);
    const soloList = list(solo);
    const personalList = list(personal);
    const adminPersonalList = list(adminPersonal);
    const channel = list(chatSpace, { name: 'general' });
    const trashedList = list(open, { name: 'Trashed', deletedStatusKey: 1 });

    world = {
        open, team, solo, personal,
        openList, secondOpenList, privateList, teamList, soloList, personalList, adminPersonalList, channel, trashedList,
        openTask: task(open, openList, done),
        privateListTask: task(open, privateList),
        teamTask: task(team, teamList),
        soloTask: task(solo, soloList),
        personalTask: task(personal, personalList),
        chatRow: task(chatSpace, channel, { mainChat: true, AssigneeUserId: [AUTHOR] }),
    };
    task(open, openList);
    task(open, secondOpenList, done);
});

describe('linking a source', () => {
    it('counts it at once and keeps what was linked', async () => {
        const id = await goal(AUTHOR);
        const res = await link(AUTHOR, id, { sprintIds: [world.openList], taskIds: [world.teamTask] });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.targets[0]).toMatchObject({
            kind: 'tasks', progressPct: 33, sources: { sprintIds: [world.openList], taskIds: [world.teamTask] },
            counted: { done: 1, total: 3, at: expect.any(Date) }, notCounted: 0, notCountedSources: { sprintIds: [], taskIds: [] }, dirty: false, updating: false,
        });
        expect(res.body.data.progressPct).toBe(33);
        expect(goalRow(id).targets[0]).toMatchObject({ sources: { sprintIds: [world.openList], taskIds: [world.teamTask] }, counted: { done: 1, total: 3 }, dirty: false });
    });

    it('may be left for later: a target with nothing linked has counted nothing', async () => {
        const id = await goal(AUTHOR);
        const res = await call(goals.addTarget, AUTHOR, { id, body: { name: 'Tasks done', kind: 'tasks' } });
        expect(res.body.data.targets[0]).toMatchObject({ sources: { sprintIds: [], taskIds: [] }, counted: { done: 0, total: 0 }, progressPct: 0 });
    });

    it('is checked on a goal made with its targets, before anything is stored', async () => {
        const made = await call(goals.createGoal, AUTHOR, { body: { name: 'Q4', visibility: 'workspace', targets: [{ name: 'Open work', kind: 'tasks', sources: { sprintIds: [world.openList] } }] } });
        expect(made.body.data.targets[0]).toMatchObject({ counted: { done: 1, total: 2 }, progressPct: 50 });

        const refused = await call(goals.createGoal, AUTHOR, { body: { name: 'Q4', visibility: 'workspace', targets: [{ name: 'Flag', kind: 'boolean' }, { name: 'Team work', kind: 'tasks', sources: { sprintIds: [world.teamList] } }] } });
        expect(refusalOf(refused)).toEqual(notShared('targets.1.sources.sprintIds.0'));
        expect(stored()).toHaveLength(1);
    });

    it('is checked again when a target\'s sources are replaced, and only then is it counted again', async () => {
        const id = await goal(AUTHOR, { visibility: 'workspace' });
        const targetId = (await link(AUTHOR, id, { sprintIds: [world.openList] })).body.data.targets[0].id;
        const refused = await call(goals.editTarget, AUTHOR, { id, targetId, body: { sources: { sprintIds: [world.openList, world.teamList] } } });
        expect(refusalOf(refused)).toEqual(notShared('sources.sprintIds.1'));
        expect(goalRow(id).targets[0].sources.sprintIds).toEqual([world.openList]);

        task(world.open, world.openList);
        const renamed = await call(goals.editTarget, AUTHOR, { id, targetId, body: { name: 'Open work' } });
        expect(renamed.body.data.targets[0]).toMatchObject({ name: 'Open work', counted: { done: 1, total: 2 } });
        const relinked = await call(goals.editTarget, AUTHOR, { id, targetId, body: { sources: { sprintIds: [world.openList, world.secondOpenList] } } });
        expect(relinked.body.data.targets[0]).toMatchObject({ sources: { sprintIds: [world.openList, world.secondOpenList], taskIds: [] }, counted: { done: 2, total: 4 } });
    });

    it('has no value to set by hand', async () => {
        const id = await goal(AUTHOR);
        const targetId = (await link(AUTHOR, id, { sprintIds: [world.openList] })).body.data.targets[0].id;
        for (const body of [{ current: 9 }, { done: true }, {}]) {
            const res = await call(goals.setTargetValue, AUTHOR, { id, targetId, body });
            expect(refusalOf(res)).toEqual({ statusCode: 400, field: 'current', code: 'counted_from_tasks' });
        }
        expect(goalRow(id).targets[0].counted).toMatchObject({ done: 1, total: 2 });
    });

    it('cannot bring its own numbers', async () => {
        const id = await goal(AUTHOR);
        for (const extra of [{ counted: { done: 9, total: 9 } }, { dirty: false }, { current: 9 }, { sources: { sprintIds: [world.openList], projectIds: [String(world.solo._id)] } }, { sources: { sprintIds: world.openList } }]) {
            const res = await call(goals.addTarget, AUTHOR, { id, body: { name: 'T', kind: 'tasks', sources: { sprintIds: [world.openList] }, ...extra } });
            expect(res.statusCode).toBe(400);
        }
        expect(goalRow(id).targets).toEqual([]);
    });
});

describe('a source the person linking it cannot open', () => {
    const CASES = [
        ['a list in a private project they are not on', COLLEAGUE, () => ({ sprintIds: [world.soloList] }), LIST],
        ['a task in a private project they are not on', COLLEAGUE, () => ({ taskIds: [world.soloTask] }), TASK],
        ['a private list they are not on', COLLEAGUE, () => ({ sprintIds: [world.privateList] }), LIST],
        ['a task in a private list they are not on', COLLEAGUE, () => ({ taskIds: [world.privateListTask] }), TASK],
        ['someone else\'s personal list, for a member', COLLEAGUE, () => ({ sprintIds: [world.personalList] }), LIST],
        ['someone else\'s personal list, for an admin', ADMIN, () => ({ sprintIds: [world.personalList] }), LIST],
        ['someone else\'s personal list, for the workspace owner', OWNER, () => ({ sprintIds: [world.personalList] }), LIST],
        ['a task in someone else\'s personal list, for the workspace owner', OWNER, () => ({ taskIds: [world.personalTask] }), TASK],
        ['a chat channel', AUTHOR, () => ({ sprintIds: [world.channel] }), LIST],
        ['a chat channel, for the workspace owner', OWNER, () => ({ sprintIds: [world.channel] }), LIST],
        ['a row of a chat they are in', AUTHOR, () => ({ taskIds: [world.chatRow] }), TASK],
        ['a list in the trash', AUTHOR, () => ({ sprintIds: [world.trashedList] }), LIST],
    ];

    it.each(CASES)('is refused as one that does not exist: %s', async (_case, uid, linked, field) => {
        const id = await goal(uid);
        const refused = await link(uid, id, linked());
        const missing = await link(uid, id, field === LIST ? { sprintIds: [MISSING] } : { taskIds: [MISSING] });
        expect(refusalOf(refused)).toEqual(notFound(field));
        expect(refused.body).toEqual(missing.body);
        expect(refused.body.sources).toBeUndefined();
        expect(goalRow(id).targets).toEqual([]);
    });

    it.each([
        ['a private project they are on', AUTHOR, () => ({ sprintIds: [world.soloList], taskIds: [world.soloTask] })],
        ['a private list they are on', AUTHOR, () => ({ sprintIds: [world.privateList], taskIds: [world.privateListTask] })],
        ['their own personal list', AUTHOR, () => ({ sprintIds: [world.personalList], taskIds: [world.personalTask] })],
        ['a private project, as the workspace owner', OWNER, () => ({ sprintIds: [world.soloList] })],
        ['a private project, as an admin', ADMIN, () => ({ taskIds: [world.soloTask] })],
        ['a private list they are not on, as an admin, who reads past it', ADMIN, () => ({ sprintIds: [world.privateList] })],
        ['their own personal list, as an admin', ADMIN, () => ({ sprintIds: [world.adminPersonalList] })],
    ])('is linked on their own private goal when it is %s', async (_case, uid, linked) => {
        const id = await goal(uid);
        expect(refusalOf(await link(uid, id, linked()))).toEqual(ACCEPTED);
    });

    it('names the first one it finds, by its place in the request', async () => {
        const id = await goal(COLLEAGUE);
        expect(refusalOf(await link(COLLEAGUE, id, { sprintIds: [world.openList, world.soloList] }))).toEqual(notFound('sources.sprintIds.1'));
        expect(refusalOf(await link(COLLEAGUE, id, { sprintIds: [world.openList], taskIds: [world.openTask, world.soloTask] }))).toEqual(notFound('sources.taskIds.1'));
    });

    it('cannot be linked through a token limited to some projects, which reaches no goal', async () => {
        const id = await goal(AUTHOR);
        mockDb.calls.length = 0;
        const res = await call(goals.addTarget, AUTHOR, { id, body: { name: 'T', kind: 'tasks', sources: { sprintIds: [world.openList] } }, apiToken: { userId: AUTHOR, projectIds: [PROJECT] } });
        expect(res.statusCode).toBe(403);
        expect(mockDb.calls).toEqual([]);
    });
});

describe('a source not every reader of the goal can open', () => {
    const onGoal = async (body, linked, uid = AUTHOR) => refusalOf(await link(uid, await goal(AUTHOR, body), linked));

    describe('on a goal shared with people', () => {
        const shared = (sharedWith) => ({ visibility: 'people', sharedWith });

        it('is accepted when it sits in a project all of them can open', async () => {
            expect(await onGoal(shared([NAMED]), { sprintIds: [world.openList, world.teamList], taskIds: [world.openTask, world.teamTask] })).toEqual(ACCEPTED);
            expect(await onGoal(shared([OWNER]), { sprintIds: [world.soloList] })).toEqual(ACCEPTED);
            expect(await onGoal(shared([GUEST]), { sprintIds: [world.openList] })).toEqual(ACCEPTED);
        });

        it.each([
            ['a member who is not on the project', () => [COLLEAGUE]],
            ['a guest who is not on the project', () => [NAMED, GUEST]],
        ])('is refused when one of them is %s', async (_who, sharedWith) => {
            expect(await onGoal(shared(sharedWith()), { sprintIds: [world.teamList] })).toEqual(notShared(LIST));
            expect(await onGoal(shared(sharedWith()), { taskIds: [world.teamTask] })).toEqual(notShared(TASK));
        });

        it('is refused when it is a private list, though every one of them is on it or reads past it', async () => {
            sprintRow(world.privateList).AssigneeUserId = [AUTHOR, NAMED];
            expect(await onGoal(shared([NAMED]), { sprintIds: [world.privateList] })).toEqual(notShared(LIST));
            expect(await onGoal(shared([OWNER]), { taskIds: [world.privateListTask] })).toEqual(notShared(TASK));
            expect(await onGoal(shared([]), { sprintIds: [world.privateList] })).toEqual(notShared(LIST));
        });

        it('is refused when it is the owner\'s personal list, shared with nobody yet or not', async () => {
            expect(await onGoal(shared([]), { sprintIds: [world.personalList] })).toEqual(notShared(LIST));
            expect(await onGoal(shared([NAMED]), { taskIds: [world.personalTask] })).toEqual(notShared(TASK));
        });

        it('says which sources, to the person who could open them, and stores nothing', async () => {
            const id = await goal(AUTHOR, shared([COLLEAGUE]));
            const res = await link(AUTHOR, id, { sprintIds: [world.openList, world.teamList], taskIds: [world.soloTask] });
            expect(res.body).toMatchObject({ status: false, field: 'sources.sprintIds.1', code: 'source_not_shared', sources: { sprintIds: [world.teamList], taskIds: [world.soloTask] } });
            expect(goalRow(id).targets).toEqual([]);
        });

        it('does not hold a deactivated seat against the others', async () => {
            const id = await goal(AUTHOR, shared([NAMED]));
            goalRow(id).sharedWith.push(DEACTIVATED);
            expect(refusalOf(await link(AUTHOR, id, { sprintIds: [world.teamList] }))).toEqual(ACCEPTED);
        });

        it('is held to the workspace rule past the cap on readers', async () => {
            expect(sources.READER_CAP).toBe(publicSources.READER_CAP);
            const crowd = Array.from({ length: sources.READER_CAP }, (_, n) => `6f00000000000000000e${String(n).padStart(4, '0')}`);
            crowd.forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false }));
            world.team.AssigneeUserId = [AUTHOR, ...crowd];

            const atCap = await goal(AUTHOR, shared(crowd.slice(1)));
            expect(refusalOf(await link(AUTHOR, atCap, { sprintIds: [world.teamList] }))).toEqual(ACCEPTED);
            const pastCap = await goal(AUTHOR, shared(crowd));
            expect(refusalOf(await link(AUTHOR, pastCap, { sprintIds: [world.teamList] }))).toEqual(notShared(LIST));
            expect(refusalOf(await link(AUTHOR, pastCap, { sprintIds: [world.openList] }))).toEqual(ACCEPTED);
        });
    });

    describe('on a workspace goal', () => {
        const WORKSPACE = { visibility: 'workspace' };

        it('is accepted when it sits in a public project, outside a private list', async () => {
            expect(await onGoal(WORKSPACE, { sprintIds: [world.openList, world.secondOpenList], taskIds: [world.openTask] })).toEqual(ACCEPTED);
        });

        it.each([
            ['a list in a private project', () => ({ sprintIds: [world.teamList] }), LIST],
            ['a task in a private project', () => ({ taskIds: [world.teamTask] }), TASK],
            ['a private list of a public project', () => ({ sprintIds: [world.privateList] }), LIST],
            ['a task in a private list of a public project', () => ({ taskIds: [world.privateListTask] }), TASK],
            ['the owner\'s personal list', () => ({ sprintIds: [world.personalList] }), LIST],
        ])('is refused when it is %s', async (_case, linked, field) => {
            expect(await onGoal(WORKSPACE, linked())).toEqual(notShared(field));
        });

        it.each([['the workspace owner', OWNER], ['an admin', ADMIN]])('is refused to %s too, who can open it and may change the goal', async (_who, uid) => {
            expect(await onGoal(WORKSPACE, { sprintIds: [world.teamList] }, uid)).toEqual(notShared(LIST));
            expect(await onGoal(WORKSPACE, { sprintIds: [world.privateList] }, uid)).toEqual(notShared(LIST));
            expect(await onGoal(WORKSPACE, { sprintIds: [world.openList] }, uid)).toEqual(ACCEPTED);
        });

        it('is refused as missing to an admin linking someone else\'s personal list', async () => {
            expect(await onGoal(WORKSPACE, { sprintIds: [world.personalList] }, ADMIN)).toEqual(notFound(LIST));
            expect(await onGoal(WORKSPACE, { sprintIds: [world.adminPersonalList] }, ADMIN)).toEqual(notShared(LIST));
        });
    });
});

describe('changing who reads a goal that counts tasks', () => {
    const linkedGoal = async (body, linked) => {
        const id = await goal(AUTHOR, body);
        expect((await link(AUTHOR, id, linked)).statusCode).toBe(200);
        return id;
    };
    const change = (id, body, uid = AUTHOR) => call(goals.updateGoal, uid, { id, body });

    it.each([
        ['sharing it with someone who is not on the project', { visibility: 'people', sharedWith: [COLLEAGUE] }, 'visibility'],
        ['opening it to the workspace', { visibility: 'workspace' }, 'visibility'],
        ['handing it to someone who is not on the project', { ownerUserId: COLLEAGUE }, 'ownerUserId'],
    ])('refuses %s, names the sources, and leaves the goal as it was', async (_case, body, field) => {
        const id = await linkedGoal({}, { sprintIds: [world.openList, world.soloList], taskIds: [world.soloTask] });
        const res = await change(id, body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, field, code: 'sources_would_drop', sources: { sprintIds: [world.soloList], taskIds: [world.soloTask] } });
        expect(goalRow(id)).toMatchObject({ visibility: 'private', sharedWith: [], ownerUserId: AUTHOR, revision: 1 });
    });

    it('refuses adding one more person who cannot open a source', async () => {
        const id = await linkedGoal({ visibility: 'people', sharedWith: [NAMED] }, { sprintIds: [world.teamList] });
        const res = await change(id, { sharedWith: [NAMED, COLLEAGUE] });
        expect(res.body).toMatchObject({ field: 'sharedWith', code: 'sources_would_drop', sources: { sprintIds: [world.teamList], taskIds: [] } });
        expect(goalRow(id).sharedWith).toEqual([NAMED]);
    });

    it('refuses sharing a goal that counts a private list or a personal list, with anyone', async () => {
        const id = await linkedGoal({}, { sprintIds: [world.privateList, world.personalList] });
        const res = await change(id, { visibility: 'people', sharedWith: [] });
        expect(res.body).toMatchObject({ code: 'sources_would_drop', sources: { sprintIds: [world.privateList, world.personalList] } });
    });

    it('allows it when every source stays open to every reader, and counts again for them', async () => {
        const id = await linkedGoal({}, { sprintIds: [world.openList, world.teamList] });
        task(world.team, world.teamList, done);
        const shared = await change(id, { visibility: 'people', sharedWith: [NAMED] });
        expect(shared.statusCode).toBe(200);
        expect(shared.body.data.targets[0]).toMatchObject({ counted: { done: 2, total: 4 }, notCounted: 0 });
        expect((await change(id, { sharedWith: [NAMED, OWNER] })).statusCode).toBe(200);
        expect((await change(id, { name: 'Renamed' })).statusCode).toBe(200);
    });

    it('allows making it narrower, which can only bring sources back', async () => {
        const id = await linkedGoal({ visibility: 'workspace' }, { sprintIds: [world.openList] });
        world.open.isPrivateSpace = true;
        world.open.AssigneeUserId = [AUTHOR];
        const res = await change(id, { visibility: 'private' });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.targets[0]).toMatchObject({ counted: { done: 1, total: 2 }, notCounted: 0 });
    });

    it('is not held back by a source that is already left out', async () => {
        const id = await linkedGoal({ visibility: 'people', sharedWith: [NAMED] }, { sprintIds: [world.openList, world.teamList] });
        world.team.AssigneeUserId = [AUTHOR];
        const res = await change(id, { visibility: 'workspace' });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.targets[0]).toMatchObject({ counted: { done: 1, total: 2 }, notCounted: 1, notCountedSources: { sprintIds: [world.teamList], taskIds: [] } });
    });

    it('is not asked of a goal that counts no tasks', async () => {
        const id = await goal(AUTHOR);
        await call(goals.addTarget, AUTHOR, { id, body: { name: 'Empty', kind: 'tasks' } });
        mockDb.calls.length = 0;
        expect((await change(id, { visibility: 'workspace' })).statusCode).toBe(200);
        expect(mockDb.calls.filter((c) => [SCHEMA_TYPE.TASKS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.PROJECTS].includes(c.type))).toEqual([]);
    });
});

describe('a source a reader can no longer open', () => {
    const TEN_MINUTES = counts.STALE_AFTER_MS;
    const recount = async (id) => {
        goalRow(id).targets.forEach((target) => { if (target.counted) target.counted.at = new Date(Date.now() - TEN_MINUTES); });
        return counts.refresh(C, id);
    };
    const read = async (uid, id) => (await call(goals.getGoal, uid, { id })).body.data.targets[0];

    it.each([
        ['its project became private', () => { world.open.isPrivateSpace = true; world.open.AssigneeUserId = [AUTHOR]; }],
        ['its list became private', () => { Object.assign(sprintRow(world.secondOpenList), { private: true, AssigneeUserId: [AUTHOR, ADMIN] }); }],
        ['its list went to the trash', () => { sprintRow(world.secondOpenList).deletedStatusKey = 1; }],
        ['its list is gone', () => { mockDb.store[SCHEMA_TYPE.SPRINTS] = mockDb.store[SCHEMA_TYPE.SPRINTS].filter((row) => String(row._id) !== world.secondOpenList); }],
    ])('is left out of the next count on a workspace goal, and said to be: %s', async (_case, happen) => {
        const other = project({ ProjectName: 'Other open' });
        const otherList = list(other);
        task(other, otherList, done);
        const id = await goal(AUTHOR, { visibility: 'workspace' });
        await link(AUTHOR, id, { sprintIds: [world.secondOpenList, otherList] });
        expect(await read(AUTHOR, id)).toMatchObject({ counted: { done: 2, total: 2 }, notCounted: 0 });

        happen();
        expect(await recount(id)).toBe(true);
        const forOwner = await read(AUTHOR, id);
        expect(forOwner).toMatchObject({ counted: { done: 1, total: 1 }, notCounted: 1, notCountedSources: { sprintIds: [world.secondOpenList], taskIds: [] } });
        expect(forOwner.sources.sprintIds).toEqual([world.secondOpenList, otherList]);
        const forAdmin = await read(ADMIN, id);
        expect(forAdmin.notCountedSources).toEqual({ sprintIds: [world.secondOpenList], taskIds: [] });
        const forReader = await read(COLLEAGUE, id);
        expect(forReader).toMatchObject({ counted: { done: 1, total: 1 }, notCounted: 1, sources: { sprintIds: [otherList], taskIds: [] } });
        expect(forReader.notCountedSources).toBeUndefined();
        expect(JSON.stringify(forReader)).not.toContain(world.secondOpenList);
    });

    it('is left out on a goal shared with people when one of them leaves the project, and comes back when they return', async () => {
        const id = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED] });
        await link(AUTHOR, id, { sprintIds: [world.openList], taskIds: [world.teamTask] });
        expect(await read(NAMED, id)).toMatchObject({ counted: { done: 1, total: 3 }, notCounted: 0 });

        world.team.AssigneeUserId = [AUTHOR];
        await recount(id);
        expect(await read(NAMED, id)).toMatchObject({ counted: { done: 1, total: 2 }, notCounted: 1, sources: { sprintIds: [world.openList], taskIds: [] } });
        expect(goalRow(id).targets[0].sources.taskIds).toEqual([world.teamTask]);

        world.team.AssigneeUserId = [AUTHOR, NAMED];
        await recount(id);
        expect(await read(NAMED, id)).toMatchObject({ counted: { done: 1, total: 3 }, notCounted: 0, sources: { sprintIds: [world.openList], taskIds: [world.teamTask] } });
    });

    it('is left out on a private goal when its owner can no longer open it', async () => {
        const id = await goal(AUTHOR);
        await link(AUTHOR, id, { sprintIds: [world.soloList, world.privateList] });
        world.solo.AssigneeUserId = [COLLEAGUE];
        sprintRow(world.privateList).AssigneeUserId = [COLLEAGUE];
        await recount(id);
        expect(await read(AUTHOR, id)).toMatchObject({ counted: { done: 0, total: 0 }, notCounted: 2, notCountedSources: { sprintIds: [world.soloList, world.privateList] } });
    });

    it('counts nothing for a goal whose only reader has lost their seat', async () => {
        const id = await goal(AUTHOR);
        await link(AUTHOR, id, { sprintIds: [world.openList] });
        mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((seat) => seat.userId === AUTHOR).isDelete = true;
        await recount(id);
        expect(goalRow(id).targets[0].counted).toMatchObject({ done: 0, total: 0, skipped: { sprintIds: [world.openList], taskIds: [] } });
    });

    it('is judged for the goal\'s readers, not for whoever happens to read it', async () => {
        const id = await goal(AUTHOR, { visibility: 'workspace' });
        await link(AUTHOR, id, { sprintIds: [world.openList] });
        world.open.isPrivateSpace = true;
        world.open.AssigneeUserId = [AUTHOR, ADMIN, OWNER];
        await recount(id);
        for (const uid of [OWNER, ADMIN, AUTHOR]) expect(await read(uid, id)).toMatchObject({ counted: { done: 0, total: 0 }, notCounted: 1 });
    });
});
