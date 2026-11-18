process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const express = require('express');

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));

const MB = 1024 * 1024;
const GB = 1024 * MB;
const hostingMode = require('../Config/hostingMode');
const platformState = require('../Modules/Platform/platformState');
const platformEntitlements = require('../Modules/Platform/entitlements');
const lifecycle = require('../Modules/Platform/lifecycle');
const seats = require('../Modules/Entitlements/seats');
const uploads = require('../Modules/Entitlements/uploads');
const guards = require('../Modules/Entitlements/guards');
const mailCap = require('../Modules/Entitlements/mailCap');
const lifecycleGuard = require('../Modules/Entitlements/lifecycleGuard');
const { requirePlanRoom, bodyField } = require('../Modules/storage/bucketAccess');
const { DEFAULT_LIMITS } = require('../utils/uploadConfig');
const { SEAT_ACTIVE, SEAT_PENDING } = require('../Config/seatStatus');
const { ROLE_MEMBER, ROLE_GUEST } = require('../Config/roleTypes');

const STARTER = {
    version: 3, plan: 'starter',
    limits: { seats: 10, guests: 5, workspaces: 1, storageBytes: 20 * GB, maxFileBytes: 50 * MB, emailsPerDay: 500 },
    features: { timeTracker: { enabled: false, seats: 0 }, ownSmtp: false },
    portalUrl: 'https://account.alianhub.com/i/ins_x',
};

const saved = { HOSTING_MODE: process.env.HOSTING_MODE };
let server;
let base;
let rows;
let stored;
let workspaces;

const seat = (userId, extra = {}) => ({ userId, userEmail: `${userId}@acme.test`, status: SEAT_ACTIVE, roleType: ROLE_MEMBER, ...extra });

const inMode = async (mode, { entitlements = STARTER, state = 'active' } = {}) => {
    process.env.HOSTING_MODE = mode;
    hostingMode._resetForTests();
    platformState._useStoreForTests(platformState.memoryStore({ entitlements: { payload: entitlements, version: entitlements.version }, lifecycle: { state } }));
    platformEntitlements._resetForTests();
    lifecycle._resetForTests();
    if (mode === 'managed') {
        await platformEntitlements.loadEntitlements();
        await lifecycle.loadLifecycle();
    }
};

const ok = (req, res) => res.send({ status: true });

beforeAll(async () => {
    seats._useSourceForTests({ companyIds: async () => ['c1', 'c2'], supportUserIds: async () => ['support'], seatsIn: async (companyId) => rows[companyId] || [] });
    uploads._useUsageForTests(async () => ({ bytes: stored }));
    guards._useWorkspaceCountForTests(async () => workspaces);
    const app = express();
    app.use(express.json());
    require('../Config/setMiddleware').setPlanGuards(app);
    app.post('/api/v2/sendInvitationEmail', guards.requireInvitationSeats, ok);
    app.post('/api/v1/importUser', guards.requireImportSeats, ok);
    app.post('/api/v2/company/create', guards.requireWorkspaceRoom, ok);
    app.post('/api/v1/storage/uploadFileBase64', requirePlanRoom(bodyField('companyId')), ok);
    app.post('/api/v1/auth/loginAuthTracker', ok);
    app.post('/api/v4/timetracker/capture', ok);
    app.post('/api/v2/tasks', ok);
    app.get('/api/v2/tasks', ok);
    app.post('/api/v2/exports', ok);
    app.post('/api/v2/auth/login', ok);
    app.get('/api/v2/instance/public-config', ok);
    app.post('/api/v2/platform/lifecycle', ok);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
    server.close();
    seats._useSourceForTests(null);
    uploads._useUsageForTests(() => require('../common-storage/storageUsage').instanceStorageUsage());
    guards._useWorkspaceCountForTests(null);
    if (saved.HOSTING_MODE === undefined) delete process.env.HOSTING_MODE; else process.env.HOSTING_MODE = saved.HOSTING_MODE;
    hostingMode._resetForTests();
    platformState._useStoreForTests(null);
    lifecycle._resetForTests();
});

beforeEach(async () => {
    rows = { c1: Array.from({ length: 6 }, (_, i) => seat(`p${i}`)), c2: [...Array.from({ length: 4 }, (_, i) => seat(`q${i}`)), seat('p0'), seat('support')] };
    stored = 0;
    workspaces = 1;
    seats.forgetSeats();
    uploads.forgetStorage();
    await inMode('managed');
});

