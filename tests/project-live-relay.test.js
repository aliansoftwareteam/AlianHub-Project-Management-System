const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
let mockRules = [];
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => {
        const db = mockDbs[String(companyId)];
        return db ? db.crud(companyId, ...rest) : Promise.resolve(null);
    },
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => mockRules) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const helper = require('../socket/helper');
const { forgetVerdicts } = require('../socket/roomAccess');
const { relay, EVENT } = require('../socket/controller/projectSocket');

const C = '6f00000000000000000b0c01';
const OTHER_COMPANY = '6f00000000000000000b0c02';
const OWNER = '6f00000000000000000b0011';
const ADMIN = '6f00000000000000000b0012';
const ON_IT = '6f00000000000000000b0013';
const NOT_ON_IT = '6f00000000000000000b0014';
const GUEST = '6f00000000000000000b0015';
const UNSEATED = '6f00000000000000000b0016';
const STRANGER = '6f00000000000000000b0017';

const SEE_EVERY_PRIVATE_PROJECT = [
    { _id: 'rule-project', key: 'project', isParent: true, roles: [] },
    { _id: 'rule-private', key: 'private_projects', isParent: false, parentId: 'rule-project', roles: [{ key: 3, permission: 2 }] },
];

const joined = [];
const seat = (companyId, uid, socketId, { inRoom = true } = {}) => {
    const emit = jest.fn();
    const toRoom = jest.fn();
    const roomName = `selected_companies_${companyId}**${socketId}`;
    const socket = { id: socketId, rooms: new Set(inRoom ? [roomName] : []), identity: { companyId, uid }, emit };
    helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit: toRoom })) } });
    joined.push(roomName);
    return { emit, toRoom };
};

const change = (project, { type = 'update', companyId = C, updatedFields = {}, data = {} } = {}) => ({
    type, module: 'project', companyId, updatedFields, data: { ...project, ...data },
});

const projectReads = () => mockDbs[C].calls.filter((call) => call.type === SCHEMA_TYPE.PROJECTS && call.method === 'findOne').length;

let sockets;
let projects;

beforeEach(() => {
    myCache.flushAll();
    forgetVerdicts();
    mockRules = [];
    mockDbs[C] = create();
    mockDbs[OTHER_COMPANY] = create();
    [[OWNER, 1], [ADMIN, 2], [ON_IT, 3], [NOT_ON_IT, 3], [GUEST, 0]].forEach(([userId, roleType]) => {
        mockDbs[C].seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    [[STRANGER, 1], [ON_IT, 3]].forEach(([userId, roleType]) => {
        mockDbs[OTHER_COMPANY].seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    projects = {
        closed: mockDbs[C].seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Acquisition of Borealis', isPrivateSpace: true, AssigneeUserId: [ON_IT] }),
        open: mockDbs[C].seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Website', isPrivateSpace: false, AssigneeUserId: [] }),
        personal: mockDbs[C].seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'My list', isPrivateSpace: true, isPersonal: true, personalOwner: NOT_ON_IT, AssigneeUserId: [NOT_ON_IT] }),
    };
    sockets = {
        owner: seat(C, OWNER, 's-owner'),
        admin: seat(C, ADMIN, 's-admin'),
        onIt: seat(C, ON_IT, 's-on-it'),
        onItSecondTab: seat(C, ON_IT, 's-on-it-2'),
        notOnIt: seat(C, NOT_ON_IT, 's-not-on-it'),
        guest: seat(C, GUEST, 's-guest'),
        unseated: seat(C, UNSEATED, 's-unseated'),
        stranger: seat(OTHER_COMPANY, STRANGER, 's-stranger'),
        onItElsewhere: seat(OTHER_COMPANY, ON_IT, 's-on-it-elsewhere'),
    };
});

afterEach(() => joined.splice(0).forEach((roomName) => helper.removeRoom(roomName)));

const told = (...who) => who.forEach((name) => expect(sockets[name].emit).toHaveBeenCalledTimes(1));
const untold = (...who) => who.forEach((name) => expect(sockets[name].emit).not.toHaveBeenCalled());

describe('a change to a project only its members can open', () => {
    it('reaches its members, the owner and the admins, on every tab they have open', async () => {
        await relay(change(projects.closed));
        told('onIt', 'onItSecondTab', 'owner', 'admin');
    });

    it('reaches no company member who is not on it, no guest, nobody without a seat and no other company', async () => {
        await relay(change(projects.closed));
        untold('notOnIt', 'guest', 'unseated', 'stranger', 'onItElsewhere');
    });

    it('says which project changed and nothing the project holds', async () => {
        await relay(change(projects.closed, { updatedFields: { ProjectName: 'Acquisition of Borealis' } }));
        const projectId = String(projects.closed._id);
        expect(sockets.onIt.emit).toHaveBeenCalledWith(EVENT, { kind: 'changed', companyId: C, projectId });
        const sent = JSON.stringify(sockets.onIt.emit.mock.calls);
        expect(sent).not.toContain('Borealis');
        expect(sent).not.toContain(ON_IT);
    });

    it('is sent to each person, never to a room', async () => {
        await relay(change(projects.closed));
        Object.values(sockets).forEach((socket) => expect(socket.toRoom).not.toHaveBeenCalled());
    });

    it('reaches a role that may list every private project, as the read route answers it', async () => {
        mockRules = SEE_EVERY_PRIVATE_PROJECT;
        await relay(change(projects.closed));
        told('notOnIt');
        untold('guest');
    });

    it('reaches a person on the change that added them, though a moment earlier they were refused', async () => {
        await relay(change(projects.closed));
        untold('notOnIt');
        await mockDbs[C].crud(C, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: projects.closed._id }, { $set: { AssigneeUserId: [ON_IT, NOT_ON_IT] } }] }, 'updateOne');
        await relay(change(projects.closed, { updatedFields: { AssigneeUserId: [ON_IT, NOT_ON_IT] } }));
        told('notOnIt');
    });

    it('stops reaching a person on the change that took them off it', async () => {
        await relay(change(projects.closed));
        await mockDbs[C].crud(C, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: projects.closed._id }, { $set: { AssigneeUserId: [] } }] }, 'updateOne');
        await relay(change(projects.closed, { updatedFields: { AssigneeUserId: [] } }));
        expect(sockets.onIt.emit).toHaveBeenCalledTimes(1);
        expect(sockets.owner.emit).toHaveBeenCalledTimes(2);
    });
});

