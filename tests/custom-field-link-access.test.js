/* Task 046 slice A1: who may link a task in a relationship field, who is shown a linked task, and who may vote. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => require('./fixtures/taskListRules').taskListHeldEverywhere());
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const mongoose = require('mongoose');
const socketEmitter = require('../event/socketEventEmitter');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { getTaskByQyery } = require('../Modules/Tasks/helpers/getTasksData');
const { QueryRefused } = require('../Modules/Tasks/helpers/taskQueryGuard');
const { openableTasks } = require('../Modules/Tasks/helpers/taskReadAccess');
const { checkedFieldDetail, FieldValueRefused } = require('../Modules/CustomField/helpers/fieldValueWrite');
const { resolveFor, castVote, withLinkConditions, RESOLVE_MAX } = require('../Modules/CustomField/helpers/fieldLinks');
const fieldLinks = require('../Modules/CustomField/fieldLinksController');
const routes = require('../Modules/CustomField/routes');
const { response, settle } = require('./fixtures/taskWriteGuard');

const CID = '6f00000000000000000000c1';
const OTHER_COMPANY = '6f00000000000000000000c2';
const [OWNER, ADMIN, MEMBER, GUEST, PEER, NO_FIELDS] = [1, 2, 3, 4, 5, 6].map((n) => `6f000000000000000000000${n}`);
const NO_FIELDS_ROLE = 7;
const ROLES = [[OWNER, 1], [ADMIN, 2], [MEMBER, 3], [GUEST, 0], [PEER, 3], [NO_FIELDS, NO_FIELDS_ROLE]];
/* The custom field permission as the matrix stores it: members edit, guests only see, and the last role has no access. */
const FIELD_ACCESS = [{ key: 3, permission: true }, { key: 0, permission: false }, { key: NO_FIELDS_ROLE, permission: null }];
const OPEN_PROJECT = '6f0000000000000000000a01';
const PRIVATE_PROJECT = '6f0000000000000000000a02';
const PERSONAL_LIST = '6f0000000000000000000a03';
const OPEN_SPRINT = '6f0000000000000000000d01';
const PRIVATE_SPRINT = '6f0000000000000000000d02';
const CLIENT = '6f0000000000000000000e31';
const VOTES = '6f0000000000000000000e32';
const SECRET_VOTES = '6f0000000000000000000e33';
const ELSEWHERE_VOTES = '6f0000000000000000000e34';
const task = (n) => `6f0000000000000000000b${String(n).padStart(2, '0')}`;
const [SOURCE, BARE, IN_OPEN, IN_PRIVATE, IN_PERSONAL, IN_SPRINT, DELETED, ARCHIVED, CHAT, PRIVATE_SOURCE, MISSING] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99].map(task);
const STORED = [IN_OPEN, IN_PRIVATE, IN_PERSONAL, IN_SPRINT, DELETED];
const NOT_OPENABLE = 'A task named here is not one you can open.';
const MARKER = { _id: CLIENT, fieldValue: '', revision: 1 };

const links = () => mockDb.store[SCHEMA_TYPE.CUSTOM_FIELD_LINKS] || [];
const idsOf = (taskId, fieldId) => (links().find((doc) => doc.taskId === taskId && doc.fieldId === fieldId) || {}).ids;
const storedTask = (id) => mockDb.store[SCHEMA_TYPE.TASKS].find((row) => String(row._id) === id);
const definition = (id) => mockDb.store[SCHEMA_TYPE.CUSTOM_FIELDS].find((field) => field._id === id);
const emitted = () => JSON.stringify(socketEmitter.emit.mock.calls);

