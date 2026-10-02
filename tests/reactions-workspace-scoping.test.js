jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, ADMIN, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

const PATH = '/api/v2/reactions';
const EMOJI = '🎉';

let targets;
const TARGETS = [
    { name: 'a task in a public project', type: 'task', key: 'publicTask', allowed: [OWNER, ADMIN], refused: [MEMBER] },
    { name: 'a task in a private project the caller is not assigned to', type: 'task', key: 'privateTask', allowed: [ADMIN], refused: [MEMBER] },
    { name: 'a comment in a public project', type: 'comment', key: 'comment', allowed: [OWNER, MEMBER], refused: [] },
];

const react = (uid, target, extra = {}) => app.call('POST', PATH, {
    token: tokenFor(uid),
    companyId: WORKSPACE,
    body: { targetType: target.type, targetId: targets[target.key]._id, emoji: EMOJI },
    ...extra,
});

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/Reactions/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    const publicProject = mockDb.seed(SCHEMA_TYPE.PROJECTS, { isPrivateSpace: false });
    const privateProject = mockDb.seed(SCHEMA_TYPE.PROJECTS, { isPrivateSpace: true, AssigneeUserId: [OWNER] });
    targets = {
        publicTask: mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: publicProject._id, deletedStatusKey: 0 }),
        privateTask: mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: privateProject._id, deletedStatusKey: 0 }),
        comment: mockDb.seed(SCHEMA_TYPE.COMMENTS, { projectId: publicProject._id, taskId: '', sprintId: '' }),
    };
    mockDb.calls.length = 0;
});

describe(`POST ${PATH}`, () => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await app.call('POST', PATH, { companyId: WORKSPACE, body: { targetType: 'task', targetId: targets.publicTask._id, emoji: EMOJI } });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call', async () => {
        const res = await app.call('POST', PATH, { token: tokenFor(OWNER, [OTHER_WORKSPACE]), companyId: WORKSPACE, body: { targetType: 'task', targetId: targets.publicTask._id, emoji: EMOJI } });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('ignores a second workspace named in the body: every database call names the header\'s workspace', async () => {
        const res = await react(OWNER, TARGETS[0], { body: { targetType: 'task', targetId: targets.publicTask._id, emoji: EMOJI, companyId: OTHER_WORKSPACE } });
        expect(res.status).toBe(200);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
    });
});

describe.each(TARGETS)('POST /api/v2/reactions on $name', (target) => {
    it.each(target.allowed.map((uid) => [uid]))('names the caller\'s workspace in every database call and writes only the target (%s)', async (uid) => {
        const res = await react(uid, target);
        expect(res.status).toBe(200);
        expect(res.body.statusText).toBe('Reaction added.');
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
        const writes = mockDb.calls.filter((call) => call.method === 'findOneAndUpdate');
        expect(writes).toHaveLength(1);
        expect(String(writes[0].data[0]._id)).toBe(String(targets[target.key]._id));
    });

    if (target.refused.length) {
        it.each(target.refused.map((uid) => [uid]))('refuses a caller who may not read the target, and writes nothing (%s)', async (uid) => {
            const res = await react(uid, target);
            expect(res.status).toBe(404);
            expect(res.body.status).toBe(false);
            expect(unnamed(mockDb.calls)).toEqual([]);
            expect(mockDb.calls.filter((call) => call.method !== 'findOne' && call.method !== 'find')).toEqual([]);
            expect(mockDb.store[SCHEMA_TYPE.TASKS].every((row) => !row.reactions)).toBe(true);
        });
    }
});
