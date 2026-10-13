const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => {
        const db = mockDbs[String(companyId)];
        return db ? db.crud(companyId, ...rest) : Promise.resolve(null);
    },
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const helper = require('../socket/helper');
const { forgetVerdicts } = require('../socket/roomAccess');
const { relayList, relayFolder, LIST_EVENT, FOLDER_EVENT } = require('../socket/controller/listSocket');

const C = '6f00000000000000000b0c01';
const OTHER_COMPANY = '6f00000000000000000b0c02';
const OWNER = '6f00000000000000000b0011';
const ADMIN = '6f00000000000000000b0012';
const ON_PROJECT = '6f00000000000000000b0013';
const ON_LIST = '6f00000000000000000b0014';
const IN_TEAM = '6f00000000000000000b0015';
const GUEST = '6f00000000000000000b0016';
const UNSEATED = '6f00000000000000000b0017';
const STRANGER = '6f00000000000000000b0018';

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

const listChange = (list, { type = 'update', companyId = C, sharedBefore } = {}) => ({
    type, module: 'sprints', companyId, data: { _id: String(list._id) }, ...(sharedBefore ? { sharedBefore } : {}),
});
const folderChange = (folder, { type = 'update', companyId = C } = {}) => ({ type, module: 'folders', companyId, data: { _id: String(folder._id) } });
const save = (type, row, set) => mockDbs[C].crud(C, { type, data: [{ _id: row._id }, { $set: set }] }, 'updateOne');

let sockets;
let projects;
let lists;
let folders;