const seed = () => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    socketEmitter.emit.mockClear();
    ROLES.forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    const taskRules = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task', name: 'task', isParent: true, roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_custom_field', name: 'task_custom_field', isParent: false, parentId: String(taskRules._id), roles: FIELD_ACCESS });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, ProjectName: 'Open', isPrivateSpace: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE_PROJECT, ProjectName: 'Private', isPrivateSpace: true, AssigneeUserId: [PEER] });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PERSONAL_LIST, ProjectName: 'Mine', isPrivateSpace: true, isPersonal: true, personalOwner: PEER, AssigneeUserId: [PEER] });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OPEN_SPRINT, projectId: OPEN_PROJECT, name: 'Backlog' });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: OPEN_PROJECT, name: 'Quiet', private: true, AssigneeUserId: [MEMBER] });
    const row = (_id, ProjectID, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id, ProjectID, sprintId: OPEN_SPRINT, TaskName: `Task ${_id.slice(-2)}`, TaskKey: `T-${_id.slice(-2)}`, TaskTypeKey: 1, deletedStatusKey: 0,
        status: { key: 1, text: 'To Do', type: 'default_active' }, statusKey: 1, statusType: 'default_active', ...extra,
    });
    row(SOURCE, OPEN_PROJECT, { customField: { [CLIENT]: { ...MARKER } } });
    row(BARE, OPEN_PROJECT, { customField: { [CLIENT]: { ...MARKER } } });
    row(IN_OPEN, OPEN_PROJECT);
    row(IN_PRIVATE, PRIVATE_PROJECT);
    row(IN_PERSONAL, PERSONAL_LIST);
    row(IN_SPRINT, OPEN_PROJECT, { sprintId: PRIVATE_SPRINT });
    row(DELETED, OPEN_PROJECT, { deletedStatusKey: 1 });
    row(ARCHIVED, OPEN_PROJECT, { deletedStatusKey: 2 });
    row(PRIVATE_SOURCE, PRIVATE_PROJECT, { customField: { [CLIENT]: { ...MARKER } } });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: CHAT, mainChat: true, AssigneeUserId: [OWNER, MEMBER], TaskName: 'Chat', deletedStatusKey: 0 });
    const field = (id, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: id, fieldTitle: fieldType, fieldType, type: 'task', global: true, isDelete: true, ...extra });
    field(CLIENT, 'relationship', { fieldLinkMax: 10, fieldLinkScope: 'any' });
    field(VOTES, 'voting', { fieldVotersShown: true });
    field(SECRET_VOTES, 'voting', { fieldVotersShown: false });
    field(ELSEWHERE_VOTES, 'voting', { global: false, projectId: [PRIVATE_PROJECT] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: SOURCE, fieldId: CLIENT, kind: 'relationship', ids: [...STORED] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: BARE, fieldId: CLIENT, kind: 'relationship', ids: [IN_PRIVATE] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: PRIVATE_SOURCE, fieldId: CLIENT, kind: 'relationship', ids: [IN_OPEN] });
};

beforeEach(seed);

const write = (actorId, ids, { taskId = SOURCE, field = CLIENT } = {}) => checkedFieldDetail({
    companyId: CID, definition: definition(field), task: storedTask(taskId), updateDetail: { _id: field, fieldValue: ids }, actorId,
});
const shown = async (uid, taskIds = [SOURCE]) => resolveFor({ companyId: CID, uid, taskIds });
const shownIds = async (uid, taskId = SOURCE) => (((await shown(uid, [taskId]))[taskId] || {})[CLIENT] || []).map((link) => link.id);
const request = (uid, body, params = {}, companyId = CID) => ({ uid, headers: { companyid: companyId }, aud: CID, body, params, query: {} });
const call = async (handler, req) => {
    const res = response();
    await handler(req, res);
    await settle();
    return { code: res.statusCode, body: res.body };
};

describe('the tasks a person can open', () => {
    const open = async (uid, options) => (await openableTasks(CID, uid, [IN_OPEN, IN_PRIVATE, IN_PERSONAL, IN_SPRINT, DELETED, ARCHIVED, CHAT, MISSING], options)).map((row) => String(row._id));

    it('follow the project, the sprint and the personal list, for every role', async () => {
        expect(await open(OWNER)).toEqual([IN_OPEN, IN_PRIVATE, IN_SPRINT]);
        expect(await open(ADMIN)).toEqual([IN_OPEN, IN_PRIVATE, IN_SPRINT]);
        expect(await open(MEMBER)).toEqual([IN_OPEN, IN_SPRINT]);
        expect(await open(GUEST)).toEqual([IN_OPEN]);
        expect(await open(PEER)).toEqual([IN_OPEN, IN_PRIVATE, IN_PERSONAL]);
        expect(await open('6f00000000000000000000ff')).toEqual([]);
        expect(await open('')).toEqual([]);
    });

    it('include a deleted or archived task only when asked', async () => {
        expect(await open(MEMBER, { live: false })).toEqual([IN_OPEN, IN_SPRINT, DELETED, ARCHIVED]);
    });
});

