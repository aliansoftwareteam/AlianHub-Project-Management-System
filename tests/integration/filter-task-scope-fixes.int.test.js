const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const sameId = (a, b) => String(a) === String(b);

async function ownerProjectFilter(owner) {
    const res = await owner.api.post('/api/v1/project/filter/create', { name: `SCOPE Filter ${uniqueSuffix()}`, filter: 'projectFilter', typeFilter: 'projects' });
    expect(res.body.status).toBe(true);
    return res.body.data;
}

async function privateOwnerTask(owner) {
    const project = await createProject(owner.api, { name: `SCOPE Private ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
    return createTask(owner.api, { project, name: `SCOPE Secret ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
}

describe('saved project filters belong to their owner', () => {
    it('refuses to list another user\'s project filters, while the owner lists their own', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const filter = await ownerProjectFilter(owner);
        try {
            const theirs = await member.api.get(`/api/v1/project/filter/${owner.uid}`);
            expect(theirs.status).toBe(403);
            expect(JSON.stringify(theirs.body)).not.toContain(filter.name);

            const mine = await owner.api.get(`/api/v1/project/filter/${owner.uid}`);
            expect(mine.status).toBe(200);
            expect(mine.body.data.some((f) => sameId(f._id, filter._id))).toBe(true);
            expect(mine.body.data.every((f) => sameId(f.userId, owner.uid))).toBe(true);
        } finally {
            await owner.api.delete(`/api/v1/project/filter/delete/${owner.companyId}/${filter._id}`);
        }
    });

    it('refuses to delete another user\'s project filter, while the owner still can', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const filter = await ownerProjectFilter(owner);

        expect((await member.api.delete(`/api/v1/project/filter/delete/${state.companyId}/${filter._id}`)).status).toBe(404);
        const listed = (await owner.api.get(`/api/v1/project/filter/${owner.uid}`)).body.data;
        expect(listed.some((f) => sameId(f._id, filter._id))).toBe(true);

        expect((await owner.api.delete(`/api/v1/project/filter/delete/${state.companyId}/${filter._id}`)).status).toBe(200);
        const after = (await owner.api.get(`/api/v1/project/filter/${owner.uid}`)).body.data;
        expect(after.some((f) => sameId(f._id, filter._id))).toBe(false);
    });

    it('saves a project filter for the caller even when the body names someone else', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const name = `SCOPE Planted ${uniqueSuffix()}`;
        const res = await member.api.post('/api/v1/project/filter/create', { name, userId: owner.uid, filter: 'projectFilter', typeFilter: 'projects' });
        expect(res.status).toBe(200);
        try {
            expect(sameId(res.body.data.userId, member.uid)).toBe(true);
            const ownerList = (await owner.api.get(`/api/v1/project/filter/${owner.uid}`)).body.data;
            expect(ownerList.some((f) => f.name === name)).toBe(false);
        } finally {
            await member.api.delete(`/api/v1/project/filter/delete/${state.companyId}/${res.body.data._id}`);
        }
    });
});

describe('GET /api/v1/task/:id follows project visibility', () => {
    it('answers 404 to a member and a guest for a task in a private project they are not on, and serves the owner and an admin', async () => {
        const owner = await loginAs('owner');
        const task = await privateOwnerTask(owner);

        for (const role of ['member', 'guest']) {
            const session = await loginAs(role);
            const res = await session.api.get(`/api/v1/task/${task._id}`);
            expect(res.status).toBe(404);
            expect(JSON.stringify(res.body)).not.toContain('SCOPE Secret');
        }
        for (const role of ['owner', 'admin']) {
            const session = await loginAs(role);
            const res = await session.api.get(`/api/v1/task/${task._id}`);
            expect(res.status).toBe(200);
            expect(sameId(res.body._id, task._id)).toBe(true);
        }
    });

    it('serves a task in the shared project to the member and the guest assigned to it', async () => {
        for (const role of ['member', 'guest']) {
            const session = await loginAs(role);
            const res = await session.api.get(`/api/v1/task/${state.tasks[0]._id}`);
            expect(res.status).toBe(200);
            expect(sameId(res.body._id, state.tasks[0]._id)).toBe(true);
        }
    });

    it('answers a task that does not exist with the same 404 as a hidden one', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const task = await privateOwnerTask(owner);

        const hidden = await member.api.get(`/api/v1/task/${task._id}`);
        const missing = await member.api.get('/api/v1/task/6f0000000000000000000fff');
        expect(missing.status).toBe(404);
        expect(hidden.status).toBe(404);
        expect(hidden.body).toEqual(missing.body);
    });
});
