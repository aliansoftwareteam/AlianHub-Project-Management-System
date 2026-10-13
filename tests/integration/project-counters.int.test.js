const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

let client;
let owner;
let channelProjectId;

/* The stored quota, not what an endpoint reports: a counter that drifts only shows up
   in the company document the plan gates read. Missing fields read as 0, negatives as
   themselves, so "never below zero" is a real assertion. */
const counters = async () => {
    const company = await client.db('global').collection('companies').findOne({ _id: new ObjectId(String(state.companyId)) });
    const stored = (company && company.projectCount) || {};
    return {
        projectCount: stored.projectCount || 0,
        publicCount: stored.publicCount || 0,
        privateCount: stored.privateCount || 0,
        channels: stored.channels || 0,
        publicChannels: stored.publicChannels || 0,
        privateChannels: stored.privateChannels || 0,
    };
};

const step = (from, changes) => ({ ...from, ...changes });

const trash = (projectId) => owner.api.put(`/api/v1/project/${projectId}`, { updateObject: { deletedStatusKey: 1 } });
const restore = (projectId) => owner.api.put(`/api/v2/trash/projects/${projectId}/restore`, {});
const deleteChannel = (sprintId, projectId) => owner.api.patch(`/api/v1/sprint/${sprintId}`, {
    type: 'deleteChannel',
    companyId: owner.companyId,
    projectId,
});

const addChannel = (isPrivate) => owner.api.post('/api/v1/sprint', {
    companyId: owner.companyId,
    projectId: channelProjectId,
    sprintName: `Counter channel ${uniqueSuffix()}`,
    projectName: 'CHANNELS',
    userData: { id: owner.uid, Employee_Name: 'Owner' },
    mainChat: true,
    private: isPrivate,
    sendMessage: true,
    AssigneeUserId: [owner.uid],
    icon: {},
    folder: null,
});

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');

    const chats = await owner.api.get('/api/v1/main-chats');
    const rows = Array.isArray(chats.body) ? chats.body : (chats.body && chats.body.data) || [];
    const container = rows.find((row) => row.default !== true) || rows[0];
    channelProjectId = container && String(container._id);
});

afterAll(async () => {
    if (client) await client.close();
});

describe('the project quota follows the projects that exist', () => {
    it('gives the slot back when a project is trashed', async () => {
        const before = await counters();

        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        expect(await counters()).toEqual(step(before, { projectCount: before.projectCount + 1, publicCount: before.publicCount + 1 }));

        expect((await trash(project._id)).status).toBe(200);
        expect(await counters()).toEqual(before);
    });

    it('counts a private project in privateCount and releases it from there', async () => {
        const before = await counters();

        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        expect(await counters()).toEqual(step(before, { projectCount: before.projectCount + 1, privateCount: before.privateCount + 1 }));

        expect((await trash(project._id)).status).toBe(200);
        expect(await counters()).toEqual(before);
    });

    it('releases one slot however many times the same project is trashed', async () => {
        const before = await counters();
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });

        await trash(project._id);
        await trash(project._id);
        await trash(project._id);

        expect(await counters()).toEqual(before);
    });

    it('takes the slot back when a project is restored from the trash, once', async () => {
        const before = await counters();
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const held = await counters();

        await trash(project._id);
        expect(await counters()).toEqual(before);

        expect((await restore(project._id)).status).toBe(200);
        expect(await counters()).toEqual(held);

        await restore(project._id);
        expect(await counters()).toEqual(held);

        await trash(project._id);
    });

    it('keeps the slot when a project is only closed', async () => {
        const before = await counters();
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const held = await counters();

        expect((await owner.api.put(`/api/v1/project/${project._id}`, { updateObject: { deletedStatusKey: 2 } })).status).toBe(200);
        expect(await counters()).toEqual(held);

        await trash(project._id);
        expect(await counters()).toEqual(before);
    });

    it('leaves the counters alone for an edit that is not a delete', async () => {
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const held = await counters();

        await owner.api.put(`/api/v1/project/${project._id}`, { updateObject: { ProjectName: `Renamed ${uniqueSuffix()}` } });
        expect(await counters()).toEqual(held);

        await trash(project._id);
    });
});

/* deleteChannel answers before it touches the quota, and every channel counter write
   goes through one FIFO queue. Creating a channel joins that queue and only answers
   once its own write landed, so a create doubles as a barrier: whatever a delete under
   test was going to do has already happened by the time the create comes back. That is
   what makes "the counter did NOT move" an assertion rather than a race. */
const channelBarrier = async () => {
    const created = await addChannel(false);
    expect(created.body && created.body.status).toBe(true);
};

const heldByOnePublicChannel = (before) => step(before, {
    channels: before.channels + 1,
    publicChannels: before.publicChannels + 1,
});

describe('the channel quota counts channels only', () => {
    it('releases one channel slot however many times the same channel is deleted', async () => {
        const before = await counters();

        const created = await addChannel(false);
        expect(created.body && created.body.status).toBe(true);
        const sprintId = String(created.body.data._id);
        expect(await counters()).toEqual(heldByOnePublicChannel(before));

        expect((await deleteChannel(sprintId, channelProjectId)).body.status).toBe(true);
        await deleteChannel(sprintId, channelProjectId);
        await deleteChannel(sprintId, channelProjectId);

        await channelBarrier();
        expect(await counters()).toEqual(heldByOnePublicChannel(before));
    });

    it('tracks a private channel in privateChannels', async () => {
        const before = await counters();

        const created = await addChannel(true);
        expect(created.body && created.body.status).toBe(true);
        const sprintId = String(created.body.data._id);
        expect(await counters()).toEqual(step(before, { channels: before.channels + 1, privateChannels: before.privateChannels + 1 }));

        await deleteChannel(sprintId, channelProjectId);

        await channelBarrier();
        expect(await counters()).toEqual(heldByOnePublicChannel(before));
    });

    /* The live drift: the channel route accepts any sprint id, and a project list was
       never counted as a channel, so decrementing for one drove the quota negative. */
    it('does not spend a channel slot on a project list', async () => {
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const sprint = await firstSprint(owner.api, project._id);
        const before = await counters();

        await deleteChannel(String(sprint._id), String(project._id));

        await channelBarrier();
        expect(await counters()).toEqual(heldByOnePublicChannel(before));

        await trash(project._id);
    });

    it('never stores a negative counter', async () => {
        await channelBarrier();
        for (const [field, value] of Object.entries(await counters())) {
            expect([field, value >= 0]).toEqual([field, true]);
        }
    });
});