describe('writing a relationship value', () => {
    it('takes tasks the writer can open and keeps them beside the task, not on it', async () => {
        const detail = await write(MEMBER, [IN_OPEN, IN_SPRINT], { taskId: BARE });
        expect(detail).toEqual({ _id: CLIENT, fieldValue: '', revision: expect.any(Number) });
        expect(idsOf(BARE, CLIENT)).toEqual([IN_PRIVATE, IN_OPEN, IN_SPRINT]);
    });

    it.each([
        ['a task in a project the writer is not in', MEMBER, [IN_OPEN, IN_PRIVATE]],
        ['a task that does not exist', MEMBER, [MISSING]],
        ['a task in someone else\'s personal list, as a member', MEMBER, [IN_PERSONAL]],
        ['a task in someone else\'s personal list, as the owner', OWNER, [IN_PERSONAL]],
        ['a task in someone else\'s personal list, as an admin', ADMIN, [IN_PERSONAL]],
        ['a task in a private sprint the writer is not on', GUEST, [IN_SPRINT]],
        ['a deleted task', OWNER, [DELETED]],
        ['an archived task', OWNER, [ARCHIVED]],
        ['a chat row, even for someone in the chat', OWNER, [CHAT]],
        ['anything, for a writer with no identity', undefined, [IN_OPEN]],
    ])('refuses %s, with one answer for all of them', async (_what, actorId, ids) => {
        await expect(write(actorId, ids, { taskId: BARE })).rejects.toThrow(new FieldValueRefused(NOT_OPENABLE));
        expect(idsOf(BARE, CLIENT)).toEqual([IN_PRIVATE]);
    });

    it('refuses the task itself', async () => {
        await expect(write(OWNER, [BARE], { taskId: BARE })).rejects.toThrow(/linked to itself/);
    });

    it('keeps to the project or the list the field is limited to', async () => {
        Object.assign(definition(CLIENT), { fieldLinkScope: 'project', fieldLinkProjectId: OPEN_PROJECT });
        await expect(write(OWNER, [IN_PRIVATE], { taskId: IN_OPEN })).rejects.toThrow(/outside the project or list/);
        await expect(write(OWNER, [BARE], { taskId: IN_OPEN })).resolves.toMatchObject({ _id: CLIENT });
        Object.assign(definition(CLIENT), { fieldLinkScope: 'list', fieldLinkSprintId: PRIVATE_SPRINT });
        await expect(write(OWNER, [BARE, SOURCE], { taskId: IN_OPEN })).rejects.toThrow(/outside the project or list/);
        await expect(write(OWNER, [BARE, IN_SPRINT], { taskId: IN_OPEN })).resolves.toMatchObject({ _id: CLIENT });
        expect(idsOf(IN_OPEN, CLIENT)).toEqual([BARE, IN_SPRINT]);
    });

    it('leaves the links the writer cannot see as they were', async () => {
        expect(await shownIds(MEMBER)).toEqual([IN_OPEN, IN_SPRINT]);
        await write(MEMBER, [IN_SPRINT]);
        expect(idsOf(SOURCE, CLIENT)).toEqual([IN_PRIVATE, IN_PERSONAL, IN_SPRINT, DELETED]);
        await write(GUEST, []);
        expect(idsOf(SOURCE, CLIENT)).toEqual([IN_PRIVATE, IN_PERSONAL, IN_SPRINT, DELETED]);
        await write(OWNER, []);
        expect(idsOf(SOURCE, CLIENT)).toEqual([IN_PERSONAL, DELETED]);
    });

    it('puts a marker on the task and in its update event, and no linked id', async () => {
        const result = await taskMongo.updateTaskCustomField({
            companyId: CID, taskId: BARE, customFieldId: CLIENT, updateDetail: { _id: CLIENT, fieldValue: [IN_OPEN] },
            userData: { id: MEMBER, Employee_Name: 'Max Member' }, storedTask: storedTask(BARE),
        });
        await settle();
        expect(result.status).toBe(true);
        expect(storedTask(BARE).customField[CLIENT]).toEqual({ _id: CLIENT, fieldValue: '', revision: expect.any(Number) });
        expect(idsOf(BARE, CLIENT)).toEqual([IN_PRIVATE, IN_OPEN]);
        expect(emitted()).toContain(`customField.${CLIENT}`);
        [IN_OPEN, IN_PRIVATE].forEach((id) => {
            expect(emitted()).not.toContain(id);
            expect(JSON.stringify(mockDb.store[SCHEMA_TYPE.TASKS])).not.toContain(`"${id}"]`);
            expect(JSON.stringify(mockDb.store.history || [])).not.toContain(id);
        });
    });

    it('answers the task write with a refusal the same way', async () => {
        await expect(taskMongo.updateTaskCustomField({
            companyId: CID, taskId: BARE, customFieldId: CLIENT, updateDetail: { _id: CLIENT, fieldValue: [IN_PRIVATE, IN_PERSONAL] },
            userData: { id: MEMBER, Employee_Name: 'Max Member' }, storedTask: storedTask(BARE),
        })).rejects.toMatchObject({ statusCode: 400, message: NOT_OPENABLE });
        expect(storedTask(BARE).customField).toEqual({ [CLIENT]: MARKER });
    });
});

