process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/GeneralReminders/queue', () => ({ enqueue: jest.fn(async () => ({})), dequeue: jest.fn(async () => ({})) }));
jest.mock('../Modules/GeneralReminders/attachmentResolver', () => ({ buildMailAttachments: jest.fn(async () => []) }));
jest.mock('../Modules/service.js', () => ({ sendAttachMail: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { REMINDERS_FOR_OTHERS_PER_HOUR, forgetRemindersForOthers } = require('../Modules/GeneralReminders/remindOthersLimit');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const TEAMMATE = '6f0000000000000000000a04';
const STRANGER = '6f0000000000000000000a05';
const LEFT = '6f0000000000000000000a06';
const INVITED = '6f0000000000000000000a07';
const SEATS = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [TEAMMATE]: 3, [STRANGER]: 3 };
const oid = () => new mongoose.Types.ObjectId().toString();

let app;

const company = () => mockDbFor(COMPANY);
const reminders = () => company().store[SCHEMA_TYPE.GENERAL_REMINDERS] || [];
const soon = () => new Date(Date.now() + 86400000).toISOString();
const session = (uid) => signSession(uid, [COMPANY]);
const setReminder = (uid, body) => app.call('POST', '/api/v1/general-reminders', { token: session(uid), companyId: COMPANY, body: { title: 'Send the report', remindAt: soon(), ...body } });
const change = (uid, id, body) => app.call('PATCH', `/api/v1/general-reminders/${id}`, { token: session(uid), companyId: COMPANY, body });

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        require('../Modules/GeneralReminders/routes').init(server);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    forgetRemindersForOthers();
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    mockDbFor(dbCollections.GLOBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY });
    Object.entries(SEATS).forEach(([userId, roleType]) => company().seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    company().seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEFT, roleType: 3, status: 2, isDelete: true });
    company().seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITED, roleType: 3, status: 1, isDelete: false });
    company().seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [MEMBER, TEAMMATE, LEFT] });
    company().seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [STRANGER] });
});

describe('who a reminder can be set for', () => {
    it('lets a member set one for themself', async () => {
        const res = await setReminder(MEMBER, {});
        expect(res.body).toMatchObject({ status: true });
        expect(reminders()[0]).toMatchObject({ userId: MEMBER, createdBy: MEMBER });
    });

    it('lets a member set one for someone on a project they share', async () => {
        const res = await setReminder(MEMBER, { assignedTo: TEAMMATE });
        expect(res.body).toMatchObject({ status: true });
        expect(reminders()[0]).toMatchObject({ userId: TEAMMATE, createdBy: MEMBER });
    });

    it('answers 403 to a member naming someone they share no project with', async () => {
        const res = await setReminder(MEMBER, { assignedTo: STRANGER });
        expect(res.status).toBe(403);
        expect(res.body.statusText).toMatch(/share a project/);
        expect(reminders()).toHaveLength(0);
    });

    it.each([['the owner', OWNER], ['an admin', ADMIN]])('lets %s set one for anyone in the workspace', async (_label, uid) => {
        const res = await setReminder(uid, { assignedTo: STRANGER });
        expect(res.body).toMatchObject({ status: true });
        expect(reminders()[0]).toMatchObject({ userId: STRANGER, createdBy: uid });
    });

    it.each([
        ['someone who left the workspace', LEFT],
        ['someone whose invitation is still open', INVITED],
        ['someone of no workspace', '6f0000000000000000000a99'],
    ])('answers 400 when %s is named, whoever asks', async (_label, named) => {
        for (const uid of [OWNER, MEMBER]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await setReminder(uid, { assignedTo: named });
            expect(res.status).toBe(400);
        }
        expect(reminders()).toHaveLength(0);
    });

    it('holds the same rule when a reminder is handed to someone else', async () => {
        const id = (await setReminder(MEMBER, {})).body.data._id;
        expect((await change(MEMBER, id, { assignedTo: STRANGER })).status).toBe(403);
        expect((await change(MEMBER, id, { assignedTo: LEFT })).status).toBe(400);
        expect(reminders()[0].userId).toBe(MEMBER);
        expect((await change(MEMBER, id, { assignedTo: TEAMMATE })).body).toMatchObject({ status: true });
        expect(reminders()[0].userId).toBe(TEAMMATE);
    });
});

describe('how many reminders one person sets for other people in an hour', () => {
    it('stops at the hourly number, and leaves their own reminders alone', async () => {
        for (let n = 0; n < REMINDERS_FOR_OTHERS_PER_HOUR; n += 1) {
            // eslint-disable-next-line no-await-in-loop
            expect((await setReminder(MEMBER, { assignedTo: TEAMMATE })).body).toMatchObject({ status: true });
        }
        const over = await setReminder(MEMBER, { assignedTo: TEAMMATE });
        expect(over.status).toBe(429);
        expect(over.body).toMatchObject({ status: false });
        expect(reminders()).toHaveLength(REMINDERS_FOR_OTHERS_PER_HOUR);

        const own = (await setReminder(MEMBER, {})).body;
        expect(own).toMatchObject({ status: true });
        expect((await change(MEMBER, own.data._id, { assignedTo: TEAMMATE })).status).toBe(429);
        expect((await setReminder(OWNER, { assignedTo: TEAMMATE })).body).toMatchObject({ status: true });
    });

    it('does not count a request that was refused', async () => {
        for (let n = 0; n < REMINDERS_FOR_OTHERS_PER_HOUR + 2; n += 1) {
            // eslint-disable-next-line no-await-in-loop
            expect((await setReminder(MEMBER, { assignedTo: STRANGER })).status).toBe(403);
        }
        expect((await setReminder(MEMBER, { assignedTo: TEAMMATE })).body).toMatchObject({ status: true });
    });
});
