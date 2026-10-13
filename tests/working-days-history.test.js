const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []), skillNamesOf: jest.fn(async () => []) }));
jest.mock('../Modules/Project/helpers/projectQuota', () => ({ TRASHED: 1, quotaStatus: () => null, syncProjectQuota: jest.fn(async () => false), privacyChange: () => null, syncProjectType: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ guideTouched: () => false, publishGuideSaved: jest.fn(), publishProjectTrashed: jest.fn(), publishProjectRestored: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateProject } = require('../Modules/Project/controller/updateProject');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000a01';

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const update = async (workingDays) => {
    const res = { status: () => res, json: () => res, send: () => res };
    await updateProject({ headers: { companyid: CID }, params: { id: PROJECT }, body: { updateObject: { workingDays } }, query: {}, uid: OWNER }, res);
    await settle();
};
const messages = () => (mockDb.store[SCHEMA_TYPE.HISTORY] || []).map((row) => [row.Key, row.Message]);
const seedProject = (fields = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Parity', CompanyId: CID, ...fields });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1 });
});

describe('a working-days change on a project is written to its history', () => {
    test('a new week is named from Monday', async () => {
        seedProject();
        await update([0, 5, 6]);
        expect(messages()).toEqual([['Project_WorkingDays', '<b>Olivia Owner</b> has changed <b> Working days</b> as <b>Fri, Sat, Sun</b>.']]);
    });

    test('going back to the company\'s week says so', async () => {
        seedProject({ workingDays: [0, 5, 6] });
        await update(null);
        expect(messages()).toEqual([['Project_WorkingDays', '<b>Olivia Owner</b> has changed <b> Working days</b> as <b>the company\'s working days</b>.']]);
    });

    test('the same week again is not described', async () => {
        seedProject({ workingDays: [0, 5, 6] });
        await update([6, 5, 0]);
        expect(messages()).toEqual([]);
    });

    test('clearing a week that was never set is not described', async () => {
        seedProject();
        await update(null);
        expect(messages()).toEqual([]);
    });
});
