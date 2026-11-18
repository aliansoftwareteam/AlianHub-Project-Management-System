const { createProject, listSprints, loginAs } = require('../../e2e/support/fixtures');

describe('POST /api/v1/createproject default sprint', () => {
    it('has the default List sprint by the time it responds', async () => {
        const owner = await loginAs('owner');
        const projects = await Promise.all(Array.from({ length: 10 },() => createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid })
            .then(async (project) => ({ project, sprints: await listSprints(owner.api, project._id) }))));

        for (const { sprints } of projects) {
            expect(sprints.map((sprint) => sprint.name)).toEqual(['List']);
        }
    });
});
