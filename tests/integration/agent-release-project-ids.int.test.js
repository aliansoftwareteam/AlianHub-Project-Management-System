const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(120000);

const ok = (res) => {
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    return res.body.data;
};

describe('agent release proposals and agent project lists show only projects the viewer can open', () => {
    let client;
    let db;
    let owner;
    let admin;
    let member;
    let hidden;
    let joined;
    let open;
    let sprintId;
    let scopedAgentId;
    let hiddenOnlyAgentId;
    const marker = {};
    const tag = `[QA arp] ${uniqueSuffix()}`;

    beforeAll(async () => {
        client = await MongoClient.connect(resolveMongoUrl());
        db = client.db(state.companyId);
        [owner, admin, member] = await Promise.all(['owner', 'admin', 'member'].map(loginAs));
        const everyone = Object.values(state.users).map((u) => u.userId);

        hidden = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        joined = await createProject(owner.api, { assigneeIds: [owner.uid, member.uid], createdBy: owner.uid, isPrivate: true });
        open = await createProject(owner.api, { assigneeIds: everyone, createdBy: owner.uid });

        const taskIn = (project, name) => createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
        const [hiddenTask, joinedTask, openTask, sprintTask] = await Promise.all([
            taskIn(hidden, `${tag} hidden task`),
            taskIn(joined, `${tag} joined task`),
            taskIn(open, `${tag} open task`),
            taskIn(open, `${tag} private-sprint task`),
        ]);
        marker.sprintTaskName = `${tag} private-sprint task`;
        marker.openTaskName = `${tag} open task`;

        ({ insertedId: sprintId } = await db.collection('sprints').insertOne({
            name: `${tag} private`, projectId: new ObjectId(String(open._id)), private: true, AssigneeUserId: [owner.uid], deletedStatusKey: 0,
        }));
        await db.collection('tasks').updateOne({ _id: new ObjectId(sprintTask._id) }, { $set: { sprintId, sprintArray: { id: String(sprintId), name: 'private' } } });

        const proposal = (key, project, task) => {
            marker[key] = `${tag} proposal ${key}`;
            return {
                agentId: String(new ObjectId()), agentName: `${tag} agent`, taskId: task ? String(task._id) : undefined, projectId: String(project._id),
                what: marker[key], why: `${marker[key]} because`, changes: [], status: 'pending', gate: 'owner_admin', createdAt: new Date(), updatedAt: new Date(),
            };
        };
        await db.collection('agent_proposals').insertMany([
            proposal('hiddenTask', hidden, hiddenTask),
            proposal('hiddenProject', hidden, null),
            proposal('sprint', open, sprintTask),
            proposal('joined', joined, joinedTask),
            proposal('open', open, openTask),
        ]);

        const agent = (name, projectIds) => ({ name: `${tag} ${name}`, ownerId: owner.uid, autonomy: 0, paused: false, deletedStatusKey: 0, projectIds, createdAt: new Date() });
        const agents = await db.collection('agents').insertMany([
            agent('scoped agent', [String(hidden._id), String(joined._id)]),
            agent('hidden-only agent', [String(hidden._id)]),
        ]);
        [scopedAgentId, hiddenOnlyAgentId] = [agents.insertedIds[0], agents.insertedIds[1]].map(String);
    });

    afterAll(async () => {
        await db.collection('agent_proposals').deleteMany({ agentName: `${tag} agent` });
        await db.collection('agents').deleteMany({ name: { $regex: `^${tag.replace(/[[\]]/g, '\\$&')}` } });
        await db.collection('sprints').deleteOne({ _id: sprintId });
        await client.close();
    });

    const releaseAs = async (session) => ok(await session.api.get('/api/v2/agents/release'));
    const whatsOf = (data) => data.staging.proposals.map((p) => p.what);

    describe('GET /api/v2/agents/release', () => {
        it('leaves out proposals on a private project the member is not in, or in a private sprint they are not on', async () => {
            const data = await releaseAs(member);
            const body = JSON.stringify(data);
            expect(body).not.toContain(marker.hiddenTask);
            expect(body).not.toContain(marker.hiddenProject);
            expect(body).not.toContain(marker.sprint);
            expect(body).not.toContain(String(hidden._id));
            expect(whatsOf(data)).toEqual(expect.arrayContaining([marker.joined, marker.open]));
        });

        it.each(['owner', 'admin'])('keeps every proposal for the %s', async (role) => {
            const data = await releaseAs({ owner, admin }[role]);
            expect(whatsOf(data)).toEqual(expect.arrayContaining([marker.hiddenTask, marker.hiddenProject, marker.sprint, marker.joined, marker.open]));
        });
    });
});
