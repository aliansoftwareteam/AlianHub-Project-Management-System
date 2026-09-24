const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const sameId = (a, b) => String(a) === String(b);

async function privateAndSharedTasks(owner, member, marker) {
    const hidden = await createProject(owner.api, { name: `PAL Private ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
    const shared = await createProject(owner.api, { name: `PAL Shared ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const secret = await createTask(owner.api, { project: hidden, name: `Secret ${marker}`, user: state.users.owner, companyOwnerId: owner.uid });
    const open = await createTask(owner.api, { project: shared, name: `Open ${marker}`, user: state.users.owner, companyOwnerId: owner.uid });
    return { hidden, shared, secret, open };
}

describe('command palette results follow project visibility (TSK-05)', () => {
    it('never gives a member a private project\'s tasks, and gives the shared ones their location and age', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const marker = `Zpal${uniqueSuffix()}`;
        const { hidden, shared, secret, open } = await privateAndSharedTasks(owner, member, marker);

        const res = await member.api.post('/api/v2/search', { query: marker });
        expect(res.body.status).toBe(true);
        const { tasks, projects } = res.body.data;
        expect(tasks.some((t) => sameId(t.ProjectID, hidden._id) || sameId(t._id, secret._id))).toBe(false);
        expect(projects.some((p) => sameId(p._id, hidden._id))).toBe(false);

        const row = tasks.find((t) => sameId(t._id, open._id));
        expect(row).toBeDefined();
        expect(sameId(row.ProjectID, shared._id)).toBe(true);
        expect(typeof row.sprintName).toBe('string');
        expect(row.sprintName.length).toBeGreaterThan(0);
        expect(Number.isNaN(new Date(row.updatedAt).getTime())).toBe(false);
        expect(row).not.toHaveProperty('description');

        const own = await owner.api.post('/api/v2/search', { query: marker });
        expect(own.body.data.tasks.some((t) => sameId(t._id, secret._id))).toBe(true);
    });

    it('keeps a private project\'s task out of a member\'s recently opened list, even after they record a visit to it', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const { secret, open } = await privateAndSharedTasks(owner, member, `Zrec${uniqueSuffix()}`);

        for (const task of [secret, open]) {
            const visit = await member.api.post('/api/v2/recent-visits', { entityType: 'task', entityId: task._id });
            expect(visit.body.status).toBe(true);
        }

        const res = await member.api.get('/api/v2/recent-visits');
        expect(res.body.status).toBe(true);
        const ids = (res.body.data || []).map((item) => String(item.task._id));
        expect(ids).toContain(String(open._id));
        expect(ids).not.toContain(String(secret._id));
    });
});