const call = async (method, path, body = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};

describe('seats with the Starter plan (10)', () => {
    it('refuses an 11th person, by invitation or by import, and says why', async () => {
        const invited = await call('POST', '/api/v2/sendInvitationEmail', { email: 'eleven@acme.test', role: ROLE_MEMBER });
        expect(invited.body).toMatchObject({ status: false, code: 'seat_limit', limit: 10, used: 10, statusCode: 403 });
        expect(invited.body.statusText).toMatch(/10 seats/);
        const imported = await call('POST', '/api/v1/importUser', { users: [{ email: 'a@x.test', role: ROLE_MEMBER }] });
        expect(imported.body.code).toBe('seat_limit');
    });

    it('lets an existing member be invited to a second workspace', async () => {
        expect((await call('POST', '/api/v2/sendInvitationEmail', { email: 'q1@acme.test', role: ROLE_MEMBER })).body).toEqual({ status: true });
    });

    it('counts open invitations and frees the seat once someone leaves', async () => {
        rows.c1.pop();
        rows.c1.push({ userEmail: 'waiting@acme.test', status: SEAT_PENDING, roleType: ROLE_MEMBER });
        expect((await call('POST', '/api/v2/sendInvitationEmail', { email: 'other@acme.test', role: ROLE_MEMBER })).body.code).toBe('seat_limit');
        expect((await guards.acceptanceRefusal({ email: 'waiting@acme.test', roleType: ROLE_MEMBER }))).toBeNull();
        rows.c1.pop();
        seats.forgetSeats();
        expect((await call('POST', '/api/v2/sendInvitationEmail', { email: 'other@acme.test', role: ROLE_MEMBER })).body).toEqual({ status: true });
    });

    it('refuses accepting an invitation, an SSO sign-up or a reactivation past the limit, but not for someone already in', async () => {
        expect(await guards.acceptanceRefusal({ email: 'new@acme.test', roleType: ROLE_MEMBER })).toMatchObject({ code: 'seat_limit' });
        expect(await guards.acceptanceRefusal({ userId: 'q2', email: 'q2@acme.test', roleType: ROLE_MEMBER })).toBeNull();
    });

    it('lets guests in up to the guest limit without taking a seat', async () => {
        expect((await call('POST', '/api/v1/importUser', { users: Array.from({ length: 5 }, (_, i) => ({ email: `g${i}@x.test`, role: ROLE_GUEST })) })).body).toEqual({ status: true });
        expect((await call('POST', '/api/v1/importUser', { users: Array.from({ length: 6 }, (_, i) => ({ email: `g${i}@x.test`, role: ROLE_GUEST })) })).body).toMatchObject({ code: 'seat_limit', guests: true });
    });
});

describe('storage and file size', () => {
    const base64Of = (bytes) => 'A'.repeat(Math.ceil(bytes / 3) * 4);

    it('refuses an upload that would cross the quota and one that is larger than the plan allows', async () => {
        stored = 20 * GB - 1000;
        const crossing = await call('POST', '/api/v1/storage/uploadFileBase64', { companyId: 'c1', base64String: base64Of(3000) });
        expect(crossing).toMatchObject({ status: 507, body: { code: 'storage_full', limit: 20 * GB } });
        expect((await call('POST', '/api/v1/storage/uploadFileBase64', { companyId: 'c1', base64String: base64Of(600) })).body).toEqual({ status: true });
        expect(await uploads.uploadLimitRefusal('c1', 51 * MB)).toMatchObject({ code: 'file_too_large', limit: 50 * MB });
    });

    it('refuses a full instance before the size is known, and uploads work again once a file is deleted', async () => {
        stored = 20 * GB;
        expect(await uploads.uploadLimitRefusal('c1', 0)).toMatchObject({ code: 'storage_full' });
        stored = 20 * GB - 10 * MB;
        expect(await uploads.uploadLimitRefusal('c1', MB)).toBeNull();
    });

    it('never refuses avatars or the shared public assets', async () => {
        stored = 30 * GB;
        expect(await uploads.uploadLimitRefusal('USER_PROFILES', MB)).toBeNull();
        expect(await uploads.uploadLimitRefusal('public', MB)).toBeNull();
    });

    it('stops multer at the plan largest file', () => {
        expect(DEFAULT_LIMITS.fileSize).toBe(50 * MB);
    });

    it('throws a plan refusal from the helper every non-route writer calls', async () => {
        stored = 20 * GB;
        await expect(uploads.assertUploadAllowed('c1', 10)).rejects.toMatchObject({ code: 'storage_full', statusCode: 507, planLimit: true });
    });
});

