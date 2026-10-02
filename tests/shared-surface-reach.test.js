process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
const mockSecrets = jest.fn(async () => ({ verification_token: 'slack-token' }));

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/AI/meetingNotes', () => ({ generateMeetingNotes: jest.fn(async () => ({ status: true, data: { summary: 's', actionItems: [] } })) }));
jest.mock('../Modules/Integrations/helpers/secretHandles', () => ({ openSecrets: (...args) => mockSecrets(...args) }));
jest.mock('../common-storage/common-server.js', () => ({ handleStoredFileCopy: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const ME = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';
const LEFT = 'a00000000000000000000005';
const STRANGER = 'a00000000000000000000006';
const oid = () => new mongoose.Types.ObjectId().toString();

const call = async (handler, { uid = ME, params = {}, body = {}, query = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    await handler(verified({ uid, params, body, query, headers: { companyid: C } }), res);
    return res;
};

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ME, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OTHER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEFT, roleType: 3, status: 3, isDelete: true });
});

describe('call notes are shared with members of the workspace', () => {
    const notes = require('../Modules/Calls/notes');

    it('keeps the caller and the active members named, and no one else', async () => {
        const res = await call(notes.createNotes, { body: { callId: 'call-1', participants: [OTHER, LEFT, STRANGER, { $ne: '' }, 'everyone'] } });
        expect(res.body).toMatchObject({ status: true });
        expect(mockDb.store[SCHEMA_TYPE.CALLS][0].participants.sort()).toEqual([ME, OTHER].sort());
    });

    it('keeps the caller when nobody else is named', async () => {
        await call(notes.createNotes, { body: { callId: 'call-2' } });
        expect(mockDb.store[SCHEMA_TYPE.CALLS][0].participants).toEqual([ME]);
    });
});

describe('a comment search filter cannot run code or reach another collection', () => {
    const { searchComments } = require('../Modules/Comments/controller');

    it.each([
        ['a script', { $expr: { $function: { body: 'function () { return true; }', args: [], lang: 'js' } } }],
        ['a where clause', { $where: 'true' }],
        ['an accumulator', { $expr: { $accumulator: {} } }],
        ['a join', { $or: [{ $lookup: { from: 'projects' } }] }],
        ['a script in a text filter', JSON.stringify({ $where: 'true' })],
        ['text that is not a filter', '{not json'],
        ['a list', [{ $where: 'true' }]],
    ])('answers 400 to %s and reads nothing', async (_label, filterQuery) => {
        const res = await call(searchComments, { body: { pids: [oid()], filterQuery } });
        expect(res.statusCode).toBe(400);
        expect(mockDb.crud.mock.calls.some(([, { type }, method]) => type === SCHEMA_TYPE.COMMENTS && method === 'aggregate')).toBe(false);
    });
});

describe('the Slack projects command names the projects every member can open', () => {
    const integrations = require('../Modules/Integrations/controller');

    it('lists live projects that are open to the workspace, and no other', async () => {
        mockDb.seed(SCHEMA_TYPE.INTEGRATION_CONNECTIONS, { type: 'slack', enabled: true, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board matters', isPrivateSpace: true, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'My own list', isPrivateSpace: false, isPersonal: true, personalOwner: OTHER, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Deleted one', isPrivateSpace: false, deletedStatusKey: 1 });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Archived one', isPrivateSpace: false, deletedStatusKey: 2 });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Closed one', isPrivateSpace: false, deletedStatusKey: 0, status: 'close' });

        const res = await call(integrations.slackCommand, { params: { companyId: C }, body: { token: 'slack-token', text: 'projects' } });
        expect(res.body.text).toContain('Launch');
        expect(res.body.text).not.toMatch(/Board matters|My own list|Deleted one|Archived one|Closed one/);
    });
});
