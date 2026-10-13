const mockStub = () => new Proxy({}, { get: (target, name) => { target[name] = target[name] || jest.fn(); return target[name]; } });
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(), validateObjectId: () => true }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const create = require('../Modules/Tasks/helpers/taskMongo/create');

const P = '6f0000000000000000000a01';
const args = (titles) => ({
    companyId: '6f0000000000000000000c01', userId: 'u1', subTitles: titles.map((title) => ({ title })),
    sprintObj: { id: 'sprint-1', name: 'Sprint 1' }, projectData: { _id: P }, userData: { id: 'u1' },
    parentTask: { id: '6f0000000000000000000b01', ProjectID: P }, type: 'subTask',
});

describe('creating AI subtasks and tasks', () => {
    it('answers only after every task is written, so an undo by the returned ids cannot outrun a write', async () => {
        const written = [];
        const self = { create: jest.fn(async ({ data }) => { await new Promise((r) => setTimeout(r, 5)); written.push(data.TaskName); }) };
        const out = await create.createSubTaskWithAi.call(self, args(['One', 'Two', 'Three']));
        expect(written).toEqual(['One', 'Two', 'Three']);
        expect(out.map((t) => t.TaskName)).toEqual(['One', 'Two', 'Three']);
    });

    it('leaves a task that failed to write out of the answer', async () => {
        const self = { create: jest.fn(async ({ data }) => { if (data.TaskName === 'Two') throw new Error('refused'); }) };
        const out = await create.createSubTaskWithAi.call(self, args(['One', 'Two', 'Three']));
        expect(out.map((t) => t.TaskName)).toEqual(['One', 'Three']);
    });
});
