/* Task 047: the workspace's "a person checks before Done" switch, as the web app's control reaches it. */
const mockDb = require('./fixtures/fakeMongo').create();

const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const mockRoles = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async (companyId, uid) => mockRoles[uid]), isPrivileged: (role) => role === 1 || role === 2 }));

const { dbCollections } = require('../Config/collections');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Agents/controller');
const projectPolicy = require('../Modules/Agents/projectPolicy');

const CID = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000d01';
const TOKEN = '6f0000000000000000000e01';
const MODES = ['workspace', 'personal', 'local'];

const answer = async (handler, req) => {
    const res = { code: 200, body: null, status(code) { this.code = code; return this; }, send(sent) { this.body = sent; return this; }, json(sent) { this.body = sent; return this; } };
    await handler({ headers: { companyid: CID }, params: {}, query: {}, ip: '1.1.1.1', ...req }, res);
    return { code: res.code, body: res.body };
};
const put = (uid, body, extra = {}) => answer(ctrl.setPolicy, { uid, method: 'PUT', body, ...extra });
const get = (uid) => answer(ctrl.getPolicy, { uid, method: 'GET' });
const company = () => mockDb.store[dbCollections.COMPANIES][0];
const held = () => (company().agentPolicy || {}).requireCheckBeforeDone;
const hold = (requireCheckBeforeDone) => { company().agentPolicy = { requireCheckBeforeDone }; };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    mockDb.seed(dbCollections.COMPANIES, { _id: CID });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Website', agentPolicy: { done: projectPolicy.DONE.YES } });
});

describe('who may set the workspace\'s check before Done', () => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s turns it on and off, and every project is held to it', async (_who, uid) => {
        expect(await put(uid, { requireCheckBeforeDone: true })).toMatchObject({ code: 200, body: { status: true, data: { requireCheckBeforeDone: true, allowedModes: MODES } } });
        expect(held()).toBe(true);
        expect(await projectPolicy.effective(CID, PROJECT)).toMatchObject({ done: projectPolicy.DONE.NEVER, workspaceChecksBeforeDone: true });

        expect(await put(uid, { requireCheckBeforeDone: false })).toMatchObject({ code: 200, body: { data: { requireCheckBeforeDone: false } } });
        expect(await projectPolicy.effective(CID, PROJECT)).toMatchObject({ done: projectPolicy.DONE.YES, workspaceChecksBeforeDone: false });
    });

    it('leaves the allowed modes as they were', async () => {
        await put(OWNER, { allowedModes: ['workspace'] });
        expect((await put(OWNER, { requireCheckBeforeDone: true })).body.data).toEqual({ allowedModes: ['workspace'], requireCheckBeforeDone: true });
    });

    it.each([['a member', MEMBER], ['a guest', GUEST]])('%s is refused, and reads it as it stands', async (_who, uid) => {
        hold(true);
        expect(await put(uid, { requireCheckBeforeDone: false })).toMatchObject({ code: 403, body: { status: false } });
        expect(held()).toBe(true);
        expect(await get(uid)).toMatchObject({ code: 200, body: { data: { requireCheckBeforeDone: true } } });
    });

    it('an agent\'s token is refused, whoever holds it', async () => {
        hold(true);
        expect(await put(OWNER, { requireCheckBeforeDone: false }, { apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } })).toMatchObject({ code: 403, body: { status: false } });
        expect(held()).toBe(true);
    });
});
