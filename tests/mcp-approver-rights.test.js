/* Every kind of change a connected agent can ask for is approved only by a person who could make it by hand. */
process.env.STORAGE_TYPE = 'server';
const FLAGS = ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_DATA', 'AGENT_PERFORMANCE_READ'];
FLAGS.forEach((key) => { process.env[key] = 'on'; });
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
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
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Knowledge/memory/publish', () => mockStub());
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/service.js', () => mockStub());

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const registry = require('../Modules/Agents/registry');
const groups = require('../Modules/Agents/registryGroups');
const manageFlag = require('../Modules/Mcp/manageFlag');
const approval = require('../Modules/Mcp/approval');

const { CID, OWNER, MEMBER, TOKEN, P_OPEN } = world;
const { seed, rows } = world.create(mockDb);

const DAY = 24 * 60 * 60 * 1000;
const MEMBER_ROLE = 3;
const APPROVER_HELD = /approver may not make this change|needs an Owner or Admin/;

const WRITES = registry.keys().filter((key) => registry.get(key).write);
// Approved by the person it was asked for alone, whatever a role may do.
const ASKER_ALONE = ['dashboard.card.add'];
const BY_ROLE = WRITES.filter((key) => !ASKER_ALONE.includes(key));
const KNOWN = [...registry.ACTIONS, ...groups.flatMap((group) => group.entries.map((entry) => entry.action))];

let fx;

const paramsOf = () => ({ taskId: String(fx.top._id), projectId: P_OPEN });
const optionsOf = (need) => need.anyOf || [need.key];

const ruleRows = (path) => {
    const [section, key] = path.split('.');
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === section)
        || mockDb.seed(SCHEMA_TYPE.RULES, { key: section, name: section, isParent: true, roles: [] });
    const found = rows(SCHEMA_TYPE.RULES).filter((rule) => !rule.isParent && rule.key === key && String(rule.parentId) === String(parent._id));
    return found.length ? found : [mockDb.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(parent._id), roles: [] })];
};
const setForMembers = (path, permission) => ruleRows(path).forEach((rule) => { rule.roles = permission === null ? [] : [{ key: MEMBER_ROLE, permission }]; });

const filedBy = (action) => ({
    source: 'mcp', tokenId: TOKEN, requestedBy: OWNER, projectId: P_OPEN, status: 'pending', gate: null,
    changes: [{ action, params: paramsOf(), label: action }],
});
const asked = (action) => approval.refusalFor(CID, filedBy(action), { decider: { kind: 'human', userId: MEMBER }, isPrivileged: false });

beforeEach(() => {
    jest.clearAllMocks();
    fx = seed();
    FLAGS.forEach((key) => { process.env[key] = 'on'; });
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [...manageFlag.GRANTS], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
});
afterAll(() => { FLAGS.forEach((key) => { delete process.env[key]; }); });

describe('the right a change is held to', () => {
    it('is named for every action the registry knows', () => {
        expect(KNOWN.length).toBeGreaterThan(WRITES.length);
        expect(() => registry.validate(KNOWN)).not.toThrow();
    });

    it.each(WRITES)('%s names one for the task and the project it touches', (action) => {
        expect(registry.permissionsFor(action, paramsOf()).length).toBeGreaterThan(0);
    });
});

describe('approving a connected agent\'s change', () => {
    it('covers more than a handful of kinds', () => {
        expect(WRITES.length).toBeGreaterThan(30);
    });

    it.each(BY_ROLE)('%s is not approved by a member whose role may not make it', async (action) => {
        const needs = registry.permissionsFor(action, paramsOf());
        needs.flatMap(optionsOf).forEach((path) => setForMembers(path, true));
        expect((await asked(action)) || { error: '' }).toMatchObject({ error: expect.stringMatching(/^$|needs an Owner or Admin/) });

        optionsOf(needs[0]).forEach((path) => setForMembers(path, null));
        expect(await asked(action)).toMatchObject({ status: 403, error: expect.stringMatching(APPROVER_HELD) });
    });

    it.each(BY_ROLE)('%s is not approved by a guest whose role may not make it', async (action) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: world.OUTSIDER, roleType: 0, status: 2, isDelete: false });
        registry.permissionsFor(action, paramsOf()).flatMap(optionsOf).forEach((path) => setForMembers(path, true));
        const out = await approval.refusalFor(CID, filedBy(action), { decider: { kind: 'human', userId: world.OUTSIDER }, isPrivileged: false });
        expect(out).toMatchObject({ status: 403, error: expect.stringMatching(APPROVER_HELD) });
    });

    it.each(ASKER_ALONE)('%s is approved by the person it was asked for, and by nobody else', async (action) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: world.OUTSIDER, roleType: 0, status: 2, isDelete: false });
        registry.permissionsFor(action, paramsOf()).flatMap(optionsOf).forEach((path) => setForMembers(path, true));
        const decidedBy = (userId, isPrivileged) => approval.refusalFor(CID, filedBy(action), { decider: { kind: 'human', userId }, isPrivileged });

        expect(await decidedBy(MEMBER, false)).toMatchObject({ status: 403, error: expect.stringMatching(/only the person/) });
        expect(await decidedBy(world.ADMIN, true)).toMatchObject({ status: 403, error: expect.stringMatching(/only the person/) });
        expect(await decidedBy(world.OUTSIDER, false)).toMatchObject({ status: 403 });
        expect((await decidedBy(OWNER, true)) || { error: '' }).toMatchObject({ error: '' });
    });
});
