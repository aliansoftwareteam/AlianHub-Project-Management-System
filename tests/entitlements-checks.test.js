jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const checks = require('../Modules/Entitlements/checks');
const { seatHolders, judgeSeats, newcomers } = require('../Modules/Entitlements/seats');
const { lifecycleRefusal, socketEventRefusal } = require('../Modules/Entitlements/lifecycleGuard');
const { shapeUsage } = require('../Modules/Entitlements/planUsage');
const { refusalBody, formatBytes } = require('../Modules/Entitlements/answers');
const { SEAT_ACTIVE, SEAT_PENDING, SEAT_CANCELLED } = require('../Config/seatStatus');
const { ROLE_GUEST, ROLE_MEMBER } = require('../Config/roleTypes');

const GB = 1024 ** 3;

describe('the pure checks, below, at and above each limit', () => {
    it('seats', () => {
        expect(checks.canAddSeats({ activeSeats: 8, adding: 1, limit: 10 })).toEqual({ ok: true });
        expect(checks.canAddSeats({ activeSeats: 9, adding: 1, limit: 10 })).toEqual({ ok: true });
        expect(checks.canAddSeats({ activeSeats: 10, adding: 1, limit: 10 })).toEqual({ ok: false, code: 'seat_limit', limit: 10, used: 10 });
        expect(checks.canAddSeats({ activeSeats: 9, adding: 2, limit: 10 }).code).toBe('seat_limit');
        expect(checks.canAddSeats({ activeSeats: 12, adding: 0, limit: 10 }).ok).toBe(true);
        expect(checks.canAddSeats({ activeSeats: 5000, adding: 1, limit: null }).ok).toBe(true);
    });

    it('storage', () => {
        expect(checks.canStore({ usedBytes: 10, adding: 5, limit: 20 }).ok).toBe(true);
        expect(checks.canStore({ usedBytes: 15, adding: 5, limit: 20 }).ok).toBe(true);
        expect(checks.canStore({ usedBytes: 16, adding: 5, limit: 20 })).toEqual({ ok: false, code: 'storage_full', limit: 20, used: 16 });
        expect(checks.canStore({ usedBytes: 19, adding: 0, limit: 20 }).ok).toBe(true);
        expect(checks.canStore({ usedBytes: 20, adding: 0, limit: 20 }).code).toBe('storage_full');
        expect(checks.canStore({ usedBytes: 20 * GB, adding: GB, limit: undefined }).ok).toBe(true);
    });

    it('file size', () => {
        expect(checks.fileAllowed({ size: 49, maxFileBytes: 50 }).ok).toBe(true);
        expect(checks.fileAllowed({ size: 50, maxFileBytes: 50 }).ok).toBe(true);
        expect(checks.fileAllowed({ size: 51, maxFileBytes: 50 })).toEqual({ ok: false, code: 'file_too_large', limit: 50, used: 51 });
        expect(checks.fileAllowed({ size: 51, maxFileBytes: null }).ok).toBe(true);
    });

    it('workspaces', () => {
        expect(checks.canCreateWorkspace({ count: 1, limit: 3 }).ok).toBe(true);
        expect(checks.canCreateWorkspace({ count: 2, limit: 3 }).ok).toBe(true);
        expect(checks.canCreateWorkspace({ count: 3, limit: 3 })).toEqual({ ok: false, code: 'workspace_limit', limit: 3, used: 3 });
        expect(checks.canCreateWorkspace({ count: 40, limit: null }).ok).toBe(true);
    });

    it('tracker seats and the add-on', () => {
        expect(checks.canAssignTrackerSeat({ used: 18, limit: 20, enabled: true }).ok).toBe(true);
        expect(checks.canAssignTrackerSeat({ used: 19, limit: 20, enabled: true }).ok).toBe(true);
        expect(checks.canAssignTrackerSeat({ used: 20, limit: 20, enabled: true }).code).toBe('tracker_seat_limit');
        expect(checks.canAssignTrackerSeat({ used: 0, limit: 20, enabled: false }).code).toBe('tracker_disabled');
        expect(checks.canAssignTrackerSeat({ used: 99, limit: null }).ok).toBe(true);
    });

    it('daily mail', () => {
        expect(checks.canSendMail({ sentToday: 498, limit: 500 }).ok).toBe(true);
        expect(checks.canSendMail({ sentToday: 499, limit: 500 }).ok).toBe(true);
        expect(checks.canSendMail({ sentToday: 500, limit: 500 })).toEqual({ ok: false, code: 'mail_cap', limit: 500, used: 500 });
        expect(checks.canSendMail({ sentToday: 1e6, limit: null }).ok).toBe(true);
    });

    it('storage warning levels at 80, 95 and 100 per cent', () => {
        expect(checks.storageLevel({ usedBytes: 79, limit: 100 })).toBe(0);
        expect(checks.storageLevel({ usedBytes: 80, limit: 100 })).toBe(80);
        expect(checks.storageLevel({ usedBytes: 96, limit: 100 })).toBe(95);
        expect(checks.storageLevel({ usedBytes: 100, limit: 100 })).toBe(100);
        expect(checks.storageLevel({ usedBytes: 100, limit: null })).toBe(0);
    });
});

