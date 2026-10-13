const fs = require('fs');
const path = require('path');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})) }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => ({ '6f0000000000000000000a01': 1, '6f0000000000000000000a02': 2, '6f0000000000000000000a03': 3, '6f0000000000000000000a04': 0 }[uid] ?? null)),
    isPrivileged: (r) => r === 1 || r === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Reminders/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const REMINDER = '6f0000000000000000000b01';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    return r;
};
const call = async (handler, over = {}) => {
    const r = res();
    await handler({ headers: { companyid: C }, params: {}, query: {}, body: {}, ...over }, r);
    return r;
};
const reminders = () => mockDb.store[SCHEMA_TYPE.REMINDERS] || [];
const notifications = () => mockDb.calls.filter((c) => c.method === 'save' && c.companyId === C && c.type === SCHEMA_TYPE.NOTIFICATIONS);
const seedMemberReminder = () => mockDb.seed(SCHEMA_TYPE.REMINDERS, {
    _id: REMINDER, userId: MEMBER, createdBy: MEMBER, companyId: C, reminderText: 'mine',
    reminderAt: new Date(Date.now() - 1000), fired: false, deletedStatusKey: 0,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
});

describe('MSG-01 task reminders need a session', () => {
    it('lists /api/v1/reminders behind the company JWT guard', () => {
        const source = fs.readFileSync(path.join(__dirname, '../Config/setMiddleware.js'), 'utf8');
        const guarded = source.slice(source.indexOf('const verifyJWTTokenWithCRoute'), source.indexOf('const verifyJWTToken ='));
        expect(guarded).toMatch(/["']\/api\/v1\/reminders["']/);
    });
});

describe('MSG-01 the acting user comes from the session', () => {
    it('creates the reminder for req.uid, not the userid header or body', async () => {
        const r = await call(ctrl.createReminder, {
            uid: MEMBER, headers: { companyid: C, userid: GUEST },
            body: { userId: GUEST, reminderAt: '2030-01-01T00:00:00Z', reminderText: 'x' },
        });
        expect(r.body.status).toBe(true);
        expect(reminders()).toHaveLength(1);
        expect(reminders()[0].userId).toBe(MEMBER);
        expect(reminders()[0].createdBy).toBe(MEMBER);
    });

    it('lists only the caller\'s reminders whatever the userid header says', async () => {
        seedMemberReminder();
        const r = await call(ctrl.listMine, { uid: GUEST, headers: { companyid: C, userid: MEMBER } });
        expect(r.body.status).toBe(true);
        expect(r.body.data).toEqual([]);
    });

    it('refuses a malformed task id with 400', async () => {
        const r = await call(ctrl.createReminder, { uid: MEMBER, body: { reminderAt: '2030-01-01T00:00:00Z', taskId: 'nope' } });
        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
    });
});

describe('MSG-01 only the author, the assignee or an owner/admin manages a reminder', () => {
    it('refuses another member editing it', async () => {
        seedMemberReminder();
        const r = await call(ctrl.updateReminder, { uid: GUEST, params: { id: REMINDER }, body: { reminderText: 'hijacked' } });
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(reminders()[0].reminderText).toBe('mine');
    });

    it('refuses another member deleting it', async () => {
        seedMemberReminder();
        const r = await call(ctrl.deleteReminder, { uid: GUEST, params: { id: REMINDER } });
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(reminders()[0].deletedStatusKey).toBe(0);
    });

    it('refuses another member firing it', async () => {
        seedMemberReminder();
        const r = await call(ctrl.runNow, { uid: GUEST, params: { id: REMINDER } });
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(notifications()).toHaveLength(0);
        expect(reminders()[0].fired).toBe(false);
    });

    it('lets the author edit, fire and delete it', async () => {
        seedMemberReminder();
        expect((await call(ctrl.updateReminder, { uid: MEMBER, params: { id: REMINDER }, body: { reminderText: 'edited' } })).body.status).toBe(true);
        expect(reminders()[0].reminderText).toBe('edited');
        expect((await call(ctrl.runNow, { uid: MEMBER, params: { id: REMINDER } })).body.status).toBe(true);
        expect(notifications()).toHaveLength(1);
        expect((await call(ctrl.deleteReminder, { uid: MEMBER, params: { id: REMINDER } })).body.status).toBe(true);
        expect(reminders()[0].deletedStatusKey).toBe(1);
    });

    it('lets a company owner edit a member\'s reminder', async () => {
        seedMemberReminder();
        const r = await call(ctrl.updateReminder, { uid: OWNER, params: { id: REMINDER }, body: { reminderText: 'by owner' } });
        expect(r.body.status).toBe(true);
        expect(reminders()[0].reminderText).toBe('by owner');
    });

    it('answers 404 for a reminder that does not exist', async () => {
        const r = await call(ctrl.deleteReminder, { uid: MEMBER, params: { id: '6f0000000000000000000b99' } });
        expect(r.code).toBe(404);
        expect(r.body.status).toBe(false);
    });

    it('answers 400 for a malformed id instead of throwing', async () => {
        const r = await call(ctrl.updateReminder, { uid: MEMBER, params: { id: 'nope' }, body: { reminderText: 'x' } });
        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
    });

    it('keeps the company-wide run-due to owners and admins', async () => {
        seedMemberReminder();
        const byMember = await call(ctrl.runDueForCompany, { uid: MEMBER });
        expect(byMember.code).toBe(403);
        expect(notifications()).toHaveLength(0);
        const byAdmin = await call(ctrl.runDueForCompany, { uid: ADMIN });
        expect(byAdmin.body.status).toBe(true);
        expect(notifications()).toHaveLength(1);
    });
});
