const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(() => Promise.resolve()) }));

const fs = require('fs');
const path = require('path');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { Notification_key } = require('../Config/notificationKey');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000a01';
const MEMBER = '6f0000000000000000000a03';
const LEFT = '6f0000000000000000000a05';
const CLIENT = 'ahc_'.concat('1'.repeat(32));

let rules;
let ctrl;
let notices;
let logger;
let socketEmitter;
let counts;

const boot = () => {
    jest.resetModules();
    rules = require('../Modules/ApiTokens/helpers/apiTokenRules');
    ctrl = require('../Modules/ApiTokens/controller');
    notices = require('../Modules/ApiTokens/expiryNotices');
    logger = require('../Config/loggerConfig');
    socketEmitter = require('../event/socketEventEmitter');
    counts = require('../Modules/notification-count/controller').updateUnReadCommentsCountFun;
};

const clock = (ms) => jest.setSystemTime(ms);
const oauth = (value) => {
    if (value === undefined) process.env.MCP_OAUTH = 'off';
    else process.env.MCP_OAUTH = value;
};

const db = (companyId = COMPANY) => mockDbFor(companyId);
const globalDb = () => mockDbFor(SCHEMA_TYPE.GOLBAL);
const tokens = () => db().store[SCHEMA_TYPE.API_TOKENS] || [];
const grants = () => globalDb().store[SCHEMA_TYPE.OAUTH_GRANTS] || [];
const told = (companyId = COMPANY) => db(companyId).store[SCHEMA_TYPE.NOTIFICATIONS] || [];
const copies = () => globalDb().store[SCHEMA_TYPE.NOTIFICATIONS] || [];
const emitted = () => socketEmitter.emit.mock.calls.filter(([, event]) => event && event.module === 'globalNotification');

const seedToken = (over = {}, companyId = COMPANY) => {
    const raw = rules.generateToken();
    const doc = db(companyId).seed(SCHEMA_TYPE.API_TOKENS, {
        name: 'Nightly export', tokenHash: rules.hashToken(raw), prefix: rules.tokenPrefixOf(raw),
        scopes: ['read', 'write'], userId: MEMBER, active: true, createdAt: new Date(T0 - 28 * DAY), expiresAt: new Date(T0 + 2 * DAY), ...over,
    });
    return { raw, doc, id: String(doc._id) };
};

const seedGrant = (over = {}) => globalDb().seed(SCHEMA_TYPE.OAUTH_GRANTS, {
    grantId: 'a'.repeat(32), clientId: CLIENT, companyId: COMPANY, userId: MEMBER, scopes: ['tasks:read'], resource: 'https://hub.example.test/mcp',
    createdAt: new Date(T0 - 88 * DAY), expiresAt: new Date(T0 + 2 * DAY), purgeAt: new Date(T0 + 32 * DAY), revokedAt: null, ...over,
});

const seedCompany = (companyId, members) => {
    globalDb().seed(SCHEMA_TYPE.COMPANIES, { _id: companyId });
    members.forEach(([userId, roleType, seat = {}]) => db(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false, ...seat }));
};

const run = () => notices.runForAllCompanies();

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    clock(T0);
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    delete process.env.API_TOKEN_STRICT;
    oauth('on');
    seedCompany(COMPANY, [[OWNER, 1], [MEMBER, 3], [LEFT, 3, { isDelete: true }]]);
    seedCompany(OTHER_COMPANY, [[OWNER, 1], [MEMBER, 3]]);
    boot();
});

afterEach(() => {
    oauth(undefined);
    jest.useRealTimers();
});