describe('refusals in words', () => {
    it('says the storage numbers the way the upload dialog shows them', () => {
        const body = refusalBody({ code: 'storage_full', limit: 150 * GB, used: 150 * GB });
        expect(body).toMatchObject({ status: false, code: 'storage_full', statusCode: 507, limit: 150 * GB, used: 150 * GB });
        expect(body.statusText).toBe('Storage is full (150 GB of 150 GB). Delete files or add storage.');
        expect(formatBytes(13.3 * GB)).toBe('13.3 GB');
    });

    it('gives API callers a real status through strictStatus', () => {
        expect(refusalBody({ code: 'seat_limit', limit: 10, used: 10 }).statusCode).toBe(403);
        expect(refusalBody({ code: 'file_too_large', limit: 1, used: 2 }).statusCode).toBe(413);
        expect(require('../Config/strictStatus').inferStatus(refusalBody({ code: 'workspace_limit', limit: 1, used: 1 }))).toBe(403);
    });
});

describe('seats across the whole instance', () => {
    const seat = (userId, extra = {}) => ({ userId, userEmail: `${userId}@acme.test`, status: SEAT_ACTIVE, roleType: ROLE_MEMBER, ...extra });

    it('counts a person once however many workspaces they are in, and leaves out the support account', () => {
        const snapshot = seatHolders([[seat('a'), seat('b'), seat('s')], [seat('a'), seat('c', { roleType: ROLE_GUEST })], [seat('b', { isTrackerUser: true })]], ['s']);
        expect(snapshot).toMatchObject({ members: 2, guests: 1, trackerUsers: 1 });
        expect(snapshot.trackerIds.has('b')).toBe(true);
    });

    it('counts invitations only for addresses holding no live seat', () => {
        const snapshot = seatHolders([[seat('a'), { userEmail: 'new@acme.test', status: SEAT_PENDING }, { userEmail: 'A@acme.test', status: SEAT_PENDING }, { userEmail: 'gone@acme.test', status: SEAT_CANCELLED }]]);
        expect(snapshot).toMatchObject({ members: 1, pendingMembers: 1 });
    });

    it('lets an existing member join a second workspace at the limit, and refuses an 11th person', () => {
        const rows = [Array.from({ length: 10 }, (_, i) => seat(`p${i}`))];
        const snapshot = seatHolders(rows);
        const limits = { seats: 10, guests: 5 };
        expect(judgeSeats(snapshot, [{ userId: 'p3', email: 'p3@acme.test' }], limits).ok).toBe(true);
        expect(judgeSeats(snapshot, [{ email: 'P3@acme.test' }], limits).ok).toBe(true);
        expect(judgeSeats(snapshot, [{ email: 'eleven@acme.test' }], limits)).toMatchObject({ ok: false, code: 'seat_limit', limit: 10, used: 10 });
    });

    it('counts open invitations when inviting, but not twice for the same address', () => {
        const snapshot = seatHolders([[...Array.from({ length: 9 }, (_, i) => seat(`p${i}`)), { userEmail: 'waiting@acme.test', status: SEAT_PENDING }]]);
        const limits = { seats: 10, guests: null };
        expect(judgeSeats(snapshot, [{ email: 'waiting@acme.test' }], limits, { includePending: true }).ok).toBe(true);
        expect(judgeSeats(snapshot, [{ email: 'another@acme.test' }], limits, { includePending: true }).code).toBe('seat_limit');
        expect(judgeSeats(snapshot, [{ email: 'another@acme.test' }], limits).ok).toBe(true);
    });

    it('counts guests against the guest limit, never against member seats', () => {
        const snapshot = seatHolders([[...Array.from({ length: 10 }, (_, i) => seat(`p${i}`)), ...Array.from({ length: 5 }, (_, i) => seat(`g${i}`, { roleType: ROLE_GUEST }))]]);
        expect(judgeSeats(snapshot, [{ email: 'guest@x.test', guest: true }], { seats: 10, guests: 6 }).ok).toBe(true);
        expect(judgeSeats(snapshot, [{ email: 'guest@x.test', guest: true }], { seats: 10, guests: 5 })).toMatchObject({ ok: false, code: 'seat_limit', guests: true, limit: 5 });
        expect(judgeSeats(snapshot, [{ email: 'guest@x.test', guest: true }], { seats: 10, guests: null }).ok).toBe(true);
    });

    it('counts a batch import once per distinct address', () => {
        const snapshot = seatHolders([[seat('a')]]);
        expect(newcomers(snapshot, [{ email: 'x@y.test' }, { email: 'X@y.test' }, { email: 'a@acme.test' }, { email: '' }])).toEqual({ members: 1, guests: 0 });
    });
});

