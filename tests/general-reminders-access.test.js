const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/GeneralReminders/queue', () => ({ enqueue: jest.fn(async () => ({})), dequeue: jest.fn(async () => ({})) }));
jest.mock('../Modules/GeneralReminders/attachmentResolver', () => ({ buildMailAttachments: jest.fn(async () => []) }));
jest.mock('../Modules/service.js', () => ({ sendAttachMail: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const ctrl = require('../Modules/GeneralReminders/controller');

const C = '6f0000000000000000000c01';
const AUTHOR = '6f0000000000000000000a03';
const ASSIGNEE = '6f0000000000000000000a05';
const INVITED = '6f0000000000000000000a06';
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
    await handler({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid: AUTHOR, ...over }, r);
    return r;
};
const rows = () => mockDb.store[SCHEMA_TYPE.GENERAL_REMINDERS] || [];
const future = () => new Date(Date.now() + 86400000).toISOString();
const seedAssigned = () => mockDb.seed(SCHEMA_TYPE.GENERAL_REMINDERS, {
    _id: REMINDER, title: 'for you', userId: ASSIGNEE, createdBy: AUTHOR, companyId: C,
    remindAt: new Date(future()), notifyBefore: -1, fired: false, isDone: false, deletedStatusKey: 0,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: AUTHOR, status: 2 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ASSIGNEE, status: 2 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITED, status: 1 });
});

describe('MSG-07 assignedTo must be an active company member', () => {
    it('refuses an id that is not a member', async () => {
        const r = await call(ctrl.createReminder, { body: { title: 't', remindAt: future(), notifyBefore: -1, assignedTo: '000000000000000000000000' } });
        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
        expect(rows()).toHaveLength(0);
    });

    it('refuses a member whose invitation is still pending', async () => {
        const r = await call(ctrl.createReminder, { body: { title: 't', remindAt: future(), notifyBefore: -1, assignedTo: INVITED } });
        expect(r.body.status).toBe(false);
        expect(rows()).toHaveLength(0);
    });

    it('creates a reminder for an active member', async () => {
        const r = await call(ctrl.createReminder, { body: { title: 't', remindAt: future(), notifyBefore: -1, assignedTo: ASSIGNEE } });
        expect(r.body.status).toBe(true);
        expect(rows()[0]).toMatchObject({ userId: ASSIGNEE, createdBy: AUTHOR });
    });

    it('refuses reassigning to a non-member', async () => {
        seedAssigned();
        const r = await call(ctrl.updateReminder, { uid: ASSIGNEE, params: { id: REMINDER }, body: { assignedTo: '000000000000000000000000' } });
        expect(r.body.status).toBe(false);
        expect(rows()[0].userId).toBe(ASSIGNEE);
    });
});

describe('MSG-04 an author cannot manage a reminder raised for someone else, and is told so', () => {
    it('refuses the author editing it', async () => {
        seedAssigned();
        const r = await call(ctrl.updateReminder, { params: { id: REMINDER }, body: { title: 'changed' } });
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(rows()[0].title).toBe('for you');
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('refuses the author deleting it', async () => {
        seedAssigned();
        const r = await call(ctrl.deleteReminder, { params: { id: REMINDER } });
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(rows()[0].deletedStatusKey).toBe(0);
    });

    it('answers 404 rather than success for an id that matches nothing', async () => {
        const edit = await call(ctrl.updateReminder, { params: { id: '6f0000000000000000000b99' }, body: { title: 'x' } });
        const remove = await call(ctrl.deleteReminder, { params: { id: '6f0000000000000000000b99' } });
        expect([edit.code, edit.body.status]).toEqual([404, false]);
        expect([remove.code, remove.body.status]).toEqual([404, false]);
    });

    it('answers 400 for a malformed id', async () => {
        const r = await call(ctrl.deleteReminder, { params: { id: 'nope' } });
        expect([r.code, r.body.status]).toEqual([400, false]);
    });

    it('still lets the assignee edit and delete it', async () => {
        seedAssigned();
        const edit = await call(ctrl.updateReminder, { uid: ASSIGNEE, params: { id: REMINDER }, body: { title: 'mine now' } });
        expect(edit.body.status).toBe(true);
        expect(rows()[0].title).toBe('mine now');
        const remove = await call(ctrl.deleteReminder, { uid: ASSIGNEE, params: { id: REMINDER } });
        expect(remove.body.status).toBe(true);
        expect(rows()[0].deletedStatusKey).toBe(1);
    });
});
