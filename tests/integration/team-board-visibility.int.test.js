const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(120000);

const MINUTE = 60;
const nowSec = () => Math.floor(Date.now() / 1000);

const boardAs = async (session) => {
    const res = await session.api.get('/api/v2/agents/team');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    return res.body.data;
};

const personOf = (data, role) => data.people.find((p) => p.id === state.users[role].userId);

describe('GET /api/v2/agents/team shows task names and logged hours only where the viewer may see them', () => {
    let client;
    let db;
    let owner;
    let admin;
    let member;
    let guest;
    let shared;
    let hidden;
    let privateName;
    let sprintName;
    let sharedName;
    let sprintId;
    let agentId;
    let runId;
    let workloadRule;

    beforeAll(async () => {
        client = await MongoClient.connect(resolveMongoUrl());
        db = client.db(state.companyId);
        [owner, admin, member, guest] = await Promise.all(['owner', 'admin', 'member', 'guest'].map(loginAs));
        const everyone = Object.values(state.users).map((u) => u.userId);
        const suffix = uniqueSuffix();

        hidden = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        shared = await createProject(owner.api, { assigneeIds: everyone, createdBy: owner.uid });

        privateName = `[QA team] private-project task ${suffix}`;
        sprintName = `[QA team] private-sprint task ${suffix}`;
        sharedName = `[QA team] shared task ${suffix}`;
        const privateTask = await createTask(owner.api, { project: hidden, name: privateName, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
        const sprintTask = await createTask(owner.api, { project: shared, name: sprintName, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [admin.uid] });
        const sharedTask = await createTask(owner.api, { project: shared, name: sharedName, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [member.uid] });

        const sprint = await db.collection('sprints').insertOne({
            name: `[QA team] private ${suffix}`, projectId: new ObjectId(String(shared._id)), private: true, AssigneeUserId: [owner.uid, admin.uid],
            deletedStatusKey: 0,
        });
        sprintId = sprint.insertedId;
        await db.collection('tasks').updateOne({ _id: new ObjectId(sprintTask._id) }, { $set: { sprintId, sprintArray: { id: String(sprintId), name: 'private' }, updatedAt: new Date() } });

        const logged = (userId, task, project, minutes) => ({
            LogDescription: '[QA team] log', Loggeduser: userId, TicketID: task._id, ProjectId: String(project._id),
            LogStartTime: nowSec() - 2 * MINUTE, LogEndTime: nowSec() - 2 * MINUTE + minutes * MINUTE, LogTimeDuration: minutes, logAddType: 1, trackShots: [],
        });
        await db.collection('timesheets').insertMany([
            logged(owner.uid, sharedTask, shared, 120),
            logged(owner.uid, privateTask, hidden, 60),
            logged(member.uid, sharedTask, shared, 30),
            {
                LogDescription: '[QA team] timer', Loggeduser: owner.uid, TicketID: privateTask._id, ProjectId: String(hidden._id),
                LogStartTime: nowSec() - 10 * MINUTE, LogEndTime: null, startTimeTracker: nowSec(), logAddType: 1, trackShots: [],
            },
        ]);

        const agent = await db.collection('agents').insertOne({ name: `[QA team] agent ${suffix}`, ownerId: owner.uid, autonomy: 0, paused: false, deletedStatusKey: 0, createdAt: new Date() });
        agentId = agent.insertedId;
        ({ insertedId: runId } = await db.collection('agent_runs').insertOne({
            agentId: String(agentId), agentName: `[QA team] agent ${suffix}`, taskId: String(privateTask._id), projectId: String(hidden._id),
            status: 'waiting_approval', outcome: `[QA team] outcome ${suffix}`, startedAt: new Date(), startedBy: owner.uid,
        }));

        const rules = await owner.api.get('/api/v1/securityPermissions');
        workloadRule = rules.body.find((rule) => rule.key === 'workload_timesheet');
        expect(workloadRule).toBeTruthy();
    });

    afterAll(async () => {
        if (workloadRule) {
            await owner.api.put('/api/v1/securityPermissions', { type: 'updateOne', key: '$set', id: workloadRule._id, updateObject: { roles: workloadRule.roles } });
        }
        await db.collection('timesheets').deleteMany({ LogDescription: /^\[QA team\]/ });
        await db.collection('agent_runs').deleteMany({ agentId: String(agentId) });
        await db.collection('agents').deleteOne({ _id: agentId });
        await db.collection('sprints').deleteOne({ _id: sprintId });
        await client.close();
    });

    it.each(['member', 'guest'])('never names a task the %s cannot open', async (role) => {
        const session = { member, guest }[role];
        const data = await boardAs(session);
        const body = JSON.stringify(data);
        expect(body).not.toContain(privateName);
        expect(body).not.toContain(sprintName);
        expect(body).not.toContain(String(hidden._id));
        expect(body).not.toContain(hidden.ProjectCode);

        const ownerRow = personOf(data, 'owner');
        expect(ownerRow.status).toBe('working');
        expect(ownerRow.timer).toMatchObject({ taskId: '', taskName: '', hidden: true });
        expect(ownerRow.nowOn).toBe('');
        expect(ownerRow.nowOnHidden).toBe(true);

        const agentRow = data.agents.find((a) => a.id === String(agentId));
        expect(agentRow.run).toMatchObject({ taskId: '', taskKey: '', taskName: '', hidden: true });
        expect(agentRow.nowOn).toBe('');
        expect(data.activity.map((a) => a.runId)).not.toContain(String(runId));
        expect(body).not.toMatch(/\[QA team\] outcome/);
    });

    it('still names a task the member can open', async () => {
        const data = await boardAs(member);
        expect(personOf(data, 'member').nowOn).toBe(sharedName);
    });

    it.each(['owner', 'admin'])('keeps full detail for the %s', async (role) => {
        const data = await boardAs({ owner, admin }[role]);
        const ownerRow = personOf(data, 'owner');
        expect(ownerRow.timer.taskName).toBe(privateName);
        expect(ownerRow.nowOn).toBe(privateName);
        expect(ownerRow.loggedHours).toBe(3);
        expect(personOf(data, 'admin').nowOn).toBe(sprintName);
        const agentRow = data.agents.find((a) => a.id === String(agentId));
        expect(agentRow.run.taskName).toBe(privateName);
        expect(data.activity.map((a) => a.runId)).toContain(String(runId));
        expect(typeof data.totals.load).toBe('number');
    });
});
