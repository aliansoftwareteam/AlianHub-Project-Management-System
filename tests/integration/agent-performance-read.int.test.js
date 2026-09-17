const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* performance.read through the real MCP endpoint, a minted token and the real database.
 * The harness runs the server with AGENT_PERFORMANCE_READ=on. */

const state = readState();
const DAY_MS = 86400000;

jest.setTimeout(120000);

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const TO = isoDay(Date.now());
const FROM = isoDay(Date.now() - 6 * DAY_MS);
const LOGGED_AT = Math.floor((Date.now() - 2 * DAY_MS) / 1000);

const mcpCall = (token, name, args) => createApiClient({ baseURL: state.baseURL, accessToken: token, companyId: state.companyId })
    .post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

const payloadOf = (res) => JSON.parse(res.body.result.content[0].text);

const mintToken = async (session, projectIds) => {
    const res = await session.api.post('/api/v2/api-tokens/mcp', { name: `[QA perf] ${uniqueSuffix()}`, mode: 'personal', projectIds, expiresInDays: 1 });
    expect(res.body.status).toBe(true);
    return res.body.data;
};

const projectTimesheetMinutes = async (session, projectId, { owner = false } = {}) => {
    const res = await session.api.post('/api/v1/timesheet/project', {
        projectIds: [projectId],
        filterProjectIds: owner ? [projectId] : [],
        filterUserIds: [],
        startNumber: Date.parse(`${FROM}T00:00:00.000Z`),
        endNumber: Date.parse(`${TO}T23:59:59.999Z`),
        timeZone: 'UTC',
    });
    expect(res.status).toBe(200);
    return res.body.reduce((sum, group) => sum + group.totalCount, 0);
};

describe('performance.read over MCP', () => {
    let client;
    let db;
    let owner;
    let member;
    let project;
    let task;
    const tokens = [];

    beforeAll(async () => {
        client = await MongoClient.connect(resolveMongoUrl());
        db = client.db(state.companyId);
        owner = await loginAs('owner');
        member = await loginAs('member');
        const everyone = Object.values(state.users).map((u) => u.userId);
        project = await createProject(owner.api, { assigneeIds: everyone, createdBy: owner.uid });
        task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: state.users.owner.userId });
        const row = (userId, minutes, billable) => ({
            LogDescription: '[QA perf] log', Loggeduser: userId, TicketID: task._id, ProjectId: String(project._id),
            LogStartTime: LOGGED_AT, LogEndTime: LOGGED_AT + minutes * 60, LogTimeDuration: minutes, logAddType: 1, trackShots: [], billable,
        });
        await db.collection('timesheets').insertMany([
            row(state.users.member.userId, 40, true),
            row(state.users.owner.userId, 25, false),
        ]);
    });

    afterAll(async () => {
        for (const { session, id } of tokens) await session.api.delete(`/api/v2/api-tokens/${id}`);
        await db.collection('timesheets').deleteMany({ ProjectId: String(project._id) });
        await client.close();
    });

    const tokenFor = async (session, projectIds) => {
        const minted = await mintToken(session, projectIds);
        tokens.push({ session, id: minted._id });
        return minted.token;
    };

    it('is offered in the tool list', async () => {
        const token = await tokenFor(member, [String(project._id)]);
        const res = await createApiClient({ baseURL: state.baseURL, accessToken: token, companyId: state.companyId })
            .post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
        expect(res.body.result.tools.map((t) => t.name)).toContain('performance.read');
    });

    it('gives the member the numbers their project timesheet shows, and keeps the query in the replay record', async () => {
        const token = await tokenFor(member, [String(project._id)]);
        const res = await mcpCall(token, 'performance.read', { projectId: String(project._id), from: FROM, to: TO });
        expect(res.body.result.isError).toBeFalsy();
        const out = payloadOf(res);
        const [numbers] = out.projects;

        expect(numbers.projectId).toBe(String(project._id));
        expect(numbers.time).toMatchObject({ totalMinutes: 40, billableMinutes: 40, nonBillableMinutes: 0, whose: 'self' });
        expect(numbers.time.totalMinutes).toBe(await projectTimesheetMinutes(member, String(project._id)));
        expect(numbers.variance).toMatchObject({ tasks: 1, totalActual: 40 });

        const flow = await member.api.get('/api/v1/agile/cfd', { query: { projectId: String(project._id), from: FROM, to: TO } });
        expect(numbers.flow.days).toEqual(flow.body.data.days);
        expect(numbers.flow.days).toHaveLength(7);

        const replay = await db.collection('ai_replays').findOne({ _id: new ObjectId(out.replayId) });
        expect(replay).toMatchObject({
            kind: 'tool',
            feature: 'agent_run',
            query: {
                action: 'performance.read',
                args: { projectIds: [String(project._id)], from: FROM, to: TO, metrics: ['time', 'variance', 'velocity', 'flow'] },
                scope: { userId: state.users.member.userId, narrowedTo: [String(project._id)] },
            },
        });
        expect(replay.result.projects[0].time).toEqual(numbers.time);
    });

    it('gives the owner company time, matching the owner\'s project timesheet', async () => {
        const token = await tokenFor(owner, []);
        const out = payloadOf(await mcpCall(token, 'performance.read', { projectId: String(project._id), from: FROM, to: TO, metrics: ['time'] }));
        expect(out.projects[0].time).toMatchObject({ totalMinutes: 65, billableMinutes: 40, nonBillableMinutes: 25, whose: 'company' });
        expect(out.projects[0].time.totalMinutes).toBe(await projectTimesheetMinutes(owner, String(project._id), { owner: true }));
    });

    it('refuses a project the member cannot open, and one outside the token', async () => {
        const token = await tokenFor(member, [String(project._id)]);
        const restricted = payloadOf(await mcpCall(token, 'performance.read', { projectId: state.projects.restricted._id, from: FROM, to: TO }));
        expect(restricted).toMatchObject({ refused: true, reason: expect.stringMatching(state.projects.restricted._id) });

        const outside = payloadOf(await mcpCall(token, 'performance.read', { projectId: state.projects.shared._id, from: FROM, to: TO }));
        expect(outside).toMatchObject({ refused: true, reason: expect.stringMatching(state.projects.shared._id) });
    });

    it('refuses a range longer than 120 days', async () => {
        const token = await tokenFor(member, [String(project._id)]);
        const out = payloadOf(await mcpCall(token, 'performance.read', { projectId: String(project._id), from: isoDay(Date.now() - 130 * DAY_MS), to: TO }));
        expect(out).toMatchObject({ refused: true, reason: expect.stringMatching(/at most 120 days/) });
    });
});
