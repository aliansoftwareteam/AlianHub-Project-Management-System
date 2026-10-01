const crypto = require('crypto');
const mockDb = require('./fixtures/fakeMongo').create();

// Made here on every run; none of them is real.
const CLIENT_ID = `${crypto.randomBytes(6).toString('hex')}.apps.googleusercontent.test`;
const CLIENT_SECRET = crypto.randomBytes(18).toString('base64url');
const mockGoogle = require('./fixtures/fakeGoogle').create({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Company/helpers/companyCounters', () => ({
    stepCompanyCounters: jest.fn(async () => ({})),
    releaseMemberSeat: jest.fn(async () => ({})),
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn((url, opts) => mockGoogle.fetch(url, opts)),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const members = require('../Modules/settings/Members/controller');
const scim = require('../Modules/Scim/provisioning');
const google = require('../Modules/Agents/connectors/googleConnection');

const C = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const LEAVER = '6f0000000000000000000003';
const STAYER = '6f0000000000000000000004';
const SESSION = '6e0000000000000000000001';
const G = 'google_calendar';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const ENV = {
    CONNECTORS: G, SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on',
    CONNECTOR_GOOGLE_CLIENT_ID: CLIENT_ID, CONNECTOR_GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    APIURL: 'http://localhost:4000/', JWT_SECRET: crypto.randomBytes(24).toString('hex'),
};

const seat = (userId) => mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((r) => r.userId === userId);
const connection = (userId) => (mockDb.store[T] || []).find((r) => r.userId === userId);
const sealed = () => (mockDb.store[SCHEMA_TYPE.SECRETS] || []).filter((s) => s.ciphertext);
const handleFor = (userId) => google.usableTokenHandle({ companyId: C, userId, connector: G });

const member = (userId, roleType) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, {
    userId, roleType, status: 2, isDelete: false, companyId: C, designation: 0, userEmail: `${userId}@e2e.test`,
});
const connect = async (userId, sub) => {
    const { url } = await google.start({ companyId: C, userId, sessionId: SESSION, connector: G, origin: '' });
    const { state, code } = mockGoogle.consent(url, { email: `${userId}@example.test`, sub });
    await google.complete({ companyId: C, userId, sessionId: SESSION, connector: G, state, code });
};
const update = async (userId, data) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    await members.updateMember({ uid: OWNER, headers: { companyid: C }, body: { id: seat(userId)._id, data }, params: {}, query: {} }, res);
    return res;
};

const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

beforeEach(async () => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockGoogle.reset();
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C });
    member(OWNER, 1);
    member(LEAVER, 3);
    member(STAYER, 3);
    await connect(LEAVER, '31');
    await connect(STAYER, '41');
    mockGoogle.calls.length = 0;
});

afterAll(() => {
    Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
});

const ended = async () => {
    expect(mockGoogle.endpoints()).toEqual(['revoke:revoke']);
    expect(connection(LEAVER)).toMatchObject({ status: 'revoked', disconnectedBy: 'member_removed', secretHandles: {}, deletedStatusKey: 1 });
    expect(sealed()).toHaveLength(2);
    expect(await handleFor(LEAVER)).toEqual({ handle: null, reason: 'no_seat' });
    expect(connection(STAYER).status).toBe('connected');
    expect((await handleFor(STAYER)).handle).toBe(connection(STAYER).secretHandles.access_token);
    expect(mockGoogle.calls).toHaveLength(1);
};

describe('a member with a Google connection leaves the workspace', () => {
    it('holds a usable connection while they have a seat', async () => {
        expect((await handleFor(LEAVER)).handle).toBe(connection(LEAVER).secretHandles.access_token);
        expect(sealed()).toHaveLength(4);
    });

    it.each([
        ['removed on the members screen', { isDelete: true }],
        ['whose seat is cancelled', { status: 3 }],
    ])('%s: the grant is revoked once, the tokens are cleared and the connection is closed', async (label, data) => {
        expect((await update(LEAVER, data)).code).toBe(200);
        await ended();
    });

    it('deactivated through provisioning: the same', async () => {
        await scim.setActive(C, LEAVER, false);
        await ended();
    });

    it('made a guest: the connection is kept but hands out nothing', async () => {
        expect((await update(LEAVER, { roleType: 0 })).code).toBe(200);
        expect(mockGoogle.calls).toHaveLength(0);
        expect(connection(LEAVER).status).toBe('connected');
        expect(await handleFor(LEAVER)).toEqual({ handle: null, reason: 'no_seat' });
    });

    it('a removal still succeeds when Google cannot be reached', async () => {
        mockGoogle.answers.revoke = new Error('socket hang up');
        expect((await update(LEAVER, { isDelete: true })).code).toBe(200);
        expect(seat(LEAVER).isDelete).toBe(true);
        expect(connection(LEAVER)).toMatchObject({ status: 'revoked', secretHandles: {} });
        expect(sealed()).toHaveLength(2);
    });

    it('a change that leaves the seat in place ends nothing', async () => {
        expect((await update(LEAVER, { designation: 2 })).code).toBe(200);
        expect(mockGoogle.calls).toHaveLength(0);
        expect(connection(LEAVER).status).toBe('connected');
    });
});
