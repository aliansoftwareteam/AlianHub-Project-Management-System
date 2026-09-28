/* Task 040 phase 2: the readers that pick history rows by project match both stored forms of the id,
   so rows keep being found while a migration moves ProjectId from text to ObjectId. Each filter is
   matched the way MongoDB matches it, where an ObjectId never equals its hex. */
const { matchesLikeMongo, filterOf, oid } = require('./fixtures/storedForms');
const verified = require('./fixtures/verifiedRequest');

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ evaluatePermission: jest.fn(async () => true) }));
jest.mock('../Config/projectAccess', () => ({ keepVisibleProjectIds: jest.fn(async (companyId, uid, ids) => ids.map(String)) }));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({ hiddenSprintFilter: jest.fn(async () => ({})), hiddenSprintIds: jest.fn(async () => []) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const history = require('../Modules/History/controller');
const milestones = require('../Modules/AgileReports/milestones');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const OTHER_PROJECT = '6f0000000000000000000b02';
const TASK = '6f0000000000000000000d01';
const BOTH = ['ObjectId form', 'text form'];

const HISTORY_ROWS = [
    { _id: 'h-text', name: 'text form', ProjectId: PROJECT },
    { _id: 'h-oid', name: 'ObjectId form', ProjectId: oid(PROJECT) },
    { _id: 'h-other', name: 'other project', ProjectId: oid(OTHER_PROJECT) },
].flatMap((row) => [
    { ...row, Type: 'project', Key: 'Project_Milestone_Changed', Message: '' },
    { ...row, _id: `${row._id}-task`, Type: 'task', TaskId: TASK },
]);

const namesOf = (rows) => [...new Set(rows.map((row) => row.name))].sort();

const historyReads = () => mockCrud.mock.calls
    .filter(([, q]) => q.type === SCHEMA_TYPE.HISTORY)
    .map(([, { data }, method]) => namesOf(HISTORY_ROWS.filter(matchesLikeMongo(filterOf(method, method === 'aggregate' ? data[0] : data)))));

beforeEach(() => {
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue([PROJECT]);
    mockCrud.mockImplementation(async (companyId, { type }, method) => {
        if (type === SCHEMA_TYPE.PROJECTS) return [{ _id: oid(PROJECT), ProjectName: 'Parity' }];
        return method === 'findOne' ? null : [];
    });
});

const call = async (handler, query) => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (answer) => { r.body = answer; return r; };
    r.send = r.json;
    await handler(verified({ headers: { companyid: C }, query, uid: ME }), r);
    return r;
};

describe('history rows are found by either form of their project id', () => {
    test.each([
        ['a project\'s activity log, an aggregate that does not convert (History getActivityLog)', history.getActivityLog, { fromProject: 'true', projectId: PROJECT }],
        ['a task\'s activity log (History getActivityLog)', history.getActivityLog, { fromProject: 'false', projectId: PROJECT, taskId: TASK }],
        ['the milestone report\'s moves (AgileReports getMilestones)', milestones.getMilestones, { projectId: PROJECT }],
    ])('%s', async (_, handler, query) => {
        const r = await call(handler, query);
        expect(r.code).toBe(200);
        const reads = historyReads();
        expect(reads.length).toBeGreaterThan(0);
        reads.forEach((names) => expect(names).toEqual(BOTH));
    });
});
