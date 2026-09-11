const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const forbidden = (res) => res.status === 403 && res.body && res.body.status === false;

/* The API guards only judge personal API tokens (web sessions pass through by design), so every
 * call here is made the way the MCP server makes it: with a token the member minted for themself. */
async function tokenClientFor(session) {
    const res = await session.api.post('/api/v2/api-tokens', { name: `Member permissions ${uniqueSuffix()}`, scopes: ['read', 'write'] });
    if (!res.body || res.body.status !== true) throw new Error(`token for ${session.email} failed: ${JSON.stringify(res.body)}`);
    return createApiClient({ baseURL: state.baseURL, accessToken: res.body.data.token, companyId: state.companyId });
}

const today = () => new Date().toISOString().slice(0, 10);

let owner;
let member;
let memberApi;
let project;

beforeAll(async () => {
    owner = await loginAs('owner');
    member = await loginAs('member');
    memberApi = await tokenClientFor(member);
    project = await createProject(owner.api, { assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
});

describe('a member of a brand-new company', () => {
    it('holds the Member defaults the Security & Permissions matrix shows', async () => {
        const res = await memberApi.get('/api/v2/api-tokens/me');
        expect(res.status).toBe(200);
        expect(res.body.data.roleType).toBe(3);
        expect(res.body.data.permissions).toMatchObject({
            'task.task_list': true,
            'task.task_create': true,
            'task.task_comment': true,
            'task.task_priority': true,
            'sheet_settings.user_timesheet': 1,
            'project.project_details': false,
            'project.project_create': null,
            'project.project_sprint_create': null,
            'project.project_name_edit': null,
            'sheet_settings.workload_timesheet': null,
        });
    });

    it('creates a task in a project they belong to', async () => {
        const task = await createTask(memberApi, { project, user: member, companyOwnerId: owner.uid });
        expect(task._id).toMatch(/^[a-f0-9]{24}$/);
    });

    it('comments on that task', async () => {
        const task = await createTask(memberApi, { project, user: member, companyOwnerId: owner.uid });
        const res = await memberApi.post('/api/v1/comments', {
            data: {
                message: 'Member comment',
                type: 'text',
                userId: member.uid,
                objId: { projectId: project._id, sprintId: task.sprintId, taskId: task._id },
                project: false,
                mentionIds: [],
                isDeleted: false,
                hasReply: false,
                replyMessageId: '',
                mediaURL: '',
                mediaName: '',
                mediaSize: 0,
            },
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { userId: member.uid } });
    });

    it('logs time on that task', async () => {
        const task = await createTask(memberApi, { project, user: member, companyOwnerId: owner.uid });
        const res = await memberApi.post('/api/v2/manualLogtime', {
            logTimeDate: today(),
            description: 'Member log',
            startLogTime: '09:00',
            endLogTime: '09:30',
            timeDuration: '00:30',
            ticketId: task._id,
            projectId: project._id,
            companyId: state.companyId,
            userId: member.uid,
            isEdit: false,
            userName: 'Max Member',
            dateFormat: 'DD/MM/YYYY',
            timeSheetId: '',
            sprintId: task.sprintId,
            taskName: 'E2E Task',
            companyOwnerId: owner.uid,
            projectName: project.ProjectName,
            previousLoggedTime: '',
            timeZone: 'UTC',
            timeFormat: '24',
            billable: true,
        });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });

    it('is refused what the defaults leave at None', async () => {
        expect(forbidden(await memberApi.post('/api/v1/createproject', { ProjectName: `Member project ${uniqueSuffix()}` }))).toBe(true);
        expect(forbidden(await memberApi.post('/api/v1/sprint', { projectId: project._id, sprintName: `Member sprint ${uniqueSuffix()}` }))).toBe(true);
        expect(forbidden(await memberApi.put('/api/v1/securityPermissions', { type: 'updateOne', key: '$set', id: project._id, updateObject: { roles: [] } }))).toBe(true);
    });

    it('is refused a task in a project whose own rules set Task create to None', async () => {
        const own = await createProject(owner.api, { assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
        const imported = await owner.api.post('/api/v1/importSettingsProjectFunction', { companyId: state.companyId, type: 'project', projectId: own._id });
        expect(imported.body.status).toBe(true);
        expect((await owner.api.put(`/api/v1/project/${own._id}`, { updateObject: { isGlobalPermission: false } })).status).toBe(200);

        const rules = await owner.api.get(`/api/v1/projectRules/${own._id}`);
        const taskCreate = rules.body.find((rule) => rule.key === 'task_create');
        expect(taskCreate.roles.find((role) => role.key === 3)).toMatchObject({ permission: true });
        const roles = [...taskCreate.roles.filter((role) => role.key !== 3), { key: 3, permission: null }];
        const updated = await owner.api.put('/api/v1/projectRules/update', { updateObject: { roles }, key: '$set', id: taskCreate._id, projectId: own._id });
        expect(updated.status).toBe(200);

        await expect(createTask(memberApi, { project: own, user: member, companyOwnerId: owner.uid })).rejects.toThrow(/\(403\)/);
        await expect(createTask(memberApi, { project, user: member, companyOwnerId: owner.uid })).resolves.toMatchObject({ projectId: project._id });
    });
});