describe('reading a relationship value', () => {
    it('shows each viewer the linked tasks they can open themselves, in order', async () => {
        expect(await shownIds(OWNER)).toEqual([IN_OPEN, IN_PRIVATE, IN_SPRINT]);
        expect(await shownIds(ADMIN)).toEqual([IN_OPEN, IN_PRIVATE, IN_SPRINT]);
        expect(await shownIds(MEMBER)).toEqual([IN_OPEN, IN_SPRINT]);
        expect(await shownIds(GUEST)).toEqual([IN_OPEN]);
        expect(await shownIds(PEER)).toEqual([IN_OPEN, IN_PRIVATE, IN_PERSONAL]);
    });

    it('gives each linked task as its id, key, title and status, and says nothing of the rest', async () => {
        const seen = await shown(GUEST, [SOURCE, BARE, MISSING]);
        expect(seen).toEqual({
            [SOURCE]: { [CLIENT]: [{ id: IN_OPEN, key: 'T-03', title: 'Task 03', status: { key: 1, text: 'To Do', type: 'default_active' }, projectId: OPEN_PROJECT, sprintId: OPEN_SPRINT, folderId: '' }] },
        });
        [IN_PRIVATE, IN_PERSONAL, IN_SPRINT, DELETED].forEach((id) => expect(JSON.stringify(seen)).not.toContain(id));
    });

    it('shows nothing of a task the viewer cannot open', async () => {
        expect(await shown(MEMBER, [PRIVATE_SOURCE])).toEqual({});
        expect(await shownIds(PEER, PRIVATE_SOURCE)).toEqual([IN_OPEN]);
        expect(await shown('', [SOURCE])).toEqual({});
    });

    it('drops a deleted or archived linked task, and shows it again once restored', async () => {
        storedTask(IN_OPEN).deletedStatusKey = 2;
        expect(await shownIds(MEMBER)).toEqual([IN_SPRINT]);
        expect(idsOf(SOURCE, CLIENT)).toEqual(STORED);
        storedTask(IN_OPEN).deletedStatusKey = 0;
        storedTask(DELETED).deletedStatusKey = 0;
        expect(await shownIds(MEMBER)).toEqual([IN_OPEN, IN_SPRINT, DELETED]);
    });

    it('does not read ids left by a field whose type was changed', async () => {
        definition(CLIENT).fieldType = 'voting';
        expect(await shown(OWNER)).toEqual({});
    });

    it('answers over HTTP for the caller alone, in the caller\'s company', async () => {
        const ok = await call(fieldLinks.resolve, request(GUEST, { taskIds: [SOURCE] }));
        expect(ok.code).toBe(200);
        expect(ok.body.data[SOURCE][CLIENT].map((link) => link.id)).toEqual([IN_OPEN]);
        expect((await call(fieldLinks.resolve, request(GUEST, { taskIds: [SOURCE] }, {}, OTHER_COMPANY))).code).toBe(403);
        expect((await call(fieldLinks.resolve, request(GUEST, { taskIds: SOURCE }))).code).toBe(400);
        expect((await call(fieldLinks.resolve, request(GUEST, { taskIds: Array.from({ length: RESOLVE_MAX + 1 }, () => SOURCE) }))).code).toBe(400);
        expect((await call(fieldLinks.resolve, request(GUEST, { taskIds: [{ $ne: null }, 'x'] }))).body.data).toEqual({});
    });
});