describe('what read-only and suspended allow', () => {
    it('changes nothing while active or past due', () => {
        for (const state of ['active', 'past_due']) {
            expect(lifecycleRefusal('POST', '/api/v2/tasks', state)).toBeNull();
            expect(lifecycleRefusal('DELETE', '/api/v1/project/abc', state)).toBeNull();
        }
    });

    it('read-only: every read, sign-in, sign-out, refresh, two-factor, exports, the platform API and health', () => {
        const open = [
            ['GET', '/api/v2/tasks'], ['GET', '/api/v2/exports/abc/download'], ['POST', '/api/v2/auth/login'], ['POST', '/api/v2/logout'],
            ['POST', '/api/v2/generateToken'], ['POST', '/api/v2/auth/2fa/validate'], ['POST', '/api/v2/auth/2fa/setup'], ['POST', '/api/v1/auth/loginAuthTracker'],
            ['POST', '/api/v2/exports'], ['POST', '/api/v2/exports/workspace'], ['POST', '/api/v1/export/pdf'], ['POST', '/api/v1/timesheet/export-csv'],
            ['POST', '/api/v2/platform/lifecycle'], ['PUT', '/api/v2/platform/entitlements'], ['GET', '/health'], ['POST', '/api/v1/mongoOpration'],
            ['POST', '/api/v1/task/find'], ['POST', '/api/v2/search'], ['POST', '/api/v1/advance/filter/search/tasks'], ['DELETE', '/api/v2/session/delete/abc'],
            ['POST', '/mcp'], ['POST', '/oauth/token'], ['GET', '/login'], ['POST', '/js/app.js'],
        ];
        for (const [method, path] of open) expect([method, path, lifecycleRefusal(method, path, 'read_only')]).toEqual([method, path, null]);
    });

    it('read-only: every other write is refused', () => {
        const refused = [
            ['POST', '/api/v2/tasks'], ['PUT', '/api/v1/members'], ['PATCH', '/api/v2/auth/abc/change-password'], ['DELETE', '/api/v1/project/abc'],
            ['POST', '/api/v1/wasabi/uploadFile'], ['POST', '/api/v2/sendInvitationEmail'], ['POST', '/api/v2/company/create'], ['PUT', '/api/v2/instance/settings'],
            ['POST', '/api/v1/email-in/token123'], ['POST', '/scim/v2/Users'], ['POST', '/form/abc'], ['POST', '/api/v2/checkPermission'],
        ];
        for (const [method, path] of refused) expect([method, path, lifecycleRefusal(method, path, 'read_only')]).toEqual([method, path, 'read_only']);
    });

    it('read-only: the instance console answers the platform key', () => {
        expect(lifecycleRefusal('PUT', '/api/v2/instance/settings', 'read_only', { platformKey: true })).toBeNull();
    });

    it('suspended: only the platform API, health and the public config', () => {
        expect(lifecycleRefusal('POST', '/api/v2/platform/lifecycle', 'suspended')).toBeNull();
        expect(lifecycleRefusal('GET', '/api/v2/platform/usage', 'suspended')).toBeNull();
        expect(lifecycleRefusal('GET', '/health', 'suspended')).toBeNull();
        expect(lifecycleRefusal('GET', '/api/v2/instance/public-config', 'suspended')).toBeNull();
        expect(lifecycleRefusal('GET', '/login', 'suspended')).toBeNull();
        for (const [method, path] of [['GET', '/api/v2/tasks'], ['POST', '/api/v2/auth/login'], ['POST', '/api/v2/exports'], ['GET', '/api/v2/instance/health'], ['POST', '/mcp']]) {
            expect([method, path, lifecycleRefusal(method, path, 'suspended')]).toEqual([method, path, 'suspended']);
        }
    });

    it('drops every client socket event while suspended, none while read-only', () => {
        expect(socketEventRefusal('joinChats', 'suspended')).toBe('suspended');
        expect(socketEventRefusal('disconnectNameSpace', 'suspended')).toBeNull();
        expect(socketEventRefusal('call:end', 'read_only')).toBeNull();
        expect(socketEventRefusal('joinChats', 'active')).toBeNull();
    });
});