describe('who else hears of a project', () => {
    it('a public project reaches every seated member of its company and no other company', async () => {
        await relay(change(projects.open));
        told('owner', 'admin', 'onIt', 'notOnIt', 'guest');
        untold('unseated', 'stranger', 'onItElsewhere');
    });

    it('a personal list reaches its own person alone, not even the owner', async () => {
        await relay(change(projects.personal, { type: 'insert' }));
        told('notOnIt');
        untold('owner', 'admin', 'onIt', 'guest', 'stranger');
    });

    it('skips a tab that has left the company room', async () => {
        const left = seat(C, ON_IT, 's-left', { inRoom: false });
        await relay(change(projects.open));
        expect(left.emit).not.toHaveBeenCalled();
    });

    it('reaches nobody when the event names no company, another company or no project', async () => {
        await relay({ type: 'update', module: 'project', data: { _id: projects.open._id } });
        await relay(change(projects.open, { companyId: OTHER_COMPANY }));
        await relay({ type: 'update', module: 'project', companyId: C, data: {} });
        await relay({ type: 'update', module: 'project', companyId: C, data: { _id: 'not-an-id' } });
        await relay(undefined);
        Object.values(sockets).forEach((socket) => expect(socket.emit).not.toHaveBeenCalled());
    });
});

describe('what the event says happened', () => {
    const kinds = (socket) => socket.emit.mock.calls.map(([, payload]) => payload.kind);

    it('a new project is added, a saved one changed', async () => {
        await relay(change(projects.open, { type: 'insert' }));
        await relay(change(projects.open));
        expect(kinds(sockets.guest)).toEqual(['added', 'changed']);
    });

    it('a project moved to the trash is removed, and restoring it is a change', async () => {
        await relay(change(projects.closed, { updatedFields: { deletedStatusKey: 1 } }));
        await relay(change(projects.closed, { data: { deletedStatusKey: 1 } }));
        await relay(change(projects.closed, { data: { deletedStatusKey: 1 }, updatedFields: { deletedStatusKey: 0 } }));
        expect(kinds(sockets.onIt)).toEqual(['removed', 'removed', 'changed']);
        untold('notOnIt', 'guest', 'stranger');
    });

    it('a closed project is a change the browser reads again', async () => {
        await relay(change(projects.open, { updatedFields: { statusType: 'close' } }));
        expect(kinds(sockets.onIt)).toEqual(['changed']);
    });
});

describe('the cost of a burst', () => {
    it('is one look at the project for each person, however many changes and tabs', async () => {
        await relay(change(projects.open, { updatedFields: { taskStatusData: [] } }));
        const first = projectReads();
        await relay(change(projects.open, { updatedFields: { taskStatusData: [] } }));
        await relay(change(projects.open, { updatedFields: { ProjectName: 'Site' } }));
        expect(first).toBeGreaterThan(0);
        expect(projectReads()).toBe(first);
        expect(sockets.onItSecondTab.emit).toHaveBeenCalledTimes(3);
    });
});

describe('the relay', () => {
    it('is named projectChanged and listens for projects made and saved', () => {
        expect(EVENT).toBe('projectChanged');
        expect(socketEmitter.on.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining(['project:insert', 'project:update']));
    });

    it('is loaded with the socket server', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'socket', 'socketinit.js'), 'utf8');
        expect(source).toMatch(/require\('\.\/controller\/projectSocket'\)/);
    });
});
