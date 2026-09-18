const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { assertOk, createProject, createTask, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Sprint 8 slice 3c. Browser sessions with the workspace in the default `off` mode: the index routes are validated, the actor
 * and the project come from the session and the stored task, and a missing task answers 404. */

const state = readState();
const DEADLINE_MS = 10000;
const HTML_NAME = '<img src=x onerror=alert(1)>';

let client;
let owner;
let member;

const db = () => client.db(state.companyId);
const stored = (taskId) => db().collection('tasks').findOne({ _id: new ObjectId(String(taskId)) });
const historyOf = (taskId) => db().collection('history').find({ TaskId: String(taskId) }).toArray();
const sprintOf = (sprintId) => db().collection('sprints').findOne({ _id: new ObjectId(String(sprintId)) });

const waitFor = async (read, what) => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not happen within ${DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

const projectSlice = (project) => ({ _id: project._id, id: project._id, CompanyId: state.companyId, ProjectName: project.ProjectName, ProjectCode: project.ProjectCode });

const dragBody = (task, project, extra = {}) => ({
    relevantIndex: 0, projectId: project._id, companyId: state.companyId, taskId: task._id, isFirst: true, isFirstWithRecord: false,
    indexName: 'groupByStatusIndex', sprintId: task.sprintId, relevantKey: 1, searchKey: 'statusKey', taskKey: 'X-1', updateData: {}, ...extra,
});

const onloadBody = (task, item = {}) => ({
    taskUpdate: { data: task._id, item: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 1, ...item }, taskKey: 'X-1' },
    companyId: state.companyId,
});

const priorityBody = (project, task, extra = {}) => ({
    action: 'updatePriority',
    firebaseObj: { Task_Priority: 'HIGH' },
    projectData: projectSlice(project),
    taskData: { _id: task._id, sprintId: task.sprintId, ProjectID: project._id },
    priorityObj: { taskId: task._id, taskName: 'task', priorityName: 'MEDIUM', newPriorityName: 'HIGH' },
    isUpdateTask: true,
    userData: { id: member.uid, Employee_Name: 'Max Member', companyOwnerId: owner.uid },
    ...extra,
});

const setWorkspaceMode = (mode) => client.db('global').collection('companies').updateOne(
    { _id: new ObjectId(state.companyId) },
    mode ? { $set: { permissionEnforcement: { mode } } } : { $unset: { permissionEnforcement: '' } },
);

let target;

const freshTask = async (api = owner.api, user = state.users.owner) => {
    const task = await createTask(api, { project: target.project, user, companyOwnerId: owner.uid });
    await waitFor(async () => {
        const doc = await stored(task._id);
        return doc && doc.TaskKey !== '--' && doc.groupByStatusIndex !== undefined;
    }, 'the task key');
    return task;
};

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    await setWorkspaceMode(null);
    owner = await loginAs('owner');
    member = await loginAs('member');
    const project = await createProject(owner.api, { name: `TIA ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const other = await createProject(owner.api, { name: `TIA Other ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const sprint = await firstSprint(owner.api, project._id);
    target = { project, other, sprint };
});

afterAll(async () => {
    if (client) await client.close();
});

describe('the index routes', () => {
    it('refuse a query fragment in a search key or value and leave the task alone', async () => {
        const task = await freshTask();
        const before = await stored(task._id);
        const cases = [
            member.api.post('/api/v1/taskIndex', dragBody(task, target.project, { searchKey: '$expr', relevantKey: { $eq: [1, 1] } })),
            member.api.post('/api/v1/taskIndex', dragBody(task, target.project, { relevantKey: { $function: { body: 'function() { return true; }', args: [], lang: 'js' } } })),
            member.api.post('/api/v1/taskIndex', dragBody(task, target.project, { searchKey: 'TaskName' })),
            member.api.post('/api/v1/taskIndex', dragBody(task, target.project, { relevantIndex: { $gt: 0 } })),
            member.api.post('/api/v1/taskIndex', dragBody(task, target.project, { taskId: { $ne: null } })),
            member.api.post('/api/v1/updateTaskIndexOnload', onloadBody(task, { searchKey: '$where' })),
            member.api.post('/api/v1/updateTaskIndexOnload', onloadBody(task, { searchValue: { $ne: null } })),
            member.api.post('/api/v1/updateTaskIndexOnload', { ...onloadBody(task), taskUpdate: { data: task._id, item: 'groupByStatusIndex' } }),
        ];
        const results = await Promise.all(cases);
        expect(results.map((res) => res.status)).toEqual(results.map(() => 400));
        results.forEach((res) => expect(res.body).toMatchObject({ status: false }));
        expect(await stored(task._id)).toEqual(before);
    });

    it('answer 404 for a task that does not exist', async () => {
        const missing = String(new ObjectId());
        const drag = await member.api.post('/api/v1/taskIndex', dragBody({ _id: missing, sprintId: String(target.sprint._id || target.sprint.id) }, target.project));
        const onload = await member.api.post('/api/v1/updateTaskIndexOnload', onloadBody({ _id: missing }));
        expect([drag.status, onload.status]).toEqual([404, 404]);
    });

    it('still reorder a board drag and backfill a board load', async () => {
        const task = await freshTask();
        const drag = await member.api.post('/api/v1/taskIndex', dragBody(task, target.project, {
            indexName: 'groupByPriorityIndex', searchKey: 'Task_Priority', relevantKey: 'HIGH', updateData: { Task_Priority: 'HIGH' },
        }));
        expect([drag.status, drag.body.status]).toEqual([200, true]);
        const dragged = await waitFor(async () => { const doc = await stored(task._id); return doc.Task_Priority === 'HIGH' ? doc : null; }, 'the drag');
        expect(typeof dragged.groupByPriorityIndex).toBe('number');

        await db().collection('tasks').updateOne({ _id: new ObjectId(task._id) }, { $unset: { groupByPriorityIndex: '' } });
        const load = await member.api.post('/api/v1/updateTaskIndexOnload', onloadBody(task, { indexName: 'groupByPriorityIndex', searchKey: 'Task_Priority', searchValue: 'HIGH' }));
        expect([load.status, load.body.status]).toEqual([200, true]);
        expect(typeof (await stored(task._id)).groupByPriorityIndex).toBe('number');
    });
});

describe('an id in value position', () => {
    it('must name one task', async () => {
        const task = await freshTask();
        const before = await stored(task._id);
        const move = await member.api.patch('/api/v2/tasks', {
            action: 'moveTask', companyId: state.companyId, projectData: projectSlice(target.other), sprintObj: { id: String(target.sprint._id || target.sprint.id), name: target.sprint.name, folderId: null },
            moveTaskId: { $ne: null }, oldSprintObj: { id: task.sprintId, folderId: null, name: target.sprint.name, folderName: '' }, oldProject: { id: target.project._id }, isSubTask: false, assignee: [], watcher: [],
            userData: { id: member.uid, Employee_Name: 'Max Member' },
        });
        const convert = await member.api.patch('/api/v2/tasks', {
            action: 'convertToSubTask', companyId: state.companyId, projectData: projectSlice(target.project), sprintId: task.sprintId, selectedTaskId: task._id, taskId: { $ne: null },
            oldProject: { id: target.project._id, taskTypeCounts: [], taskStatusData: [] }, isSubTask: false, userData: { id: member.uid, Employee_Name: 'Max Member' },
        });
        const watcher = await member.api.patch('/api/v2/tasks', {
            action: 'updateWatcher', companyId: state.companyId, projectId: target.project._id, sprintId: task.sprintId, taskId: task._id, userId: { $ne: null }, add: false, employeeName: 'Max', userData: { id: member.uid, Employee_Name: 'Max Member' },
        });
        expect([move.status, convert.status, watcher.status]).toEqual([400, 400, 400]);
        expect(await stored(task._id)).toEqual(before);
    });
});

describe('the actor and the project', () => {
    it('come from the session and the stored task, and the name is escaped', async () => {
        const task = await freshTask();
        const res = await member.api.patch('/api/v2/tasks', priorityBody(target.other, task, { userData: { id: owner.uid, Employee_Name: HTML_NAME, companyOwnerId: owner.uid } }));
        expect([res.status, res.body.status]).toEqual([200, true]);
        expect((await stored(task._id)).Task_Priority).toBe('HIGH');
        const rows = await waitFor(async () => { const found = await historyOf(task._id); return found.some((row) => row.Key === 'task_priority') ? found : null; }, 'the history row');
        const row = rows.find((entry) => entry.Key === 'task_priority');
        expect(String(row.UserId)).toBe(member.uid);
        expect(String(row.ProjectId)).toBe(target.project._id);
        expect(row.Message).toContain('Max Member');
        expect(row.Message).not.toContain('<img');
    });

    it('escapes the employee name an assignment shows', async () => {
        const task = await freshTask();
        const res = await member.api.patch('/api/v2/tasks', {
            action: 'updateAssignee', firebaseObj: { AssigneeUserId: member.uid }, projectData: projectSlice(target.project),
            taskData: { _id: task._id, TaskName: 'T', sprintId: task.sprintId, folderObjId: '', AssigneeUserId: [] }, employeeName: '<b onmouseover=alert(1)>Max</b>', type: 'assigneeAdd', isUpdateTask: true,
            userData: { id: member.uid, Employee_Name: 'Max Member' },
        });
        expect([res.status, res.body.status]).toEqual([200, true]);
        const rows = await waitFor(async () => { const found = await historyOf(task._id); return found.some((row) => row.Key === 'Assignee_Changed') ? found : null; }, 'the assignee history');
        rows.forEach((row) => expect(row.Message).not.toContain('<b onmouseover'));
        expect(rows.find((row) => row.Key === 'Assignee_Changed').Message).toContain('&lt;b onmouseover=alert&#40;1&#41;&gt;Max&lt;/b&gt;');
        expect((await stored(task._id)).AssigneeUserId.map(String)).toContain(member.uid);
    });
});

describe('a missing task', () => {
    it('answers 404 on every update, including the ones that used to wait', async () => {
        const missing = String(new ObjectId());
        const sprintId = String(target.sprint._id || target.sprint.id);
        const bodies = [
            { action: 'updateAssignee', firebaseObj: { AssigneeUserId: member.uid }, projectData: projectSlice(target.project), taskData: { _id: missing, TaskName: 'T', sprintId, folderObjId: '', AssigneeUserId: [] }, employeeName: 'Max', type: 'assigneeAdd', isUpdateTask: true, userData: { id: member.uid, Employee_Name: 'Max Member' } },
            { action: 'updateChecklists', companyId: state.companyId, projectId: target.project._id, sprintId, taskId: missing, data: [{ id: 'c1', name: 'Item' }], operation: 'checklistadd', historyObj: { name: 'Item' }, taskData: { _id: missing } },
            { action: 'updateTaskLeader', firebaseObj: { Task_Leader: member.uid }, projectData: projectSlice(target.project), taskData: { _id: missing, sprintId }, employeeName: 'Max', isUpdateTask: true, userData: { id: member.uid, Employee_Name: 'Max Member' } },
            { action: 'updateArchiveDelete', companyId: state.companyId, projectData: projectSlice(target.project), sprintId, task: { _id: missing }, userData: { id: member.uid, Employee_Name: 'Max Member' }, deletedStatusKey: 2 },
            { action: 'updateDescription', companyId: state.companyId, projectData: projectSlice(target.project), sprintId, task: { _id: missing }, userData: { id: member.uid, Employee_Name: 'Max Member' }, text: { blocks: [], text: '' } },
        ];
        const results = await Promise.all(bodies.map((body) => member.api.patch('/api/v2/tasks', body)));
        expect(results.map((res) => [res.status, res.body.status])).toEqual(bodies.map(() => [404, false]));
    });
});

describe('archive counts', () => {
    it('come from the stored task, not the body', async () => {
        const task = await freshTask();
        const sprintId = String(target.sprint._id || target.sprint.id);
        const before = await sprintOf(sprintId);
        const res = await member.api.patch('/api/v2/tasks', {
            action: 'updateArchiveDelete', companyId: state.companyId, projectData: projectSlice(target.other), sprintId: String(new ObjectId()),
            task: { _id: task._id, ProjectID: target.other._id, sprintId: String(new ObjectId()), deletedStatusKey: 0, isParentTask: true, subTasks: 99, ParentTaskId: '' },
            userData: { id: member.uid, Employee_Name: 'Max Member' }, deletedStatusKey: 2,
        });
        expect([res.status, res.body.status]).toEqual([200, true]);
        expect((await stored(task._id)).deletedStatusKey).toBe(2);
        const after = await waitFor(async () => { const doc = await sprintOf(sprintId); return doc.archiveTaskCount !== before.archiveTaskCount ? doc : null; }, 'the sprint count');
        expect(after.archiveTaskCount - (before.archiveTaskCount || 0)).toBe(1);
        expect((before.tasks || 0) - (after.tasks || 0)).toBe(1);

        const bad = await member.api.patch('/api/v2/tasks', {
            action: 'updateArchiveDelete', companyId: state.companyId, projectData: projectSlice(target.project), sprintId, task: { _id: task._id }, userData: { id: member.uid, Employee_Name: 'Max Member' }, deletedStatusKey: 3,
        });
        expect(bad.status).toBe(400);
    });
});

describe('checklist item ids', () => {
    it('must be plain ids, and a plain id still edits the item', async () => {
        const task = await freshTask();
        const base = { action: 'updateChecklists', companyId: state.companyId, projectId: target.project._id, sprintId: task.sprintId, taskId: task._id, taskData: { _id: task._id } };
        const added = await member.api.patch('/api/v2/tasks', { ...base, data: [{ id: 'c1', name: 'Item', AssigneeUserId: [] }], operation: 'checklistadd', historyObj: { name: 'Item' } });
        expect([added.status, added.body.status]).toEqual([200, true]);

        const byCondition = await member.api.patch('/api/v2/tasks', { ...base, data: [], operation: 'checklistedit', historyObj: { updatedId: { $ne: null }, newName: 'Hijacked', previousName: 'Item' } });
        const notAList = await member.api.patch('/api/v2/tasks', { ...base, data: { $ne: null }, operation: 'checklistremove', historyObj: { name: 'Item', extractedData: { name: 'Item', subItemNames: ['Item'] } } });
        expect([byCondition.status, notAList.status]).toEqual([400, 400]);
        expect((await stored(task._id)).checklistArray).toEqual([expect.objectContaining({ id: 'c1', name: 'Item' })]);

        const edited = await member.api.patch('/api/v2/tasks', { ...base, data: [], operation: 'checklistedit', historyObj: { updatedId: 'c1', newName: 'Renamed', previousName: 'Item' } });
        expect([edited.status, edited.body.status]).toEqual([200, true]);
        expect((await stored(task._id)).checklistArray[0].name).toBe('Renamed');
    });
});

describe('the routes nothing calls', () => {
    it('are gone', async () => {
        const create = await member.api.post('/api/tasks', { data: { ProjectID: target.project._id }, user: { id: member.uid } });
        expect(create.status).toBe(404);
        const ticket = await member.api.patch('/api/v2/tasks', { action: 'updateSupportTicket', companyId: state.companyId, taskId: String(new ObjectId()), updateObj: { statusKey: 2 } });
        expect(ticket.status).toBe(400);
    });
});

describe('the web app flows still work', () => {
    it('creates, renames, assigns, archives and restores a task', async () => {
        const task = await freshTask(member.api, state.users.member);
        const sprintId = String(target.sprint._id || target.sprint.id);
        const calls = [
            { action: 'updateTaskName', firebaseObj: { TaskName: 'TIA renamed' }, projectData: projectSlice(target.project), taskData: { _id: task._id, sprintId, TaskName: 'before' }, obj: { previousTaskName: 'before', userName: 'Max' }, userData: { id: member.uid, Employee_Name: 'Max Member' } },
            { action: 'updateWatcher', companyId: state.companyId, projectId: target.project._id, sprintId, taskId: task._id, userId: member.uid, add: true, userData: { id: member.uid, Employee_Name: 'Max Member' }, employeeName: 'Max Member' },
            { action: 'updateQueueList', CompanyId: state.companyId, projectId: target.project._id, sprintId, taskId: task._id, userId: member.uid, actionType: 'add', taskName: 'TIA renamed', userData: { id: member.uid, Employee_Name: 'Max Member' } },
            { action: 'updateArchiveDelete', companyId: state.companyId, projectData: projectSlice(target.project), sprintId, task: { _id: task._id, ProjectID: target.project._id, sprintId, deletedStatusKey: 0, isParentTask: true, subTasks: 0, sprintArray: { id: sprintId, name: target.sprint.name } }, userData: { id: member.uid, Employee_Name: 'Max Member' }, deletedStatusKey: 2 },
            { action: 'updateArchiveDelete', companyId: state.companyId, projectData: projectSlice(target.project), sprintId, task: { _id: task._id, ProjectID: target.project._id, sprintId, deletedStatusKey: 2, isParentTask: true, subTasks: 0, sprintArray: { id: sprintId, name: target.sprint.name } }, userData: { id: member.uid, Employee_Name: 'Max Member' }, deletedStatusKey: 0 },
        ];
        for (const body of calls) {
            const res = await member.api.patch('/api/v2/tasks', body);
            expect([body.action, res.status, res.body.status]).toEqual([body.action, 200, true]);
        }
        const row = await stored(task._id);
        expect(row).toMatchObject({ TaskName: 'TIA renamed', deletedStatusKey: 0 });
        expect(row.watchers.map(String)).toContain(member.uid);
        expect(row.queueListArray.map(String)).toContain(member.uid);
        const history = await waitFor(async () => { const found = await historyOf(task._id); return found.some((entry) => entry.Key === 'Task_Queue') ? found : null; }, 'the queue history');
        expect(history.find((entry) => entry.Key === 'Task_Queue').Message).toContain('TIA renamed');
        history.forEach((entry) => expect(String(entry.UserId)).toBe(member.uid));
    });

    it('runs the bulk bar and the relation link', async () => {
        const one = await freshTask();
        const two = await freshTask();
        const link = assertOk(await member.api.post('/api/v2/tasks/relations', { action: 'add', taskId: one._id, relatedTaskId: two._id, type: 'blocks', userData: { id: owner.uid, Employee_Name: 'Olivia' } }), 'link');
        expect(link.status).toBe(true);
        expect((await stored(one._id)).relations).toEqual([expect.objectContaining({ createdBy: member.uid })]);

        const priority = await member.api.post('/api/v2/tasks/bulk', { action: 'bulkUpdatePriority', taskIds: [one._id, two._id], userData: { id: member.uid, Employee_Name: 'Max Member' }, firebaseObj: { Task_Priority: 'HIGH' }, priorityObj: { priorityName: 'Medium', newPriorityName: 'High' } });
        expect(priority.body).toMatchObject({ status: true, data: { totals: { updated: 2 } } });
        for (const id of [one._id, two._id]) expect((await stored(id)).Task_Priority).toBe('HIGH');
    });
});

describe('a write must name its task', () => {
    it('leaves every task alone when the index routes name none', async () => {
        const first = await db().collection('tasks').findOne({}, { sort: { _id: 1 } });
        const drag = dragBody({ sprintId: String(target.sprint._id || target.sprint.id) }, target.project, { updateData: { Task_Priority: 'HIGH', Updated_At: new Date().toISOString() } });
        delete drag.taskId;
        const dragged = await member.api.post('/api/v1/taskIndex', drag);
        const loaded = await member.api.post('/api/v1/updateTaskIndexOnload', { taskUpdate: { item: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 1 }, taskKey: 'X-1' }, companyId: state.companyId });
        expect([dragged.status, loaded.status]).toEqual([400, 400]);
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(await db().collection('tasks').findOne({ _id: first._id })).toEqual(first);
    });

    it('answers 404 for a task in a private space the caller is not assigned to', async () => {
        const hidden = await createProject(owner.api, { name: `TIA Hidden ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const task = await createTask(owner.api, { project: hidden, user: state.users.owner, companyOwnerId: owner.uid });
        const asMember = await member.api.patch('/api/v2/tasks', priorityBody(hidden, task));
        expect([asMember.status, asMember.body.status]).toEqual([404, false]);
        expect((await stored(task._id)).Task_Priority).toBe('MEDIUM');
        const asOwner = await owner.api.patch('/api/v2/tasks', priorityBody(hidden, task));
        expect([asOwner.status, asOwner.body.status]).toEqual([200, true]);
    });
});

describe('history follows the written task', () => {
    const statusBody = (written, other, extra = {}) => {
        const status = target.project.taskStatusData.find((s) => s.type === 'close') || target.project.taskStatusData[0];
        return {
            action: 'updateStatus',
            newStatus: { status: { text: status.name, key: status.key, value: status.value, type: status.type }, statusKey: status.key, statusType: status.type },
            prevStatus: { taskId: other._id, taskName: 'somebody else', statusName: 'To Do', name: 'To Do', updatedTaskName: '<b onmouseover=alert(1)>Done</b>' },
            projectData: projectSlice(target.project), task: { _id: written._id, sprintId: written.sprintId }, isUpdateTask: true,
            userData: { id: member.uid, Employee_Name: 'Max Member' }, ...extra,
        };
    };

    it('records the task the status change wrote, with the shown name escaped', async () => {
        const written = await freshTask();
        const other = await freshTask();
        const res = await member.api.patch('/api/v2/tasks', statusBody(written, other));
        expect([res.status, res.body.status]).toEqual([200, true]);
        const rows = await waitFor(async () => { const found = await historyOf(written._id); return found.some((row) => row.Key === 'Task_Status') ? found : null; }, 'the status history');
        const row = rows.find((entry) => entry.Key === 'Task_Status');
        expect(row.Message).toContain('&lt;b onmouseover=alert&#40;1&#41;&gt;Done&lt;/b&gt;');
        expect(row.Message).not.toContain('<b onmouseover');
        expect((await historyOf(other._id)).some((entry) => entry.Key === 'Task_Status')).toBe(false);
        expect((await stored(other._id)).statusKey).toBe((await stored(other._id)).statusKey);

        const noWrite = await member.api.patch('/api/v2/tasks', statusBody(written, other, { isUpdateTask: false }));
        expect(noWrite.status).toBe(400);
    });

    it('refuses a move into a project that does not exist', async () => {
        const task = await freshTask();
        const res = await member.api.patch('/api/v2/tasks', {
            action: 'moveTask', companyId: state.companyId, projectData: { id: String(new ObjectId()), ProjectCode: 'NOPE', ProjectName: 'Nope' },
            sprintObj: { id: String(target.sprint._id || target.sprint.id), name: target.sprint.name, folderId: null }, moveTaskId: task._id,
            oldSprintObj: { id: task.sprintId, folderId: null, name: target.sprint.name, folderName: '' }, oldProject: { id: target.project._id, taskTypeCounts: target.project.taskTypeCounts, taskStatusData: target.project.taskStatusData },
            isSubTask: false, assignee: [], watcher: [], userData: { id: member.uid, Employee_Name: 'Max Member' },
        });
        expect([res.status, res.body.status]).toEqual([404, false]);
        expect(String((await stored(task._id)).ProjectID)).toBe(target.project._id);
    });
});
