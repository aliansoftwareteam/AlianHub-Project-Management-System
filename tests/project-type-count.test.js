const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    ...jest.requireActual('../utils/mongo-handler/mongoQueries'),
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []) }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ guideTouched: () => false, publishGuideSaved: jest.fn(), publishProjectTrashed: jest.fn(), publishProjectRestored: jest.fn() }));
jest.mock('../Modules/Company/helpers/companyCounters', () => ({ stepCompanyCounters: jest.fn(async () => ({})) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { stepCompanyCounters } = require('../Modules/Company/helpers/companyCounters');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');

const CID = '6f00000000000000000000c1';
const TO_PRIVATE = { 'projectCount.privateCount': 1, 'projectCount.publicCount': -1 };
const TO_PUBLIC = { 'projectCount.publicCount': 1, 'projectCount.privateCount': -1 };

const seedProject = (fields) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Type probe', deletedStatusKey: 0, ...fields });
const stored = (project) => mockDb.store[SCHEMA_TYPE.PROJECTS].find((row) => String(row._id) === String(project._id));
const steps = () => stepCompanyCounters.mock.calls.map(([companyId, fields]) => ({ companyId: String(companyId), fields }));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

describe('switching a project between private and public keeps the company counts', () => {
    it('moves one count to the private bucket when a public project turns private', async () => {
        const project = seedProject({ isPrivateSpace: false });
        await updateProjectInternal(CID, String(project._id), { isPrivateSpace: true });

        expect(stored(project).isPrivateSpace).toBe(true);
        expect(steps()).toEqual([{ companyId: CID, fields: TO_PRIVATE }]);
    });

    it('moves it back when the project turns public again', async () => {
        const project = seedProject({ isPrivateSpace: true });
        await updateProjectInternal(CID, String(project._id), { isPrivateSpace: false }, '$set');

        expect(steps()).toEqual([{ companyId: CID, fields: TO_PUBLIC }]);
    });

    it('treats a project with no type stored as public', async () => {
        const project = seedProject({});
        await updateProjectInternal(CID, String(project._id), { isPrivateSpace: false });
        expect(steps()).toEqual([]);

        await updateProjectInternal(CID, String(project._id), { isPrivateSpace: true });
        expect(steps()).toEqual([{ companyId: CID, fields: TO_PRIVATE }]);
    });

    it('moves nothing when the request repeats the type the project already has', async () => {
        const project = seedProject({ isPrivateSpace: false });
        await updateProjectInternal(CID, String(project._id), { isPrivateSpace: true });
        await updateProjectInternal(CID, String(project._id), { isPrivateSpace: true });

        expect(steps()).toEqual([{ companyId: CID, fields: TO_PRIVATE }]);
    });

    it('moves nothing for a project in the trash, which holds no count', async () => {
        const project = seedProject({ isPrivateSpace: false, deletedStatusKey: 1 });
        await updateProjectInternal(CID, String(project._id), { isPrivateSpace: true });

        expect(steps()).toEqual([]);
    });

    it.each([
        ['a non-boolean type', { isPrivateSpace: 'true' }, undefined],
        ['another operator', { isPrivateSpace: true }, '$setOnInsert'],
        ['an unrelated field', { ProjectName: 'Renamed' }, undefined],
    ])('moves nothing for %s', async (_label, updateObject, key) => {
        const project = seedProject({ isPrivateSpace: false });
        await updateProjectInternal(CID, String(project._id), updateObject, key).catch(() => null);

        expect(steps()).toEqual([]);
    });
});
