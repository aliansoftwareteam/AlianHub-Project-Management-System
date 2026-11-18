const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });

const findById = (api, id) => api.post('/api/v1/task/find', { findQuery: [{ $match: { _id: { objId: { $in: [id] } } } }] });

async function projectWithTask(owner, { assigneeIds, isPrivate = false }) {
    const project = await createProject(owner.api, { name: `TQ ${uniqueSuffix()}`, assigneeIds, createdBy: owner.uid, isPrivate });
    const task = await createTask(owner.api, { project, name: `TQ Task ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
    return { project, task };
}

describe('TSK-01 — POST /api/v1/task/find', () => {
    it('refuses a member $lookup into company_users', async () => {
        const member = await loginAs('member');
        const res = await member.api.post('/api/v1/task/find', {
            findQuery: [
                { $limit: 1 },
                { $lookup: { from: 'company_users', pipeline: [{ $project: { roleType: 1 } }], as: 'x' } },
                { $project: { n: { $size: '$x' } } },
            ],
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ status: false, stage: '$lookup' });
    });

    it('refuses $unionWith and $out by stage name', async () => {
        const member = await loginAs('member');
        const union = await member.api.post('/api/v1/task/find', { findQuery: [{ $unionWith: 'users' }] });
        expect(union.status).toBe(400);
        expect(union.body.stage).toBe('$unionWith');
        const out = await member.api.post('/api/v1/task/find', { findQuery: [{ $match: {} }, { $out: 'stolen' }] });
        expect(out.status).toBe(400);
        expect(out.body.stage).toBe('$out');
    });

    it('hides a task in a private owner-only project from a member, but not from the owner', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const { task } = await projectWithTask(owner, { assigneeIds: [owner.uid], isPrivate: true });

        const asMember = await findById(member.api, task._id);
        expect(asMember.status).toBe(200);
        expect(asMember.body).toEqual([]);

        const asOwner = await findById(owner.api, task._id);
        expect(asOwner.body.map((t) => String(t._id))).toEqual([String(task._id)]);
    });

    it('still answers the board, facet and lookup shapes for a member in a shared project', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const { project, task } = await projectWithTask(owner, { assigneeIds: [owner.uid, member.uid] });

        const board = await member.api.post('/api/v1/task/find', {
            findQuery: [
                { $match: { objId: { sprintId: task.sprintId, ProjectID: project._id }, deletedStatusKey: 0 } },
                { $sort: { createdAt: 1, _id: 1 } },
                { $facet: { result: [{ $skip: 0 }, { $limit: 35 }], count: [{ $count: 'count' }] } },
            ],
        });
        expect(board.status).toBe(200);
        expect(board.body[0].result.map((t) => String(t._id))).toContain(String(task._id));

        const withNames = await member.api.post('/api/v1/task/find', {
            findQuery: [
                { $match: { objId: { _id: task._id } } },
                { $lookup: { from: 'projects', localField: 'ProjectID', foreignField: '_id', as: 'projectArr', pipeline: [{ $project: { ProjectName: 1 } }] } },
                { $unwind: { path: '$projectArr', preserveNullAndEmptyArrays: true } },
                { $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 'sprintArr', pipeline: [{ $project: { name: 1 } }] } },
                { $unwind: { path: '$sprintArr', preserveNullAndEmptyArrays: true } },
            ],
        });
        expect(withNames.status).toBe(200);
        expect(withNames.body[0].projectArr.ProjectName).toBe(project.ProjectName);
    });
});

describe('TSK-02 — PUT /api/v1/task', () => {
    it('refuses an arbitrary Mongoose operation key', async () => {
        const member = await loginAs('member');
        const res = await member.api.put('/api/v1/task', {
            firstParameter: {}, secondParameter: { _id: 1 }, key: 'estimatedDocumentCount', isConvertFirstParameter: false,
        });
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
    });

    it('refuses deleteMany and leaves the tasks in place', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const { task } = await projectWithTask(owner, { assigneeIds: [owner.uid, member.uid] });

        const res = await member.api.put('/api/v1/task', { firstParameter: { deletedStatusKey: 0 }, secondParameter: {}, key: 'deleteMany' });
        expect(res.status).toBe(403);
        expect((await findById(owner.api, task._id)).body).toHaveLength(1);
    });

    it('refuses an anonymous caller', async () => {
        const res = await anon.put('/api/v1/task', {
            firstParameter: {}, secondParameter: { _id: 1 }, key: 'estimatedDocumentCount',
        }, { headers: { companyid: state.companyId } });
        expect(res.status).toBe(401);
    });

    it('still cascades a project close to its tasks for the owner', async () => {
        const owner = await loginAs('owner');
        const { project, task } = await projectWithTask(owner, { assigneeIds: [owner.uid] });

        const res = await owner.api.put('/api/v1/task', {
            firstParameter: { objId: { ProjectID: project._id }, deletedStatusKey: 0 },
            secondParameter: { $set: { deletedStatusKey: 8 } },
            key: 'updateMany',
            isConvertFirstParameter: true,
            isConvertSecondParameter: false,
        });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        const [after] = (await findById(owner.api, task._id)).body;
        expect(after.deletedStatusKey).toBe(8);
    });
});
