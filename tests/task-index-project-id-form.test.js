/* Task 040 phase 1: a new task's index is placed after the project's existing rows. The request
   carries the project id as text, tasks store it as an ObjectId, and an aggregate $match compares
   BSON types strictly without Mongoose's casting, so a text id matches no row. */
const mongoose = require('mongoose');

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockCrud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
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
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const internals = require('../Modules/Tasks/helpers/taskMongo/internals');

const CID = 'company-1';
const PROJECT = '6f0000000000000000000a01';
const TASK = '6f0000000000000000000b01';
const UNASSIGNED = { searchKey: 'AssigneeUserId', searchValue: '[]', indexName: 'groupByAssigneeIndex' };
const BY_STATUS = { searchKey: 'statusKey', searchValue: '1', indexName: 'groupByStatusIndex' };

const ROWS = [
    { ProjectID: new mongoose.Types.ObjectId(PROJECT), TaskKey: 'P-1', AssigneeUserId: [], statusKey: 1, groupByAssigneeIndex: 400000, groupByStatusIndex: 400000 },
    { ProjectID: new mongoose.Types.ObjectId(PROJECT), TaskKey: 'P-2', AssigneeUserId: [], statusKey: 1, groupByAssigneeIndex: 200000, groupByStatusIndex: 200000 },
];

/* Equality the way the server compares BSON: an ObjectId equals only an ObjectId. */
const sameBson = (stored, wanted) => {
    const isId = (v) => v instanceof mongoose.Types.ObjectId;
    if (isId(stored) || isId(wanted)) return isId(stored) && isId(wanted) && stored.equals(wanted);
    return stored === wanted;
};

const matchesProject = (match) => {
    const clauses = match.$and || [match];
    const clause = clauses.find((c) => 'ProjectID' in c);
    return (row) => sameBson(row.ProjectID, clause.ProjectID);
};

const byIndex = (name) => (a, b) => a[name] - b[name];

const answerAggregate = (rows) => (companyId, { data: [pipeline] }) => {
    const { $match } = pipeline[0];
    const indexName = Object.keys(pipeline[1].$sort)[0];
    const hit = rows.filter(matchesProject($match)).sort(byIndex(indexName));
    if (pipeline.some((stage) => stage.$group)) return Promise.resolve(hit.length ? [{ results: hit }] : []);
    return Promise.resolve(hit.slice(0, 1));
};

beforeEach(() => mockCrud.mockReset());

describe.each([
    ['the unassigned group', UNASSIGNED],
    ['a status group', BY_STATUS],
])('a new task created in %s', (label, indexObj) => {
    test('is placed before the project rows when the project id arrives as text', async () => {
        mockCrud.mockImplementation(answerAggregate(ROWS));
        await expect(internals.updateTaskIndex(CID, PROJECT, TASK, indexObj, 'P-3', 'sprint-1')).resolves.toBe(200000 - 65536);
        const [companyId, query, method] = mockCrud.mock.calls[0];
        expect([companyId, method]).toEqual([CID, 'aggregate']);
        const { $match } = query.data[0][0];
        const projectClause = ($match.$and || [$match]).find((c) => 'ProjectID' in c);
        expect(projectClause.ProjectID).toBeInstanceOf(mongoose.Types.ObjectId);
    });

    test('starts at zero in a project with no rows yet', async () => {
        mockCrud.mockImplementation(answerAggregate([]));
        await expect(internals.updateTaskIndex(CID, PROJECT, TASK, indexObj, 'P-1', 'sprint-1')).resolves.toBe(0);
    });

    test('starts at zero instead of failing when the project id is not an id', async () => {
        mockCrud.mockImplementation(answerAggregate(ROWS));
        await expect(internals.updateTaskIndex(CID, 'not-an-id', TASK, indexObj, 'P-3', 'sprint-1')).resolves.toBe(0);
    });
});
