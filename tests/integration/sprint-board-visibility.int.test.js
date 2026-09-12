const { assertOk, createProject, listSprints, loginAs, uniqueSuffix } = require('../../e2e/support/fixtures');

/* The board hangs its tasks off the sprints it can see, so a sprint that exists only
 * in the sprints collection renders nothing unless the read path returns it. These
 * assert the whole round trip — create through the API, read back the way the board
 * reads — rather than that the row landed in the collection. */

/* addSprintFun reads companyId off the body, not the companyid header, and the
 * per-project quota check silently refuses with "Upgrade your plan" when it is absent. */
const addSprint = (api, { companyId, projectId, projectName, sprintName, user }) => api.post('/api/v1/sprint', {
    companyId,
    projectId,
    projectName,
    sprintName,
    userData: { id: user.uid, Employee_Name: user.Employee_Name || 'Owner', companyOwnerId: user.companyOwnerId || user.uid },
    folder: {},
});

const sprintNames = (sprints) => sprints.map((sprint) => sprint.name).sort();

describe('a sprint is visible to the board wherever it was created', () => {
    it('shows a sprint created through POST /api/v1/sprint', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const name = `Board visible ${uniqueSuffix()}`;

        const created = await addSprint(owner.api, { companyId: owner.companyId, projectId: project._id, projectName: project.ProjectName, sprintName: name, user: owner });
        assertOk(created, 'create sprint');
        expect(created.body.status).toBe(true);

        const sprints = await listSprints(owner.api, project._id);
        expect(sprintNames(sprints)).toEqual(['List', name].sort());
    });

    it('shows the default sprint POST /api/v1/createproject makes', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });

        expect(sprintNames(await listSprints(owner.api, project._id))).toEqual(['List']);
    });

    /* Pins the reason the board must not read the project document: no sprint write
     * maintains its sprintsObj, so a reader that trusts it sees an empty board. */
    it('does not put either sprint on the project document', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const name = `Not embedded ${uniqueSuffix()}`;
        assertOk(await addSprint(owner.api, { companyId: owner.companyId, projectId: project._id, projectName: project.ProjectName, sprintName: name, user: owner }), 'create sprint');

        const res = await owner.api.get(`/api/v1/project/${project._id}`);
        assertOk(res, 'read project');

        expect(Object.values(res.body.sprintsObj || {}).map((sprint) => sprint && sprint.name)).not.toContain(name);
        expect(sprintNames(await listSprints(owner.api, project._id))).toContain(name);
    });
});
