/* Task 040 phase 2: the readers of timesheets.ProjectId outside the timesheet screens (the dashboard,
   project billing, project auto-close and the MCP timesheet tool) match both stored forms. */
process.env.MCP_TOOLS_DATA = 'on';
const { matchesLikeMongo, filterOf, oid } = require('./fixtures/storedForms');
const verified = require('./fixtures/verifiedRequest');

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), getTtl: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn(async () => 2), evaluatePermission: jest.fn(async () => 2) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../utils/companyMembers', () => ({
    acceptedMemberIds: jest.fn(async (companyId, ids) => ids.map(String)),
    activeMemberIds: jest.fn(async (companyId, ids) => ids.map(String)),
    memberProfiles: jest.fn(async () => []),
}));
jest.mock('../Modules/Agents/actions', () => {
    const real = jest.requireActual('../Modules/Agents/actions');
    return { ...real, authorizeRead: jest.fn(async () => true), refusal: jest.fn(async (companyId, actor, { reason }) => new Error(reason)) };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');
const scope = require('../Modules/Agents/scope');
const dashboard = require('../Modules/UserDashboard/controller');
const milestoneBilling = require('../Modules/Milestone/controller/billing');
const projectClose = require('../Modules/projectClose/helper');
const mcpTools = require('../Modules/Mcp/tools');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const OTHER_PROJECT = '6f0000000000000000000b02';
const T1 = '6f0000000000000000000a01';
const LOGGED_AT = Date.parse('2026-09-02T09:00:00Z') / 1000;
const WINDOW = { dateFrom: '2026-09-01T00:00:00Z', dateTo: '2026-09-03T00:00:00Z' };

const NAMES = ['text form', 'ObjectId form', 'other project'];
const logRow = (name, ProjectId) => ({
    _id: oid(`6f00000000000000000d000${NAMES.indexOf(name) + 1}`), name, ProjectId,
    Loggeduser: ME, TicketID: T1, LogStartTime: LOGGED_AT, LogEndTime: LOGGED_AT + 60, LogTimeDuration: 60, LogDescription: name, logAddType: 0, billable: true,
});
const LOGS = [logRow('text form', PROJECT), logRow('ObjectId form', oid(PROJECT)), logRow('other project', oid(OTHER_PROJECT))];
const BOTH = ['ObjectId form', 'text form'];

const found = (filter) => LOGS.filter(matchesLikeMongo(filter));
const timeReads = () => mockCrud.mock.calls
    .filter(([, { type }]) => type === SCHEMA_TYPE.TIMESHEET)
    .map(([, { data }, method]) => found(filterOf(method, data)).map((row) => row.name).sort());

beforeEach(() => {
    jest.clearAllMocks();
    scope.visibleProjectIds.mockResolvedValue([PROJECT]);
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === SCHEMA_TYPE.TIMESHEET) {
            const rows = found(filterOf(method, data));
            return method === 'findOne' ? rows[0] || null : rows;
        }
        if (type === SCHEMA_TYPE.COMPANY_USERS) return method === 'findOne' ? { userId: ME, roleType: 1 } : [{ userId: ME, roleType: 1 }];
        if (type === SCHEMA_TYPE.PROJECTS) {
            if (data[0] && data[0].isPersonal === true) return [];
            const project = { _id: oid(PROJECT), ProjectName: 'Parity', status: 'open', ProjectType: 'Fixed' };
            return method === 'findOne' ? project : [project];
        }
        return method === 'findOne' ? null : [];
    });
});

const call = async (handler, { body = {}, query = {} } = {}) => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (answer) => { r.body = answer; return r; };
    r.send = r.json;
    await handler(verified({ headers: { companyid: C }, body, query, params: {}, uid: ME }), r);
    return r;
};

const mcpContext = { companyId: C, userId: ME, actor: { kind: 'agent', userId: ME }, ip: '1.1.1.1', projectIds: [], token: { _id: 'tok', userId: ME, scopes: [], active: true }, canWrite: false };

describe('timesheet readers outside the timesheet screens match both forms of a project id', () => {
    test.each([
        ['the dashboard project utilisation card (UserDashboard getProjectUtilizationSummary)', () => call(dashboard.getProjectUtilizationSummary, { body: { projectMode: 'include', projectId: [PROJECT], ...WINDOW } })],
        ['the dashboard billable split (UserDashboard getTeamTaskTypeBreakdown)', () => call(dashboard.getTeamTaskTypeBreakdown, { body: { dimension: 'billable', projectIds: [PROJECT], ...WINDOW } })],
        ['the project billing context (Milestone billing.js loadProjectTimelogs)', () => milestoneBilling.buildBillingContext(C, PROJECT)],
        ['the hourly billing month (Milestone billing.js getHourlyBilling)', () => call(milestoneBilling.getHourlyBilling, { query: { projectId: PROJECT, month: '2026-09' } })],
        ['the MCP timesheet.read tool (Mcp/dataTools.js)', () => mcpTools.call(mcpContext, 'timesheet.read', { projectId: PROJECT })],
    ])('%s', async (_, run) => {
        await run();
        const reads = timeReads();
        expect(reads.length).toBeGreaterThan(0);
        reads.forEach((names) => expect(names).toEqual(BOTH));
    });

    test.each([
        ['text', LOGS[0]],
        ['ObjectId', LOGS[1]],
    ])('project auto-close counts time logged in the %s form as activity (projectClose/helper.js)', async (_, row) => {
        mockCrud.mockImplementation(async (companyId, { type, data }, method) => (type === SCHEMA_TYPE.TIMESHEET
            ? [row].filter(matchesLikeMongo(filterOf(method, data)))[0] || null
            : null));
        expect(await projectClose.projectHasActivitySince(C, PROJECT, new Date(0))).toBe(true);
    });
});