describe('the task query', () => {
    const condition = (is, extra = {}, field = CLIENT) => ({ _id: { fieldLinks: { field, is, ...extra } } });
    const answered = async (uid, wanted) => {
        const [stage] = await withLinkConditions(CID, uid, [{ $match: wanted }]);
        const [operator, ids] = Object.entries(stage.$match._id)[0];
        return [operator, ids.map(String)];
    };

    it('reads "has a value" as the viewer would see it', async () => {
        expect(await answered(OWNER, condition('set'))).toEqual(['$in', [SOURCE, BARE, PRIVATE_SOURCE]]);
        expect(await answered(MEMBER, condition('set'))).toEqual(['$in', [SOURCE, PRIVATE_SOURCE]]);
        expect(await answered(MEMBER, condition('empty'))).toEqual(['$nin', [SOURCE, PRIVATE_SOURCE]]);
    });

    it('finds the tasks linking one task only for a viewer who can open that task', async () => {
        expect(await answered(OWNER, condition('has', { task: IN_PRIVATE }))).toEqual(['$in', [SOURCE, BARE]]);
        expect(await answered(MEMBER, condition('has', { task: IN_PRIVATE }))).toEqual(['$in', []]);
        expect(await answered(MEMBER, condition('has', { task: MISSING }))).toEqual(['$in', []]);
        expect(await answered(OWNER, condition('has', { task: IN_PERSONAL }))).toEqual(['$in', []]);
    });

    it('finds a viewer\'s own votes and nobody else\'s', async () => {
        await castVote({ companyId: CID, uid: MEMBER, taskId: SOURCE, fieldId: VOTES, vote: true });
        await castVote({ companyId: CID, uid: PEER, taskId: BARE, fieldId: VOTES, vote: true });
        expect(await answered(MEMBER, condition('mine', {}, VOTES))).toEqual(['$in', [SOURCE]]);
        expect(await answered(GUEST, condition('mine', {}, VOTES))).toEqual(['$in', []]);
        expect(await answered(OWNER, condition('has', { task: PEER }, VOTES))).toEqual(['$in', []]);
        expect(await answered(OWNER, condition('set', {}, VOTES))).toEqual(['$in', []]);
        expect(await answered(MEMBER, condition('mine'))).toEqual(['$in', []]);
    });

    it('answers a condition wherever it sits, and leaves the rest of the query as it was', async () => {
        const projectId = new mongoose.Types.ObjectId(OPEN_PROJECT);
        const since = new Date('2026-10-01T00:00:00.000Z');
        const [match, facet] = await withLinkConditions(CID, MEMBER, [
            { $match: { $and: [{ ProjectID: { $in: [projectId] } }, { createdAt: { $gte: since } }, { $nor: [{ ...condition('set'), TaskTypeKey: { $in: [1] } }] }] } },
            { $facet: { has: [{ $match: condition('set') }, { $count: 'count' }] } },
        ]);
        expect(match.$match.$and[0].ProjectID.$in[0]).toBe(projectId);
        expect(match.$match.$and[1].createdAt.$gte).toBe(since);
        expect(match.$match.$and[2].$nor[0]).toMatchObject({ TaskTypeKey: { $in: [1] } });
        expect(match.$match.$and[2].$nor[0]._id.$in.map(String)).toEqual([SOURCE]);
        expect(facet.$facet.has[0].$match._id.$in.map(String)).toEqual([SOURCE]);
        expect(facet.$facet.has[1]).toEqual({ $count: 'count' });
    });

    it.each([
        ['no field', { is: 'set' }],
        ['a field that is not an id', { field: { $ne: null }, is: 'set' }],
        ['an unknown question', { field: CLIENT, is: 'all' }],
        ['no task to look for', { field: CLIENT, is: 'has' }],
        ['a condition for the task to look for', { field: CLIENT, is: 'has', task: { $ne: null } }],
    ])('refuses a condition with %s', async (_what, fieldLinksCondition) => {
        await expect(withLinkConditions(CID, OWNER, [{ $match: { _id: { fieldLinks: fieldLinksCondition } } }])).rejects.toThrow(QueryRefused);
    });

    it('refuses more conditions than it will answer', async () => {
        const many = Array.from({ length: 11 }, () => condition('set'));
        await expect(withLinkConditions(CID, OWNER, [{ $match: { $or: many } }])).rejects.toThrow(/at most 10/);
    });

    it('runs through the task read under the viewer\'s own visibility, and returns no linked id', async () => {
        const find = async (uid, wanted) => (await call(getTaskByQyery, request(uid, { findQuery: [{ $match: wanted }, { $project: { TaskKey: 1, customField: 1 } }] }))).body;
        const keysOf = (rows) => rows.map((row) => row.TaskKey);
        expect(keysOf(await find(OWNER, condition('set')))).toEqual(['T-01', 'T-02', 'T-10']);
        expect(keysOf(await find(MEMBER, condition('set')))).toEqual(['T-01']);
        expect(keysOf(await find(GUEST, condition('has', { task: IN_SPRINT })))).toEqual([]);
        expect(keysOf(await find(MEMBER, condition('has', { task: IN_SPRINT })))).toEqual(['T-01']);
        const all = await find(GUEST, { deletedStatusKey: 0 });
        expect(keysOf(all)).toEqual(['T-01', 'T-02', 'T-03']);
        STORED.forEach((id) => expect(JSON.stringify(all.map((row) => row.customField))).not.toContain(id));
        expect((await call(getTaskByQyery, request(OWNER, { findQuery: [{ $match: { _id: { fieldLinks: { is: 'set' } } } }] }))).code).toBe(400);
    });
});

