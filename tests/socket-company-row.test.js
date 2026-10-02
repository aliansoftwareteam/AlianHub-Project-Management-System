const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => {
        const db = mockDbs[String(companyId)];
        return db ? db.crud(companyId, ...rest) : Promise.resolve(null);
    },
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/jwt', () => ({ resolveAccessSession: jest.fn(async () => ({ ok: true })) }));

const http = require('http');
const jwt = require('jsonwebtoken');
const { io: connectClient } = require('socket.io-client');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { forgetVerdicts } = require('../socket/roomAccess');
const { COMPANY_MEMBER_FIELDS, memberCompanyView } = require('../Modules/Company/helpers/companyAccessRules');

const SECRET = 'socket-company-row-secret';
const HOME = '6f00000000000000000c0c01';
const OWNER = '6f00000000000000000c0011';
const ADMIN = '6f00000000000000000c0012';
const MEMBER = '6f00000000000000000c0013';
const GUEST = '6f00000000000000000c0014';

const ROW = {
    _id: HOME,
    Cst_CompanyName: 'Acme',
    workingDays: [1, 2, 3, 4, 5],
    planFeature: { ai: true },
    projectCount: 4,
    billingDetails: { card: 'x' },
    aiProviderKeys: { openai: 'sec_1' },
    SubcriptionId: 'sub_1',
    customerId: 'cus_1',
    agentMonthlyBudgetUsd: 50,
};
const CHANGED = { projectCount: 4, 'planFeature.ai': true, customerId: 'cus_1', 'billingDetails.card': 'x' };

let server;
let baseURL;
const open = [];

const seat = (userId, roleType) => mockDbs[HOME].seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });

const connect = (uid) => new Promise((resolve, reject) => {
    const socket = connectClient(`${baseURL}/userid_${HOME}_${uid}`, {
        transports: ['websocket'],
        auth: { token: jwt.sign({ uid, aud: HOME }, SECRET) },
        query: { userRole: 3 },
        reconnection: false,
        forceNew: true,
    });
    open.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
});

const inCompanyRoom = (socket) => new Promise((resolve) => {
    socket.emit('joinCompaniesRoom', { roomName: `selected_companies_${HOME}**${socket.id}` }, ({ joined }) => resolve(joined));
});

const told = async (sockets, change) => {
    const got = sockets.map(() => []);
    sockets.forEach((socket, index) => socket.on('companiesUpdate', (payload) => got[index].push(payload)));
    socketEmitter.emit('update', change);
    await new Promise((resolve) => setTimeout(resolve, 300));
    sockets.forEach((socket) => socket.off('companiesUpdate'));
    return got;
};

const rowChanged = (updatedFields = CHANGED) => ({ type: 'update', module: 'companies', data: { data: ROW }, updatedFields });

beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const { initSocket } = require('../socket/socketinit');
    server = http.createServer();
    initSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
});

beforeEach(() => {
    myCache.flushAll();
    forgetVerdicts();
    mockDbs[HOME] = create();
    [[OWNER, 1], [ADMIN, 2], [MEMBER, 3], [GUEST, 0]].forEach(([userId, roleType]) => seat(userId, roleType));
});

afterEach(() => {
    open.splice(0).forEach((socket) => socket.close());
});

describe('a company update over the socket', () => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('carries the whole row to %s', async (_label, uid) => {
        const socket = await connect(uid);
        expect(await inCompanyRoom(socket)).toBe(true);
        const [[payload]] = await told([socket], rowChanged());
        expect(payload).toEqual({ fullDocument: ROW, updatedFields: CHANGED });
    });

    it.each([['a member', MEMBER], ['a guest', GUEST]])('carries the fields the company read gives to %s', async (_label, uid) => {
        const socket = await connect(uid);
        expect(await inCompanyRoom(socket)).toBe(true);
        const [[payload]] = await told([socket], rowChanged());
        expect(payload.fullDocument).toEqual(memberCompanyView(ROW));
        expect(payload.fullDocument).toEqual({ _id: HOME, Cst_CompanyName: 'Acme', workingDays: [1, 2, 3, 4, 5], planFeature: { ai: true }, projectCount: 4 });
        expect(payload.updatedFields).toEqual({ projectCount: 4, 'planFeature.ai': true });
    });

    it('names no field outside the company read in what changed, whatever shape the writer sent', async () => {
        const member = await connect(MEMBER);
        expect(await inCompanyRoom(member)).toBe(true);
        const [[payload]] = await told([member], rowChanged({ _doc: ROW, $__: { activePaths: {} }, ...ROW }));
        const named = [...Object.keys(payload.fullDocument), ...Object.keys(payload.updatedFields)];
        expect(named.filter((field) => !COMPANY_MEMBER_FIELDS.includes(field))).toEqual([]);
        expect(JSON.stringify(payload)).not.toMatch(/sec_1|cus_1|sub_1/);
    });

    it('sends each person their own form of one update', async () => {
        const owner = await connect(OWNER);
        const member = await connect(MEMBER);
        expect(await inCompanyRoom(owner)).toBe(true);
        expect(await inCompanyRoom(member)).toBe(true);
        const [forOwner, forMember] = await told([owner, member], rowChanged());
        expect(forOwner).toEqual([{ fullDocument: ROW, updatedFields: CHANGED }]);
        expect(forMember).toEqual([{ fullDocument: memberCompanyView(ROW), updatedFields: { projectCount: 4, 'planFeature.ai': true } }]);
    });

    it('follows a role that changed', async () => {
        const admin = await connect(ADMIN);
        expect(await inCompanyRoom(admin)).toBe(true);
        expect((await told([admin], rowChanged()))[0][0].fullDocument).toEqual(ROW);

        mockDbs[HOME].store[SCHEMA_TYPE.COMPANY_USERS].find((row) => row.userId === ADMIN).roleType = 3;
        myCache.flushAll();
        forgetVerdicts();
        expect((await told([admin], rowChanged()))[0][0].fullDocument).toEqual(memberCompanyView(ROW));
    });
});