describe('the Plan & usage numbers', () => {
    const report = {
        seats: { active: 27, pending: 2, guests: 4 },
        storage: { bytes: 144 * GB, byWorkspace: [{ companyId: 'c1', name: 'Acme', bytes: 140 * GB }] },
        workspaces: { count: 2 },
        timeTracker: { seatsUsed: 8 },
    };
    const plan = {
        plan: 'pro', version: 7, portalUrl: 'https://account.alianhub.com/i/ins_x',
        limits: { seats: 60, guests: 25, workspaces: 3, storageBytes: 150 * GB, maxFileBytes: 100 * 1024 * 1024, emailsPerDay: 2000 },
        timeTracker: { enabled: true, seats: 20 },
    };
    const mail = { sentToday: 140, queued: 0, capped: false };

    it('shows members (not guests) against seats and the storage warning level', () => {
        const shaped = shapeUsage(report, plan, mail, { state: 'active' }, { privileged: true });
        expect(shaped).toMatchObject({
            seats: { used: 23, pending: 2, limit: 60, overLimit: false },
            guests: { used: 4, limit: 25 },
            storage: { bytes: 144 * GB, level: 95, byWorkspace: [{ name: 'Acme' }] },
            workspaces: { count: 2, limit: 3 },
            timeTracker: { enabled: true, used: 8, limit: 20 },
            mail: { sentToday: 140, limit: 2000, capped: false },
            canManage: true,
        });
    });

    it('leaves the split by workspace to owners and admins', () => {
        const shaped = shapeUsage(report, plan, mail, { state: 'active' }, { privileged: false });
        expect(shaped.storage.byWorkspace).toBeUndefined();
        expect(shaped.canManage).toBe(false);
    });

    it('flags seats over the limit after a downgrade', () => {
        const shaped = shapeUsage(report, { ...plan, limits: { ...plan.limits, seats: 10 } }, mail, { state: 'active' });
        expect(shaped.seats).toMatchObject({ used: 23, limit: 10, overLimit: true });
    });
});