describe('a notice three days before a token ends', () => {
    it('goes to the token\'s owner and to nobody else, through the Inbox\'s own rows', async () => {
        const { id } = seedToken();

        await run();

        expect(told()).toHaveLength(1);
        expect(told()[0]).toMatchObject({
            key: Notification_key.CREDENTIAL_EXPIRING, changeType: 'credential_expiring', companyId: COMPANY,
            receiverID: MEMBER, assigneeUsers: [MEMBER], notSeen: [MEMBER], notificationType: 'push',
            changeData: { kind: 'token', name: 'Nightly export', tokenId: id },
        });
        expect(new Date(told()[0].changeData.expiresAt).getTime()).toBe(T0 + 2 * DAY);
        expect(copies()).toHaveLength(1);
        expect(copies()[0]).toMatchObject({ receiverID: MEMBER, assigneeUsers: [MEMBER], companyId: COMPANY });
        expect(emitted()).toHaveLength(1);
        expect(counts).toHaveBeenCalledWith({ body: { companyId: COMPANY, key: 5, userIds: [MEMBER], readAll: false } });
        expect(told(OTHER_COMPANY)).toHaveLength(0);
    });

    it('names the token by its label and carries no part of its secret, its hash or its prefix', async () => {
        const { raw, doc } = seedToken({ name: 'Laptop <b>agent</b>' });

        await run();

        const written = JSON.stringify([told(), copies(), socketEmitter.emit.mock.calls, [logger.info, logger.error, logger.warn, logger.debug].map((fn) => fn.mock.calls)]);
        expect(told()[0].changeData.name).toBe('Laptop <b>agent</b>');
        expect(told()[0].message).not.toContain('<b>');
        expect(written).not.toContain(raw);
        expect(written).not.toContain(raw.slice(rules.PREFIX_LENGTH));
        expect(written).not.toContain(doc.tokenHash);
        expect(written).not.toContain(doc.prefix);
    });

    it('is sent once, however often the job runs', async () => {
        const { id } = seedToken();

        await run();
        await run();
        clock(T0 + HOUR);
        await run();

        expect(told()).toHaveLength(1);
        expect(emitted()).toHaveLength(1);
        expect(new Date(tokens().find((row) => String(row._id) === id).expiryNoticeAt).getTime()).toBe(T0);
    });

    it('is sent once when two servers run the job at the same moment', async () => {
        seedToken();
        await Promise.all([run(), run()]);
        expect(told()).toHaveLength(1);
    });

    it('waits until three days are left', async () => {
        seedToken({ expiresAt: new Date(T0 + 3 * DAY + HOUR) });

        await run();
        expect(told()).toHaveLength(0);

        clock(T0 + 2 * HOUR);
        await run();
        expect(told()).toHaveLength(1);
    });

    it('says nothing of a token that has ended, was revoked, has no expiry, or was made to last three days or less', async () => {
        seedToken({ name: 'Ended', expiresAt: new Date(T0 - HOUR) });
        seedToken({ name: 'Revoked', active: false });
        seedToken({ name: 'No expiry', expiresAt: undefined });
        seedToken({ name: 'Short', createdAt: new Date(T0 - HOUR), expiresAt: new Date(T0 + 2 * DAY) });

        await run();

        expect(told()).toHaveLength(0);
        expect(tokens().every((row) => row.expiryNoticeAt === undefined)).toBe(true);
    });

    it('says nothing to a person who no longer holds a seat in the workspace', async () => {
        seedToken({ userId: LEFT });
        await run();
        expect(told()).toHaveLength(0);
    });

    it('is written in the workspace the token belongs to', async () => {
        seedToken({ name: 'Here' });
        seedToken({ name: 'There', userId: OWNER }, OTHER_COMPANY);

        await run();

        expect(told().map((row) => [row.receiverID, row.changeData.name])).toEqual([[MEMBER, 'Here']]);
        expect(told(OTHER_COMPANY).map((row) => [row.receiverID, row.changeData.name, row.companyId])).toEqual([[OWNER, 'There', OTHER_COMPANY]]);
    });

    it('is sent again for the new lifetime after the token is renewed', async () => {
        const { id } = seedToken();
        await run();

        const res = { status: () => res, send: (body) => { res.body = body; return res; } };
        await ctrl.renewToken({ headers: { companyid: COMPANY }, body: {}, params: { id }, uid: MEMBER, aud: COMPANY }, res);
        expect(res.body.status).toBe(true);

        clock(T0 + 20 * DAY);
        await run();
        expect(told()).toHaveLength(1);

        clock(T0 + 28 * DAY);
        await run();
        await run();
        expect(told()).toHaveLength(2);
        expect(JSON.stringify(told())).not.toContain(res.body.data.token);
    });

    it('still tells the next owner when one notice fails, and tells the first on the next run', async () => {
        seedToken({ name: 'First' });
        seedToken({ name: 'Second', userId: OWNER });
        const real = db().crud;
        let failed = false;
        db().crud = (companyId, query, method) => {
            if (!failed && query.type === SCHEMA_TYPE.NOTIFICATIONS && method === 'save') { failed = true; return Promise.reject(new Error('store down')); }
            return real(companyId, query, method);
        };

        await run();

        expect(told().map((row) => row.changeData.name)).toEqual(['Second']);
        expect(logger.error).toHaveBeenCalled();

        await run();
        await run();
        expect(told().map((row) => row.changeData.name)).toEqual(['Second', 'First']);
    });
});

