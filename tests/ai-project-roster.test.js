const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => true }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async () => []), getActiveSkillSlugs: jest.fn(async () => []) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ normalizePlanColors: (p) => p }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn(), COMPLETE_EVENT: 'complete' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { loadActiveMembers } = require('../Modules/AIProjectGenerator/controller');

const C = '6f0000000000000000000c01';
const ACTIVE = '6f0000000000000000000001';
const INVITED = '6f0000000000000000000002';
const WITHDRAWN = '6f0000000000000000000003';
const LEFT = '6f0000000000000000000004';

beforeEach(() => {
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ACTIVE, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITED, roleType: 3, status: 1, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: WITHDRAWN, roleType: 3, status: 3, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEFT, roleType: 3, status: 2, isDelete: true });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userEmail: 'not-yet@example.test', roleType: 3, status: 1, isDelete: false });
});

describe('the people a drafted project plan may name', () => {
    it('are the members who hold a live seat', async () => {
        expect((await loadActiveMembers(C)).map((member) => member.id)).toEqual([ACTIVE]);
    });
});