describe('workspaces', () => {
    it('refuses a second workspace on Starter', async () => {
        expect((await call('POST', '/api/v2/company/create')).body).toMatchObject({ code: 'workspace_limit', limit: 1, used: 1 });
        workspaces = 0;
        expect((await call('POST', '/api/v2/company/create')).body).toEqual({ status: true });
        expect(await guards.workspaceState()).toMatchObject({ count: 0, limit: 1, canCreate: true });
    });
});

describe('the time tracker add-on', () => {
    it('refuses tracker sign-in and uploads while the add-on is off', async () => {
        expect(await call('POST', '/api/v1/auth/loginAuthTracker')).toMatchObject({ status: 403, body: { code: 'tracker_disabled' } });
        expect((await call('POST', '/api/v4/timetracker/capture')).body.code).toBe('tracker_disabled');
        expect(await guards.trackerSeatRefusal('p1')).toMatchObject({ code: 'tracker_disabled' });
    });

    it('caps tracker seats with the add-on on, counting a person once', async () => {
        await inMode('managed', { entitlements: { ...STARTER, version: 4, features: { timeTracker: { enabled: true, seats: 2 } } } });
        rows.c1[0].isTrackerUser = true;
        rows.c2[0].isTrackerUser = true;
        expect((await call('POST', '/api/v1/auth/loginAuthTracker')).body).toEqual({ status: true });
        expect(await guards.trackerSeatRefusal('p0')).toBeNull();
        expect(await guards.trackerSeatRefusal('p5')).toMatchObject({ code: 'tracker_seat_limit', limit: 2, used: 2 });
    });
});

