const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ forStatusChange: jest.fn(async () => null), recordWork: jest.fn(async () => null) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const velocity = require('../Modules/AgileReports/velocity');
const cfd = require('../Modules/AgileReports/cfd');
const performanceRead = require('../Modules/Agents/performanceRead');
const { IDS, MEMBER_ROLE, CASES, seedAgileReports } = require('./fixtures/agileReportsSeed');
const BETA = require('./fixtures/agileReports.beta.json');

// BETA holds what origin/beta's velocity and flow handlers answered on this seed, before
// their calculations moved into velocityFor() and flowFor().

const plain = (value) => JSON.parse(JSON.stringify(value));

const handler = async (fn, uid, query) => {
    const r = { body: null };
    r.status = () => r;
    r.send = (body) => { r.body = body; return r; };
    r.json = r.send;
    await fn({ headers: { companyid: IDS.COMPANY }, query, body: {}, params: {}, uid }, r);
    return plain(r.body);
};

const velocityCase = (name) => CASES.velocity.find((c) => c.name === name);
const flowCase = (name) => CASES.flow.find((c) => c.name === name);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    process.env.AGENT_PERFORMANCE_READ = 'on';
    seedAgileReports(mockDb, SCHEMA_TYPE);
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', name: 'Project', isParent: true });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_details', name: 'project_details', isParent: false, parentId: parent._id, roles: [{ key: MEMBER_ROLE, permission: false }] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'private_projects', name: 'private_projects', isParent: false, parentId: parent._id, roles: [{ key: MEMBER_ROLE, permission: 1 }] });
});

afterAll(() => { delete process.env.AGENT_PERFORMANCE_READ; });

describe('velocity answers what beta answered', () => {
    it.each(CASES.velocity.map((c) => [c.name]))('the chart handler, %s', async (name) => {
        const c = velocityCase(name);
        expect(await handler(velocity.getVelocity, c.uid, c.query)).toEqual(BETA.velocity[name]);
    });

    it.each(CASES.velocity.map((c) => [c.name]))('velocityFor(), %s', async (name) => {
        const c = velocityCase(name);
        const limit = Math.min(50, Math.max(1, Number(c.query.limit) || 10));
        expect(plain(await velocity.velocityFor(IDS.COMPANY, c.uid, c.query.projectId, { limit }))).toEqual(BETA.velocity[name].data);
    });
});

describe('cumulative flow answers what beta answered, less the day beta drew past the range', () => {
    it.each([['owner, August'], ['member, August']])('the chart handler, %s', async (name) => {
        const c = flowCase(name);
        const beta = BETA.flow[name];
        expect(beta.data.days).toHaveLength(32);
        expect(beta.data.days[31].date).toBe('2026-09-01');
        expect(await handler(cfd.getCFD, c.uid, c.query)).toEqual({ ...beta, data: { days: beta.data.days.slice(0, 31) } });
    });

    it.each([['owner, 153 days clamped'], ['empty project']])('the chart handler, %s, unchanged', async (name) => {
        const c = flowCase(name);
        expect(await handler(cfd.getCFD, c.uid, c.query)).toEqual(BETA.flow[name]);
    });
});

describe('performance.read gives the same velocity and flow numbers', () => {
    const read = (uid, args) => performanceRead.read({ companyId: IDS.COMPANY, actor: { kind: 'agent', userId: uid, agentId: null, runId: null }, args });

    it.each([[IDS.OWNER, 'owner, limit 50', 'owner, August'], [IDS.MEMBER, 'member, limit 50', 'member, August']])('for %s', async (uid, velocityName, flowName) => {
        const out = plain(await read(uid, { projectId: IDS.PROJECT, from: '2026-07-01', to: '2026-08-31', metrics: ['velocity'] }));
        const beta = BETA.velocity[velocityName].data;
        expect(out.projects[0].velocity).toEqual({
            skipped: beta.skipped,
            sprints: beta.sprints.map(({ sprintId, name, startDate, endDate, committed, completed, completedHuman, completedAgent, rollingAvg }) => ({ sprintId, name, startDate, endDate, committed, completed, completedHuman, completedAgent, rollingAvg })),
        });

        const flow = plain(await read(uid, { projectId: IDS.PROJECT, from: '2026-08-01', to: '2026-08-31', metrics: ['flow'] }));
        expect(flow.projects[0].flow.days).toEqual(BETA.flow[flowName].data.days.slice(0, 31));
    });
});
