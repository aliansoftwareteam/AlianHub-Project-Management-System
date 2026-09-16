const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { evaluatePermission, evaluateMany } = require('../Config/permissionGuard');
const { cases } = require('./fixtures/permissionParity.json');

const CID = '6f00000000000000000000c1';
const UID = '6f0000000000000000000003';
const PROJECT = '6f0000000000000000000a01';

const seedCase = (testCase) => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    if (testCase.role !== null) mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: UID, roleType: testCase.role, status: 2, isDelete: false });
    testCase.companyRules.forEach((row) => mockDb.seed(SCHEMA_TYPE.RULES, { ...row }));
    testCase.projectRules.forEach((row) => mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, { ...row, projectId: PROJECT }));
    if (testCase.project) mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ...testCase.project });
    return testCase.project ? { projectId: PROJECT } : {};
};

const serverValue = (testCase) => (testCase.knownDifference ? testCase.knownDifference.server : testCase.expected);
const agreed = cases.filter((testCase) => !testCase.knownDifference);
const knownDifferences = cases.filter((testCase) => testCase.knownDifference);

describe('the server evaluator reaches the answers the web app reaches (tests/fixtures/permissionParity.json)', () => {
    test.each(agreed.map((testCase) => [testCase.name, testCase]))('evaluatePermission: %s', async (_, testCase) => {
        const scope = seedCase(testCase);
        expect(await evaluatePermission(CID, UID, testCase.key, scope)).toBe(testCase.expected);
    });

    test.each(agreed.map((testCase) => [testCase.name, testCase]))('evaluateMany: %s', async (_, testCase) => {
        const scope = seedCase(testCase);
        const { permissions } = await evaluateMany(CID, UID, [testCase.key], scope);
        expect(permissions[testCase.key]).toBe(testCase.expected);
    });
});

describe('known differences, kept because closing them would refuse requests allowed today', () => {
    test.each(knownDifferences.map((testCase) => [testCase.name, testCase]))('%s', async (_, testCase) => {
        const scope = seedCase(testCase);
        expect(testCase.knownDifference.server).not.toBe(testCase.knownDifference.web);
        expect(testCase.knownDifference.why).toEqual(expect.any(String));
        expect(await evaluatePermission(CID, UID, testCase.key, scope)).toBe(serverValue(testCase));
        expect((await evaluateMany(CID, UID, [testCase.key], scope)).permissions[testCase.key]).toBe(serverValue(testCase));
    });
});

test('evaluateMany answers every key in one call from the rules evaluatePermission reads', async () => {
    const testCase = cases.find((c) => c.name === 'a project with its own rules narrows what the company rules grant');
    const scope = seedCase(testCase);
    mockDb.seed(SCHEMA_TYPE.RULES, { _id: 'c-settings', key: 'settings', name: 'settings', isParent: true, roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, { _id: 'c-settings-member_list', key: 'settings_member_list', name: 'settings_member_list', isParent: false, parentId: 'c-settings', roles: [{ key: 3, permission: true }] });
    const keys = ['task.task_priority', 'project.project_list', 'settings.settings_member_list', 'task.task_create'];

    const { roleType, permissions } = await evaluateMany(CID, UID, keys, scope);

    expect(roleType).toBe(3);
    expect(permissions).toEqual({ 'task.task_priority': false, 'project.project_list': true, 'settings.settings_member_list': true, 'task.task_create': null });
    for (const key of keys) expect(await evaluatePermission(CID, UID, key, scope)).toBe(permissions[key]);
});