describe('read-only and suspended', () => {
    it('read-only refuses writes with 423 and lets reads, sign-in, exports and the platform through', async () => {
        await inMode('managed', { state: 'read_only' });
        expect(await call('POST', '/api/v2/tasks')).toMatchObject({ status: 423, body: { code: 'read_only', status: false } });
        expect((await call('GET', '/api/v2/tasks')).status).toBe(200);
        expect((await call('POST', '/api/v2/exports')).status).toBe(200);
        expect((await call('POST', '/api/v2/auth/login')).status).toBe(200);
        expect((await call('POST', '/api/v2/platform/lifecycle')).status).toBe(200);
    });

    it('suspended refuses everything but the platform API and the public config', async () => {
        await inMode('managed', { state: 'suspended' });
        expect(await call('GET', '/api/v2/tasks')).toMatchObject({ status: 423, body: { code: 'suspended', portalUrl: expect.any(String) } });
        expect((await call('POST', '/api/v2/auth/login')).status).toBe(423);
        expect((await call('GET', '/api/v2/instance/public-config')).status).toBe(200);
        expect((await call('POST', '/api/v2/platform/lifecycle')).status).toBe(200);
    });

    it('pauses writers while locked and resumes them on active', async () => {
        const run = jest.fn(async () => 'ran');
        const job = lifecycleGuard.whenWritable('recurringTasks', run);
        await inMode('managed', { state: 'read_only' });
        await expect(job()).resolves.toBeUndefined();
        await inMode('managed', { state: 'past_due' });
        await expect(job()).resolves.toBe('ran');
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('stops agents from starting a run while locked', async () => {
        await inMode('managed', { state: 'read_only' });
        await expect(require('../Modules/Agents/runs').canStart({ paused: false }, {})).resolves.toMatchObject({ ok: false, code: 'instance_locked' });
    });
});

describe('the daily mail cap', () => {
    const queue = () => {
        const rowsQueued = [];
        return {
            rows: rowsQueued,
            add: async (row) => { rowsQueued.push({ _id: String(rowsQueued.length + 1), ...row }); },
            due: async (now) => rowsQueued.filter((row) => row.sendAfter <= new Date(now)),
            remove: async (id) => { rowsQueued.splice(rowsQueued.findIndex((row) => row._id === id), 1); },
            failed: async () => {},
            count: async () => rowsQueued.length,
        };
    };
    const DAY1 = Date.parse('2026-11-02T10:00:00Z');
    const DAY2 = Date.parse('2026-11-03T00:05:00Z');

    it('queues mail past the cap until the next UTC day, and always sends account mail', async () => {
        const held = queue();
        mailCap._useQueueForTests(held);
        await platformState.writeState('mail', { day: '2026-11-02', sent: 499 });
        await expect(mailCap.holdForTomorrow('to', { subject: 's', html: 'h', to: 'a@x.test' }, { now: DAY1 })).resolves.toBe(false);
        await expect(mailCap.holdForTomorrow('to', { subject: 's', html: 'h', to: 'b@x.test' }, { now: DAY1 })).resolves.toBe(true);
        await expect(mailCap.holdForTomorrow('to', { subject: 'reset', html: 'h', to: 'c@x.test' }, { now: DAY1, accountMail: true })).resolves.toBe(false);
        expect(held.rows).toHaveLength(1);
        expect(held.rows[0]).toMatchObject({ kind: 'to', to: 'b@x.test', sendAfter: new Date('2026-11-03T00:00:00Z') });
        expect(await mailCap.mailState(DAY1)).toMatchObject({ sentToday: 501, limit: 500, capped: true, queued: 1 });

        const deliver = jest.fn(async () => ({ status: true }));
        await expect(mailCap.flushQueue({ deliver, now: DAY1 })).resolves.toEqual({ sent: 0, left: 0 });
        await expect(mailCap.flushQueue({ deliver, now: DAY2 })).resolves.toEqual({ sent: 1, left: 0 });
        expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@x.test' }));
        expect(held.rows).toHaveLength(0);
        expect(await mailCap.sentToday(DAY2)).toBe(1);
        mailCap._useQueueForTests(null);
    });

    it('counts every recipient of a message', () => {
        expect(mailCap.countRecipients(['a@x.test', 'b@x.test'])).toBe(2);
        expect(mailCap.countRecipients('a@x.test, b@x.test;c@x.test')).toBe(3);
        expect(mailCap.countRecipients('')).toBe(1);
    });
});

describe('self-hosted behaves exactly as before', () => {
    beforeEach(async () => {
        await inMode('self', { state: 'suspended' });
        stored = 10 ** 15;
        workspaces = 500;
        rows.c1 = Array.from({ length: 500 }, (_, i) => seat(`m${i}`));
    });

    it('lets every request, seat, upload, workspace and tracker call through', async () => {
        expect((await call('POST', '/api/v2/sendInvitationEmail', { email: 'more@acme.test', role: ROLE_MEMBER })).body).toEqual({ status: true });
        expect((await call('POST', '/api/v1/importUser', { users: [{ email: 'x@y.test' }] })).body).toEqual({ status: true });
        expect((await call('POST', '/api/v2/company/create')).body).toEqual({ status: true });
        expect((await call('POST', '/api/v1/storage/uploadFileBase64', { companyId: 'c1', base64String: 'AAAA' })).body).toEqual({ status: true });
        expect((await call('POST', '/api/v1/auth/loginAuthTracker')).body).toEqual({ status: true });
        expect((await call('POST', '/api/v2/tasks')).body).toEqual({ status: true });
        expect(await guards.acceptanceRefusal({ email: 'z@z.test' })).toBeNull();
        expect(await guards.trackerSeatRefusal('m1')).toBeNull();
        expect(await uploads.uploadLimitRefusal('c1', 10 * GB)).toBeNull();
        expect(DEFAULT_LIMITS.fileSize).toBe(Number(process.env.UPLOAD_MAX_FILE_BYTES || 100 * MB));
        expect(lifecycleGuard.writable()).toBe(true);
    });

    it('never counts or holds mail', async () => {
        const held = queue();
        mailCap._useQueueForTests(held);
        await expect(mailCap.holdForTomorrow('to', { to: 'a@x.test' })).resolves.toBe(false);
        expect(held.rows).toHaveLength(0);
        expect(await platformState.readState('mail')).toBeNull();
        mailCap._useQueueForTests(null);
    });

    function queue() {
        const list = [];
        return { rows: list, add: async (row) => list.push(row), due: async () => [], remove: async () => {}, failed: async () => {}, count: async () => list.length };
    }
});
