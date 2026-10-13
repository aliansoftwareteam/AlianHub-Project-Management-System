const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');

test.describe('global search as a guest', () => {
    test.use(asRole('guest'));

    test('TSK-05: search does not leak an owner-only project to a guest', async ({ state, loginAs }) => {
        const owner = await loginAs('owner');
        const marker = `Zleak${uniqueSuffix()}`;
        const project = await createProject(owner.api, { name: `VIS Leak ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        await createTask(owner.api, { project, name: `Leak ${marker}`, user: state.users.owner, companyOwnerId: owner.uid });

        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v2/search', { query: marker });
        expect(res.body.status).toBe(true);
        expect((res.body.data.tasks || []).some((t) => String(t.ProjectID) === String(project._id))).toBe(false);
    });
});
