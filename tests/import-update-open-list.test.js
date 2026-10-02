/* An update from the file reaches a list that is open: the real controller, the real task write path and the real
 * relay, with one socket in the list's room. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/tenant', () => ({ pinSessionTenant: (req) => req.headers.companyid }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const socketEmitter = require('../event/socketEventEmitter');
const taskNotices = require('../Modules/Tasks/helpers/handleNotification');
const domainEventBus = require('../event/domainEventBus');
const matcher = require('../Modules/Automations/engine/matcher');
const assignmentRules = require('../Modules/AssignmentRules/engine');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const importers = require('../Modules/Importers/controller');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { TASK_ACTION_FIELDS } = require('../Modules/Tasks/helpers/taskWriteFields');
const guardFixture = require('./fixtures/taskWriteGuard');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, OPEN_PROJECT: PROJECT } = guardFixture;
const OTHER_PROJECT = '6f0000000000000000000a09';
const SPRINT = '6f0000000000000000000e01';
const guard = guardFixture.create(mockDb);
const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const STATUSES = [{ name: 'To Do', key: 1, type: 'default_active' }, { name: 'In Progress', key: 2, type: 'active' }, { name: 'Done', key: 3, type: 'close' }];
const DONE = STATUSES[2];
const LIST = { 'List Name': 'Website relaunch', 'Folder Name': 'Marketing', 'Space Name': 'Acme' };
const fileRows = (statuses = {}) => [
    { ...LIST, 'Task ID': 'c1', 'Task Name': 'Write the copy', Status: statuses.c1 === undefined ? 'to do' : statuses.c1, 'Story Points (number)': '3' },
    { ...LIST, 'Task ID': 'c2', 'Task Name': 'Draw the hero', Status: statuses.c2 === undefined ? 'to do' : statuses.c2 },
    { ...LIST, 'Task ID': 'c3', 'Task Name': 'Book the venue', Status: statuses.c3 === undefined ? 'in progress' : statuses.c3 },
];


const { upsertRoom, removeRoom } = require('../socket/helper');
const roomAccess = require('../socket/roomAccess');
require('../socket/controller/taskSocket');

const store = (type) => mockDb.store[type] || [];
const taskNamed = (name) => store(SCHEMA_TYPE.TASKS).find((task) => task.TaskName === name);

const call = async (handler, body) => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ uid: OWNER, headers: { companyid: CID }, body, params: {}, query: {} }, res);
    await settle();
    return res;
};
const importFile = async (options, rows = fileRows()) => (await call(importers.importFromClickUp, { rows, projectId: PROJECT, sprintId: SPRINT, options })).body;

const ROOM = `project_sprint_${PROJECT}_${SPRINT}**socket1`;
const heard = [];
const openList = () => {
    const socket = { id: 'socket1', identity: { companyId: CID, uid: OWNER }, rooms: new Set([ROOM]) };
    const namespace = { name: `/${CID}`, to: () => ({ emit: (event, payload) => heard.push({ event, payload: JSON.parse(JSON.stringify(payload)) }) }) };
    upsertRoom({ roomName: ROOM, socketId: socket.id, namespace, socket, isUserIdCheck: false });
};

beforeEach(async () => {
    guard.reset();
    roomAccess.forgetVerdicts();
    Object.assign(store(SCHEMA_TYPE.PROJECTS).find((row) => row._id === PROJECT), {
        ProjectName: 'Website', ProjectCode: 'WEB', CompanyId: CID, lastTaskId: 0, taskStatusData: STATUSES.map((status) => ({ ...status })), tagsArray: [],
    });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'From ClickUp', projectId: PROJECT });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner', Employee_Email: 'olivia.owner@example.test' });
    await importFile({ createMissingStatuses: true });
    heard.length = 0;
    openList();
});

afterEach(() => removeRoom(ROOM));

describe('an update from the file, with the list open', () => {
    it('sends the list the new status of a task the file moved', async () => {
        const out = await importFile({ createMissingStatuses: true, existing: 'update' }, fileRows({ c1: 'complete' }));
        await settle();

        expect(out).toMatchObject({ status: true, data: { created: 0, updated: 3 } });
        const id = String(taskNamed('Write the copy')._id);
        const mine = heard.filter((entry) => entry.event === 'taskUpdate' && String(entry.payload.fullDocument._id) === id);
        expect(mine.some((entry) => entry.payload.updatedFields.statusKey === 3)).toBe(true);
        expect(mine[mine.length - 1].payload.fullDocument.statusKey).toBe(3);
    });
});
