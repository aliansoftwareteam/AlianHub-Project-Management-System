const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { generateToken, hashToken } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const { signSession, startApp } = require('./fixtures/sessionApp');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const AUTHOR = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000a02';
const ADMIN = '6f0000000000000000000a03';
const MEMBER = '6f0000000000000000000a04';
const GUEST = '6f0000000000000000000a05';
const OUTSIDER = '6f0000000000000000000a06';
const TASK = '6f0000000000000000000b01';
const SEATS = { [AUTHOR]: 3, [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

let app;
let note;

const notes = (companyId = COMPANY) => mockDbFor(companyId).store[SCHEMA_TYPE.NOTES] || [];
const stored = () => notes().find((row) => String(row._id) === String(note._id));

const seedSeat = (companyId, userId, roleType) => {
    mockDbFor(SCHEMA_TYPE.GOLBAL).seed(SCHEMA_TYPE.USERS, { _id: userId, AssignCompany: [companyId] });
    mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
};

const mintToken = (userId, extra = {}) => {
    const raw = generateToken();
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.API_TOKENS, { userId, tokenHash: hashToken(raw), active: true, scopes: ['read', 'write'], createdAt: new Date(), ...extra });
    return raw;
};

const CALLERS = {
    'the workspace owner': () => signSession(OWNER, [COMPANY]),
    'a workspace admin': () => signSession(ADMIN, [COMPANY]),
    'another member': () => signSession(MEMBER, [COMPANY]),
    'a guest': () => signSession(GUEST, [COMPANY]),
    'another member\'s API token': () => mintToken(MEMBER),
    'another member\'s agent token': () => mintToken(MEMBER, { agentId: 'agent-1' }),
};

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        require('../Modules/Notes/routes').init(server);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    [COMPANY, OTHER_COMPANY].forEach((companyId) => mockDbFor(SCHEMA_TYPE.GOLBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: companyId }));
    Object.entries(SEATS).forEach(([userId, roleType]) => seedSeat(COMPANY, userId, roleType));
    seedSeat(OTHER_COMPANY, OUTSIDER, 1);
    note = mockDbFor(COMPANY).seed(SCHEMA_TYPE.NOTES, { _id: '6f0000000000000000000d01', userId: AUTHOR, companyId: COMPANY, title: 'Mine', content: 'Private', convertedTaskId: '', deletedStatusKey: 0 });
});

describe('a note is changed only by the person it belongs to', () => {
    it('lets its author edit, archive, stamp and delete it', async () => {
        const token = signSession(AUTHOR, [COMPANY]);
        const path = `/api/v1/notes/${note._id}`;

        expect((await app.call('PATCH', path, { token, companyId: COMPANY, body: { title: 'Renamed' } })).body.status).toBe(true);
        expect((await app.call('PATCH', path, { token, companyId: COMPANY, body: { convertedTaskId: TASK } })).body.status).toBe(true);
        expect((await app.call('PATCH', path, { token, companyId: COMPANY, body: { archived: true } })).body.status).toBe(true);
        expect(stored()).toMatchObject({ title: 'Renamed', convertedTaskId: TASK, deletedStatusKey: 2, userId: AUTHOR });

        expect((await app.call('PATCH', path, { token, companyId: COMPANY, body: { archived: false } })).body.status).toBe(true);
        expect((await app.call('DELETE', path, { token, companyId: COMPANY })).body.status).toBe(true);
        expect(stored().deletedStatusKey).toBe(1);
    });

    it('lets the author work on it with their own API token', async () => {
        const res = await app.call('PATCH', `/api/v1/notes/${note._id}`, { token: mintToken(AUTHOR), companyId: COMPANY, body: { title: 'By token' } });
        expect(res.body.status).toBe(true);
        expect(stored().title).toBe('By token');
    });

    it.each(Object.keys(CALLERS))('answers %s as if the note did not exist', async (caller) => {
        const token = CALLERS[caller]();
        const path = `/api/v1/notes/${note._id}`;
        const bodies = [{ title: 'Changed' }, { content: 'Changed' }, { convertedTaskId: TASK }, { archived: true }];
        for (const body of bodies) {
            // eslint-disable-next-line no-await-in-loop
            const res = await app.call('PATCH', path, { token, companyId: COMPANY, body });
            expect(res.status).toBe(404);
        }
        expect((await app.call('DELETE', path, { token, companyId: COMPANY })).status).toBe(404);
        expect(stored()).toMatchObject({ title: 'Mine', content: 'Private', convertedTaskId: '', deletedStatusKey: 0 });
    });

    it('refuses a caller with no session, and one from another workspace', async () => {
        const path = `/api/v1/notes/${note._id}`;
        expect((await app.call('PATCH', path, { companyId: COMPANY, body: { title: 'Changed' } })).status).toBe(401);
        expect((await app.call('DELETE', path, { companyId: COMPANY })).status).toBe(401);
        const outsider = signSession(OUTSIDER, [OTHER_COMPANY]);
        expect((await app.call('PATCH', path, { token: outsider, companyId: COMPANY, body: { title: 'Changed' } })).status).toBe(401);
        expect((await app.call('PATCH', path, { token: outsider, companyId: OTHER_COMPANY, body: { title: 'Changed' } })).status).toBe(404);
        expect(stored().title).toBe('Mine');
    });

    it('does not bring a deleted note back', async () => {
        const token = signSession(AUTHOR, [COMPANY]);
        const path = `/api/v1/notes/${note._id}`;
        await app.call('DELETE', path, { token, companyId: COMPANY });
        expect((await app.call('PATCH', path, { token, companyId: COMPANY, body: { archived: false } })).status).toBe(404);
        expect(stored().deletedStatusKey).toBe(1);
    });

    it.each([
        ['a note id that is not an id', 'not-an-id', { title: 'x' }],
        ['a task stamp that is not an id', null, { convertedTaskId: 'PRJ-1' }],
        ['a task stamp that is an object', null, { convertedTaskId: { $ne: '' } }],
    ])('answers 400 to %s', async (label, id, body) => {
        const res = await app.call('PATCH', `/api/v1/notes/${id || note._id}`, { token: signSession(AUTHOR, [COMPANY]), companyId: COMPANY, body });
        expect(res.status).toBe(400);
        expect(stored()).toMatchObject({ title: 'Mine', convertedTaskId: '' });
    });

    it('records and lists notes for the signed-in person whatever the body or headers name', async () => {
        const token = signSession(MEMBER, [COMPANY]);
        const created = await app.call('POST', '/api/v1/notes', { token, companyId: COMPANY, body: { title: 'Theirs', userId: AUTHOR, userData: { id: AUTHOR } } });
        expect(created.body.data.userId).toBe(MEMBER);
        const listed = await app.call('GET', '/api/v1/notes', { token, companyId: COMPANY });
        expect(listed.body.data.map((row) => row.title)).toEqual(['Theirs']);
    });
});