beforeEach(() => {
    myCache.flushAll();
    forgetVerdicts();
    mockDbs[C] = create();
    mockDbs[OTHER_COMPANY] = create();
    [[OWNER, 1], [ADMIN, 2], [ON_PROJECT, 3], [ON_LIST, 3], [IN_TEAM, 3], [GUEST, 0]].forEach(([userId, roleType]) => {
        mockDbs[C].seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    [[STRANGER, 1], [ON_LIST, 3]].forEach(([userId, roleType]) => {
        mockDbs[OTHER_COMPANY].seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    const team = mockDbs[C].seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { name: 'Finance', assigneeUsersArray: [IN_TEAM] });
    projects = {
        open: mockDbs[C].seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Website', isPrivateSpace: false, AssigneeUserId: [] }),
        closed: mockDbs[C].seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Acquisition of Borealis', isPrivateSpace: true, AssigneeUserId: [ON_PROJECT] }),
    };
    const chatSpace = mockDbs[C].seed(SCHEMA_TYPE.MAIN_CHATS, { default: false });
    const list = (project, extra = {}) => mockDbs[C].seed(SCHEMA_TYPE.SPRINTS, { projectId: project._id, name: 'Backlog', private: false, AssigneeUserId: [], deletedStatusKey: 0, ...extra });
    lists = {
        open: list(projects.open),
        private: list(projects.open, { name: 'Redundancy plan', private: true, AssigneeUserId: [ON_LIST] }),
        teamOnly: list(projects.open, { name: 'Payroll', private: true, AssigneeUserId: [`tId_${team._id}`] }),
        inClosedProject: list(projects.closed, { name: 'Due diligence' }),
        channel: list(chatSpace, { name: 'general' }),
    };
    folders = {
        open: mockDbs[C].seed(SCHEMA_TYPE.FOLDERS, { projectId: projects.open._id, name: 'Design', deletedStatusKey: 0 }),
        inClosedProject: mockDbs[C].seed(SCHEMA_TYPE.FOLDERS, { projectId: projects.closed._id, name: 'Legal', deletedStatusKey: 0 }),
        category: mockDbs[C].seed(SCHEMA_TYPE.FOLDERS, { projectId: chatSpace._id, name: 'Teams', deletedStatusKey: 0 }),
    };
    sockets = {
        owner: seat(C, OWNER, 's-owner'),
        admin: seat(C, ADMIN, 's-admin'),
        onProject: seat(C, ON_PROJECT, 's-on-project'),
        onList: seat(C, ON_LIST, 's-on-list'),
        onListSecondTab: seat(C, ON_LIST, 's-on-list-2'),
        inTeam: seat(C, IN_TEAM, 's-in-team'),
        guest: seat(C, GUEST, 's-guest'),
        unseated: seat(C, UNSEATED, 's-unseated'),
        stranger: seat(OTHER_COMPANY, STRANGER, 's-stranger'),
        onListElsewhere: seat(OTHER_COMPANY, ON_LIST, 's-on-list-elsewhere'),
    };
});

afterEach(() => joined.splice(0).forEach((roomName) => helper.removeRoom(roomName)));

const told = (...who) => who.forEach((name) => expect(sockets[name].emit).toHaveBeenCalledTimes(1));
const untold = (...who) => who.forEach((name) => expect(sockets[name].emit).not.toHaveBeenCalled());
const nobodyTold = () => Object.values(sockets).forEach((socket) => expect(socket.emit).not.toHaveBeenCalled());
const kinds = (socket) => socket.emit.mock.calls.map(([, payload]) => payload.kind);

describe('a change to a list everyone in the project can open', () => {
    it('reaches every seated person who may open the project, guests among them, on every tab', async () => {
        await relayList(listChange(lists.open));
        told('owner', 'admin', 'onProject', 'onList', 'onListSecondTab', 'inTeam', 'guest');
    });

    it('reaches nobody without a seat and no other company', async () => {
        await relayList(listChange(lists.open));
        untold('unseated', 'stranger', 'onListElsewhere');
    });

    it('says which list of which project changed and nothing the list holds', async () => {
        await relayList(listChange(lists.private));
        expect(sockets.onList.emit).toHaveBeenCalledWith(LIST_EVENT, {
            kind: 'changed', companyId: C, projectId: String(projects.open._id), sprintId: String(lists.private._id),
        });
        const sent = JSON.stringify(sockets.onList.emit.mock.calls);
        expect(sent).not.toContain('Redundancy');
        expect(sent).not.toContain(ON_LIST);
    });

    it('is sent to each person, never to a room', async () => {
        await relayList(listChange(lists.open));
        Object.values(sockets).forEach((socket) => expect(socket.toRoom).not.toHaveBeenCalled());
    });

    it('skips a tab that has left the company room', async () => {
        const left = seat(C, ON_PROJECT, 's-left', { inRoom: false });
        await relayList(listChange(lists.open));
        expect(left.emit).not.toHaveBeenCalled();
    });
});

describe('a change to a private list', () => {
    it('reaches the people on it, the owner and the admins', async () => {
        await relayList(listChange(lists.private));
        told('onList', 'onListSecondTab', 'owner', 'admin');
    });

    it('reaches nobody else who may open the project, no guest and no other company', async () => {
        await relayList(listChange(lists.private));
        untold('onProject', 'inTeam', 'guest', 'unseated', 'stranger', 'onListElsewhere');
    });

    it('shared with a team reaches the people of that team', async () => {
        await relayList(listChange(lists.teamOnly));
        told('inTeam', 'owner', 'admin');
        untold('onProject', 'onList', 'guest');
    });

    it('is told as it is stored, whatever the event says of it', async () => {
        await relayList({ ...listChange(lists.private), data: { _id: String(lists.private._id), private: false, AssigneeUserId: [GUEST], projectId: String(projects.open._id) } });
        untold('guest', 'onProject');
        told('onList');
    });
});

describe('a list whose sharing changes', () => {
    const openToAll = { private: false, AssigneeUserId: [] };

    it('made private is removed for the people who saw it and stays for the people on it', async () => {
        await save(SCHEMA_TYPE.SPRINTS, lists.open, { private: true, AssigneeUserId: [ON_LIST] });
        await relayList(listChange(lists.open, { sharedBefore: openToAll }));
        expect(kinds(sockets.onProject)).toEqual(['removed']);
        expect(kinds(sockets.guest)).toEqual(['removed']);
        expect(kinds(sockets.onList)).toEqual(['changed']);
        expect(kinds(sockets.owner)).toEqual(['changed']);
    });

    it('that takes a person off a private list is removed for that person alone', async () => {
        await save(SCHEMA_TYPE.SPRINTS, lists.private, { AssigneeUserId: [ON_PROJECT] });
        await relayList(listChange(lists.private, { sharedBefore: { private: true, AssigneeUserId: [ON_LIST, ON_PROJECT] } }));
        expect(kinds(sockets.onList)).toEqual(['removed']);
        expect(kinds(sockets.onProject)).toEqual(['changed']);
        untold('guest', 'inTeam');
    });

    it('is never told to a person who could not open the project it is in', async () => {
        await save(SCHEMA_TYPE.SPRINTS, lists.inClosedProject, { private: true, AssigneeUserId: [ON_PROJECT] });
        await relayList(listChange(lists.inClosedProject, { sharedBefore: openToAll }));
        untold('onList', 'guest', 'inTeam');
        expect(kinds(sockets.onProject)).toEqual(['changed']);
    });
});

describe('a list in a project only its members can open', () => {
    it('reaches its members, the owner and the admins, and nobody else', async () => {
        await relayList(listChange(lists.inClosedProject));
        told('onProject', 'owner', 'admin');
        untold('onList', 'inTeam', 'guest', 'unseated', 'stranger');
    });
});

describe('what the list event says happened', () => {
    it('a new list is added, a saved or archived one changed, one in the trash removed', async () => {
        await relayList(listChange(lists.open, { type: 'insert' }));
        await relayList(listChange(lists.open));
        await save(SCHEMA_TYPE.SPRINTS, lists.open, { deletedStatusKey: 2 });
        await relayList(listChange(lists.open));
        await save(SCHEMA_TYPE.SPRINTS, lists.open, { deletedStatusKey: 1 });
        await relayList(listChange(lists.open));
        expect(kinds(sockets.guest)).toEqual(['added', 'changed', 'changed', 'removed']);
    });
});

describe('a list event that reaches nobody', () => {
    it('names no company, another company, no list or a list that is not stored', async () => {
        await relayList({ type: 'update', module: 'sprints', data: { _id: String(lists.open._id) } });
        await relayList(listChange(lists.open, { companyId: OTHER_COMPANY }));
        await relayList({ type: 'update', module: 'sprints', companyId: C, data: {} });
        await relayList({ type: 'update', module: 'sprints', companyId: C, data: { _id: 'not-an-id' } });
        await relayList({ type: 'update', module: 'sprints', companyId: C, data: { _id: '6f00000000000000000b0eee' } });
        await relayList(undefined);
        nobodyTold();
    });

    it('is a chat channel, which shares the collection and sits in no project', async () => {
        await relayList(listChange(lists.channel, { type: 'insert' }));
        nobodyTold();
    });
});

describe('a change to a folder', () => {
    it('reaches every seated person who may open its project and no other company', async () => {
        await relayFolder(folderChange(folders.open, { type: 'insert' }));
        told('owner', 'admin', 'onProject', 'onList', 'inTeam', 'guest');
        untold('unseated', 'stranger', 'onListElsewhere');
    });

    it('in a project only its members can open reaches them, the owner and the admins alone', async () => {
        await relayFolder(folderChange(folders.inClosedProject));
        told('onProject', 'owner', 'admin');
        untold('onList', 'inTeam', 'guest', 'stranger');
    });

    it('says which folder of which project changed and nothing the folder holds, to each person and never to a room', async () => {
        await relayFolder(folderChange(folders.inClosedProject));
        expect(sockets.onProject.emit).toHaveBeenCalledWith(FOLDER_EVENT, {
            kind: 'changed', companyId: C, projectId: String(projects.closed._id), folderId: String(folders.inClosedProject._id),
        });
        expect(JSON.stringify(sockets.onProject.emit.mock.calls)).not.toContain('Legal');
        Object.values(sockets).forEach((socket) => expect(socket.toRoom).not.toHaveBeenCalled());
    });

    it('is added, changed, or removed once it is in the trash', async () => {
        await relayFolder(folderChange(folders.open, { type: 'insert' }));
        await save(SCHEMA_TYPE.FOLDERS, folders.open, { deletedStatusKey: 2 });
        await relayFolder(folderChange(folders.open));
        await save(SCHEMA_TYPE.FOLDERS, folders.open, { deletedStatusKey: 1 });
        await relayFolder(folderChange(folders.open));
        expect(kinds(sockets.guest)).toEqual(['added', 'changed', 'removed']);
    });

    it('reaches nobody without a company, in another company, for a folder that is not stored or for a chat category', async () => {
        await relayFolder({ type: 'update', module: 'folders', data: { _id: String(folders.open._id) } });
        await relayFolder(folderChange(folders.open, { companyId: OTHER_COMPANY }));
        await relayFolder({ type: 'update', module: 'folders', companyId: C });
        await relayFolder({ type: 'update', module: 'folders', companyId: C, data: { _id: '6f00000000000000000b0eee' } });
        await relayFolder(folderChange(folders.category));
        await relayFolder(undefined);
        nobodyTold();
    });
});

describe('the cost of a burst', () => {
    const reads = (type) => mockDbs[C].calls.filter((call) => call.type === type && call.method === 'findOne').length;

    it('is one look at the list for each change and one look at the project for each person', async () => {
        await relayList(listChange(lists.open));
        const projectReads = reads(SCHEMA_TYPE.PROJECTS);
        const listReads = reads(SCHEMA_TYPE.SPRINTS);
        await relayList(listChange(lists.open));
        await relayFolder(folderChange(folders.open));
        expect(listReads).toBe(1);
        expect(reads(SCHEMA_TYPE.SPRINTS)).toBe(2);
        expect(projectReads).toBeGreaterThan(0);
        expect(reads(SCHEMA_TYPE.PROJECTS)).toBe(projectReads);
        expect(sockets.onListSecondTab.emit).toHaveBeenCalledTimes(3);
    });
});

describe('the relay', () => {
    it('is named for lists and folders and listens for both being made and saved', () => {
        expect(LIST_EVENT).toBe('listChanged');
        expect(FOLDER_EVENT).toBe('foldersChanged');
        expect(socketEmitter.on.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining(['sprints:insert', 'sprints:update', 'folders:insert', 'folders:update']));
    });

    it('is loaded with the socket server', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'socket', 'socketinit.js'), 'utf8');
        expect(source).toMatch(/require\('\.\/controller\/listSocket'\)/);
        expect(source).not.toMatch(/folderSocket/);
    });
});