describe('voting', () => {
    const vote = (uid, taskId, value = true, field = VOTES) => castVote({ companyId: CID, uid, taskId, fieldId: field, vote: value });
    const count = (taskId, field = VOTES) => (storedTask(taskId).customField || {})[field];

    it('is one vote a person, cast and withdrawn by that person, with the count kept on the task', async () => {
        expect(await vote(MEMBER, SOURCE)).toEqual({ count: 1, voted: true });
        expect(await vote(MEMBER, SOURCE)).toEqual({ count: 1, voted: true });
        expect(await vote(GUEST, SOURCE)).toEqual({ count: 2, voted: true });
        expect(idsOf(SOURCE, VOTES)).toEqual([MEMBER, GUEST]);
        expect(count(SOURCE)).toEqual({ _id: VOTES, fieldValue: 2, revision: expect.any(Number), version: 3 });
        expect(await vote(MEMBER, SOURCE, false)).toEqual({ count: 1, voted: false });
        expect(await vote(MEMBER, SOURCE, false)).toEqual({ count: 1, voted: false });
        expect(await vote(GUEST, SOURCE, false)).toEqual({ count: 0, voted: false });
        expect(count(SOURCE).fieldValue).toBeUndefined();
        expect(idsOf(SOURCE, VOTES)).toEqual([]);
    });

    it('tells the task\'s open views through the task update event, without the voters', async () => {
        await vote(MEMBER, SOURCE);
        const [event, payload] = socketEmitter.emit.mock.calls.at(-1);
        expect(event).toBe('update');
        expect(payload).toMatchObject({ type: 'update', module: 'task', updatedFields: { [`customField.${VOTES}`]: { _id: VOTES, fieldValue: 1 } } });
        expect(String(payload.data._id)).toBe(SOURCE);
        expect(emitted()).not.toContain(MEMBER);
    });

    it.each([
        ['a task in a project the voter is not in', MEMBER, IN_PRIVATE],
        ['a task in someone else\'s personal list, as the owner', OWNER, IN_PERSONAL],
        ['a task in a private sprint the voter is not on', GUEST, IN_SPRINT],
        ['a deleted task', OWNER, DELETED],
        ['a chat row', OWNER, CHAT],
        ['a task that does not exist', OWNER, MISSING],
        ['a task id that is a condition', OWNER, { $ne: null }],
        ['anything, for someone outside the company', '6f00000000000000000000ff', SOURCE],
    ])('is refused on %s, with one answer for all of them', async (_what, uid, taskId) => {
        expect(await vote(uid, taskId)).toEqual({ refused: 'not_found' });
        expect(links().filter((doc) => doc.kind === 'voting')).toEqual([]);
        expect((await call(fieldLinks.vote, request(uid, { taskId, vote: true }, { fieldId: VOTES }))).code).toBe(404);
    });

    it('is cast by a person who can open the task and may see its fields without editing them', async () => {
        const registered = {};
        const record = (method) => (path, ...handlers) => { registered[`${method} ${path}`] = handlers; };
        routes.init({ get: record('GET'), put: record('PUT'), post: record('POST') });
        expect(registered['POST /api/v2/custom-fields/:fieldId/vote']).toEqual([fieldLinks.vote]);
        expect(registered['POST /api/v2/custom-fields/links/resolve']).toEqual([fieldLinks.resolve]);
        const cast = await call(fieldLinks.vote, request(GUEST, { taskId: SOURCE, vote: true }, { fieldId: VOTES }));
        expect(cast).toEqual({ code: 200, body: { status: true, statusText: 'OK', data: { count: 1, voted: true } } });
        expect(idsOf(SOURCE, VOTES)).toEqual([GUEST]);
    });

    it.each([
        ['another voter named', { taskId: SOURCE, vote: true, userId: PEER }],
        ['a list of voters', { taskId: SOURCE, vote: true, ids: [PEER, OWNER] }],
        ['a count', { taskId: SOURCE, vote: true, count: 40 }],
        ['a vote that is not yes or no', { taskId: SOURCE, vote: PEER }],
        ['no vote', { taskId: SOURCE }],
    ])('is refused with %s', async (_what, body) => {
        expect((await call(fieldLinks.vote, request(MEMBER, body, { fieldId: VOTES }))).code).toBe(400);
        expect(links().filter((doc) => doc.kind === 'voting')).toEqual([]);
        expect(count(SOURCE)).toBeUndefined();
    });

    it('is refused on a field that is not a voting field of the task', async () => {
        expect(await vote(MEMBER, SOURCE, true, CLIENT)).toEqual({ refused: 'not_a_voting_field' });
        expect(await vote(MEMBER, SOURCE, true, ELSEWHERE_VOTES)).toEqual({ refused: 'not_a_voting_field' });
        expect(await vote(MEMBER, SOURCE, true, MISSING)).toEqual({ refused: 'not_a_voting_field' });
        expect((await call(fieldLinks.vote, request(MEMBER, { taskId: SOURCE, vote: true }, { fieldId: CLIENT }))).code).toBe(400);
        definition(VOTES).fieldTaskTypes = [2];
        expect(await vote(MEMBER, SOURCE)).toEqual({ refused: 'not_a_voting_field' });
        expect(idsOf(SOURCE, CLIENT)).toEqual(STORED);
    });

    it('cannot be written as a value: not the voters, not the count, not a blank', async () => {
        await vote(MEMBER, SOURCE);
        for (const fieldValue of [[PEER, OWNER], [], 40, 0, '', null]) {
            await expect(write(OWNER, fieldValue, { field: VOTES })).rejects.toThrow(FieldValueRefused);
            await expect(taskMongo.updateTaskCustomField({
                companyId: CID, taskId: SOURCE, customFieldId: VOTES, updateDetail: { _id: VOTES, fieldValue },
                userData: { id: OWNER, Employee_Name: 'Olivia Owner' }, storedTask: storedTask(SOURCE),
            })).rejects.toMatchObject({ statusCode: 400 });
        }
        expect(idsOf(SOURCE, VOTES)).toEqual([MEMBER]);
        expect(count(SOURCE)).toMatchObject({ fieldValue: 1 });
    });

    it('shows the count and the viewer\'s own vote, and the voters only when the field shows them', async () => {
        await vote(MEMBER, SOURCE);
        await vote(PEER, SOURCE);
        await vote(MEMBER, SOURCE, true, SECRET_VOTES);
        await vote(PEER, SOURCE, true, SECRET_VOTES);
        const seen = (await shown(GUEST))[SOURCE];
        expect(seen[VOTES]).toEqual({ count: 2, voted: false, voters: [MEMBER, PEER] });
        expect(seen[SECRET_VOTES]).toEqual({ count: 2, voted: false });
        expect((await shown(MEMBER))[SOURCE][SECRET_VOTES]).toEqual({ count: 2, voted: true });
        expect(await shown(MEMBER, [PRIVATE_SOURCE])).toEqual({});
    });

    it('is not cast by a person whose role has no access to custom fields, as the app shows them none', async () => {
        expect(await vote(NO_FIELDS, SOURCE)).toEqual({ refused: 'fields_hidden' });
        expect(await call(fieldLinks.vote, request(NO_FIELDS, { taskId: SOURCE, vote: true }, { fieldId: VOTES }))).toMatchObject({ code: 403, body: { status: false } });
        expect(await vote(NO_FIELDS, IN_PRIVATE)).toEqual({ refused: 'not_found' });
        expect(links().filter((doc) => doc.kind === 'voting')).toEqual([]);
        expect(count(SOURCE)).toBeUndefined();
        mockDb.store[SCHEMA_TYPE.RULES].find((rule) => rule.key === 'task_custom_field').roles = [{ key: NO_FIELDS_ROLE, permission: false }];
        expect(await vote(NO_FIELDS, SOURCE)).toEqual({ count: 1, voted: true });
        expect(await vote(MEMBER, SOURCE)).toEqual({ refused: 'fields_hidden' });
        expect(await vote(OWNER, SOURCE)).toEqual({ count: 2, voted: true });
    });

    it('cannot be made of a field that already holds values of another kind, nor unmade', async () => {
        const registered = {};
        const record = (method) => (path, ...handlers) => { registered[`${method} ${path}`] = handlers; };
        routes.init({ get: record('GET'), put: record('PUT'), post: record('POST') });
        const sameKind = registered['PUT /api/v1/customField'].at(-2);
        const NUMBER = '6f0000000000000000000e35';
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: NUMBER, fieldTitle: 'Points', fieldType: 'number', type: 'task', global: true, isDelete: true });
        const change = async (id, updateObject) => {
            const res = response();
            let passed = false;
            await sameKind(request(OWNER, { key: '$set', type: 'updateOne', id, updateObject }), res, () => { passed = true; });
            return passed ? 'passed' : res.statusCode;
        };
        expect(await change(NUMBER, { fieldType: 'voting' })).toBe(400);
        expect(await change(NUMBER, { fieldType: 'relationship' })).toBe(400);
        expect(await change(VOTES, { fieldType: 'number' })).toBe(400);
        expect(await change(CLIENT, { fieldType: 'voting' })).toBe(400);
        expect(await change(MISSING, { fieldType: 'voting' })).toBe(400);
        expect(await change(VOTES, { fieldType: 'voting', fieldVotersShown: false })).toBe('passed');
        expect(await change(VOTES, { fieldTitle: 'Upvotes' })).toBe('passed');
        expect(await change(NUMBER, { fieldType: 'money' })).toBe('passed');
    });
});