describe('a notice three days before a connected app\'s access ends', () => {
    it('goes to the person who connected it, once, and names the app', async () => {
        globalDb().seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, { companyId: COMPANY, clientId: CLIENT, clientName: 'Claude', status: 'approved' });
        const grant = seedGrant();

        await run();
        await run();

        expect(told()).toHaveLength(1);
        expect(told()[0]).toMatchObject({
            key: Notification_key.CREDENTIAL_EXPIRING, changeType: 'credential_expiring', receiverID: MEMBER, assigneeUsers: [MEMBER], notSeen: [MEMBER],
            changeData: { kind: 'connection', name: 'Claude', grantId: grant.grantId },
        });
        expect(new Date(grants()[0].expiryNoticeAt).getTime()).toBe(T0);
        expect(emitted()).toHaveLength(1);
    });

    it('falls back to the client id when the app has no stored name', async () => {
        seedGrant();
        await run();
        expect(told()[0].changeData.name).toBe(CLIENT);
    });

    it('says nothing of a revoked or ended connection, one with more than three days left, or one whose person left', async () => {
        seedGrant({ grantId: 'b'.repeat(32), revokedAt: new Date(T0 - DAY) });
        seedGrant({ grantId: 'c'.repeat(32), expiresAt: new Date(T0 - HOUR) });
        seedGrant({ grantId: 'd'.repeat(32), expiresAt: new Date(T0 + 10 * DAY) });
        seedGrant({ grantId: 'e'.repeat(32), userId: LEFT });

        await run();

        expect(told()).toHaveLength(0);
    });

    it('says nothing while connections are switched off', async () => {
        oauth(undefined);
        boot();
        seedGrant();
        await run();
        expect(told()).toHaveLength(0);
        expect(grants()[0].expiryNoticeAt).toBeUndefined();
    });
});

describe('where the notice is declared', () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

    it('runs on the scheduler the other jobs run on', () => {
        expect(read('cron.js')).toMatch(/job\('credentialExpiryNotices', '[^']+', \(\) => credentialExpiryNotices\.runForAllCompanies\(\)\)/);
    });

    it('reaches the Inbox with its values', () => {
        expect(read('Modules/Inbox/controller.js')).toMatch(/STRUCTURED_CHANGES = \[[^\]]*'credential_expiring'/);
    });

    it('marks what it told in fields the schemas declare', () => {
        const { schema } = jest.requireActual('../utils/mongo-handler/schema.js');
        expect(schema.apiTokens.expiryNoticeAt).toMatchObject({ type: Date });
        expect(schema.oauthGrants.expiryNoticeAt).toMatchObject({ type: Date });
    });
});
