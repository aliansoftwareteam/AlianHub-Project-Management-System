const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { requireTaskActionPermission, requireTaskWritePermission } = require('../Config/permissionGuard');
const { TASK_WRITE_ROUTES } = require('../Config/taskWritePermissions');
const {
    CID, OTHER_COMPANY, OWNER, MEMBER, OPEN_PROJECT, LOCKED_PROJECT, PARITY_PROJECT, OPEN_TASK, OPEN_TASK_2, LOCKED_TASK, LOCKED_TASK_2,
    ENV_KEYS, run, session, token, setMode, create,
} = require('./fixtures/taskWriteGuard');

const world = create(mockDb);
const { decisions, audits, permissionReads, setRule } = world;

beforeEach(() => world.reset());
afterAll(() => ENV_KEYS.forEach((k) => { delete process.env[k]; }));

const MODES = ['off', 'report', 'enforce'];
const BULK = ['/api/v2/tasks/bulk', 'POST'];
const guard = requireTaskActionPermission();
const createTask = requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/v2/tasks'].entry);

describe('task ids are resolved the same way the handlers resolve them', () => {
    test.each([
        ['taskId given as { id } (updateTags)', { action: 'updateTags', taskId: { id: LOCKED_TASK }, projectId: OPEN_PROJECT }, 'task.task_tag'],
        ['taskData._id given as { id } (updateTaskName)', { action: 'updateTaskName', taskData: { _id: { id: LOCKED_TASK } } }, 'task.task_name_edit'],
        ['task._id given as { id } (updateArchiveDelete)', { action: 'updateArchiveDelete', task: { _id: { id: LOCKED_TASK } }, deletedStatusKey: 1 }, 'task.task_delete'],
        ['moveTaskId given as { _id }', { action: 'moveTask', moveTaskId: { _id: LOCKED_TASK }, projectData: { id: LOCKED_PROJECT } }, 'task.task_move'],
        ['a bulk id padded with spaces', { action: 'bulkDelete', taskIds: [` ${LOCKED_TASK} `] }, 'task.task_delete', BULK],
        ['a bulk id in upper case', { action: 'bulkArchive', taskIds: [LOCKED_TASK.toUpperCase()] }, 'task.task_archive', BULK],
    ])('%s is judged by that task\'s project', async (_, body, key, [route, method] = []) => {
        setMode('enforce');
        for (const as of [token, session]) {
            const result = await run(guard, as(MEMBER, body, route, method));
            expect(result).toMatchObject({ passed: false, code: 403, body: { permission: key } });
        }
        expect(decisions()[0]).toMatchObject({ permission: key, scope: LOCKED_PROJECT, reason: 'denied' });
    });

    test.each(MODES)('an API token on a mapping from before this change is judged by the task a { id } names (%s)', async (mode) => {
        setMode(mode);
        const result = await run(guard, token(MEMBER, { action: 'updatePriority', taskData: { _id: { id: LOCKED_TASK } } }));
        expect(result).toMatchObject({ passed: false, code: 403, body: { permission: 'task.task_priority' } });
    });

    test('empty and missing ids are not unreadable', async () => {
        setMode('enforce');
        const bodies = [
            { action: 'updateArchiveDelete', task: { _id: OPEN_TASK, ParentTaskId: '' }, deletedStatusKey: 2 },
            { action: 'convertToTask', taskId: OPEN_TASK, parentTaskId: null, projectData: { id: OPEN_PROJECT } },
            { action: 'updateStatus', task: { _id: OPEN_TASK }, projectData: { _id: '' } },
        ];
        for (const body of bodies) expect((await run(guard, token(MEMBER, body))).passed).toBe(true);
        expect((await run(createTask, token(MEMBER, { data: { ProjectID: OPEN_PROJECT, ParentTaskId: '' }, projectData: { _id: OPEN_PROJECT, CompanyId: CID } }, '/api/v2/tasks', 'POST'))).passed).toBe(true);
    });
});

const UNREADABLE = [
    ['moveTaskId with an operator', { action: 'moveTask', moveTaskId: { $in: [LOCKED_TASK] }, projectData: { id: OPEN_PROJECT } }],
    ['a list where one task id is expected', { action: 'updateTags', taskId: [LOCKED_TASK] }],
    ['a number', { action: 'updateWatcher', taskId: 5 }],
    ['text that is not an id', { action: 'updateMarkAsFavourite', taskId: 'not-an-id' }],
    ['a nested { id }', { action: 'updateTaskName', taskData: { _id: { id: { id: LOCKED_TASK } } } }],
    ['{ id } with another key', { action: 'updateTaskName', taskData: { _id: { id: LOCKED_TASK, $ne: 1 } } }],
    ['bulk ids that are not a list', { action: 'bulkDelete', taskIds: LOCKED_TASK }, BULK],
    ['a bulk id with an operator', { action: 'bulkDelete', taskIds: [OPEN_TASK, { $ne: OPEN_TASK }] }, BULK],
    ['a destination project with an operator', { action: 'moveTask', moveTaskId: OPEN_TASK, projectData: { id: { $ne: OPEN_PROJECT } } }],
    ['a mapping from before this change: taskData._id with an operator', { action: 'updatePriority', taskData: { _id: { $in: [LOCKED_TASK] } } }],
    ['a mapping from before this change: task._id as a list', { action: 'updateStatus', task: { _id: [LOCKED_TASK] } }],
    ['a mapping from before this change: a project id with an operator', { action: 'updateDescription', task: { _id: OPEN_TASK }, projectData: { _id: { $gt: '' } } }],
];

describe('a body whose ids cannot be read', () => {
    describe.each(MODES)('with the workspace in %s', (mode) => {
        test.each(UNREADABLE)('is refused for an API token, the owner\'s included: %s', async (_, body, [route, method] = []) => {
            setMode(mode);
            for (const uid of [MEMBER, OWNER]) {
                const result = await run(guard, token(uid, body, route, method));
                expect(result).toMatchObject({ passed: false, code: 403, body: { status: false, error: 'Forbidden' } });
                expect(result.body.statusText).toMatch(/id/);
            }
            expect(decisions()).toEqual([]);
        });
    });

    test('is refused for an API token under the kill switch too', async () => {
        process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        const [, body] = UNREADABLE.find(([name]) => name.endsWith('taskData._id with an operator'));
        expect(await run(guard, token(OWNER, body))).toMatchObject({ passed: false, code: 403 });
    });

    test.each(UNREADABLE)('follows the mode for a browser session: %s', async (_, body, [route, method] = []) => {
        expect((await run(guard, session(OWNER, body, route, method))).passed).toBe(true);
        expect(permissionReads()).toEqual([]);

        setMode('report');
        expect((await run(guard, session(OWNER, body, route, method))).passed).toBe(true);
        expect(decisions()).toHaveLength(1);
        expect(decisions()[0]).toMatchObject({ mode: 'report', reason: 'unresolvable_id', scope: 'global', role: 1 });

        setMode('enforce');
        const refused = await run(guard, session(OWNER, body, route, method));
        expect(refused).toMatchObject({ passed: false, code: 403, body: { status: false, error: 'Forbidden' } });
        expect(decisions().find((row) => row.mode === 'enforce')).toMatchObject({ reason: 'unresolvable_id' });
        expect(audits()).toHaveLength(1);
    });
});

const OTHER_COMPANY_BODIES = [
    ['projectData.CompanyId on a mapping from before this change', guard, { action: 'updatePriority', taskData: { _id: OPEN_TASK }, projectData: { _id: OPEN_PROJECT, CompanyId: OTHER_COMPANY } }],
    ['project.CompanyId on a mapping from before this change', guard, { action: 'updateDueDate', task: { _id: OPEN_TASK }, project: { _id: OPEN_PROJECT, CompanyId: OTHER_COMPANY } }],
    ['companyId on a new mapping', guard, { action: 'updateTags', taskId: OPEN_TASK, companyId: OTHER_COMPANY }],
    ['CompanyId on the queue list', guard, { action: 'updateQueueList', taskId: OPEN_TASK, CompanyId: OTHER_COMPANY }],
    ['data.CompanyId on task create', createTask, { data: { ProjectID: OPEN_PROJECT, CompanyId: OTHER_COMPANY }, projectData: { _id: OPEN_PROJECT, CompanyId: CID } }, ['/api/v2/tasks', 'POST']],
    ['a company id that is not text', guard, { action: 'updateTags', taskId: OPEN_TASK, companyId: { $ne: '' } }],
    ['the same company id in upper case', guard, { action: 'updateTags', taskId: OPEN_TASK, companyId: CID.toUpperCase() }],
];

describe('a body that names a company other than the one the request was sent for', () => {
    describe.each(MODES)('with the workspace in %s', (mode) => {
        test.each(OTHER_COMPANY_BODIES)('is refused for an API token, the owner\'s included: %s', async (_, middleware, body, [route, method] = []) => {
            setMode(mode);
            const result = await run(middleware, token(OWNER, body, route, method));
            expect(result).toMatchObject({ passed: false, code: 403, body: { status: false, error: 'Forbidden' } });
            expect(result.body.statusText).toMatch(/company/);
            expect(decisions()).toEqual([]);
        });
    });

    test.each(OTHER_COMPANY_BODIES)('follows the mode for a browser session: %s', async (_, middleware, body, [route, method] = []) => {
        expect((await run(middleware, session(OWNER, body, route, method))).passed).toBe(true);
        expect(permissionReads()).toEqual([]);

        setMode('report');
        expect((await run(middleware, session(OWNER, body, route, method))).passed).toBe(true);
        expect(decisions()[0]).toMatchObject({ mode: 'report', reason: 'company_mismatch', scope: 'global' });

        setMode('enforce');
        expect(await run(middleware, session(OWNER, body, route, method))).toMatchObject({ passed: false, code: 403 });
    });

    test('the company the request was sent for passes, in any field the handlers read', async () => {
        setMode('enforce');
        const body = { action: 'updateQueueList', taskId: OPEN_TASK, companyId: CID, CompanyId: CID, projectData: { CompanyId: CID }, project: { CompanyId: CID } };
        expect((await run(guard, token(OWNER, body))).passed).toBe(true);
        expect((await run(guard, session(MEMBER, body))).passed).toBe(true);
    });
});

describe('a write into another project is judged in that project too', () => {
    const INTO_LOCKED = [
        ['moveTask', { action: 'moveTask', moveTaskId: OPEN_TASK, projectData: { id: LOCKED_PROJECT } }, 'task.task_move'],
        ['bulkMove', { action: 'bulkMove', taskIds: [OPEN_TASK], projectData: { id: LOCKED_PROJECT } }, 'task.task_move|task.task_status', BULK],
        ['convertToList', { action: 'convertToList', taskId: OPEN_TASK, projectData: { id: LOCKED_PROJECT } }, 'project.project_sprint_create'],
        ['convertToTask', { action: 'convertToTask', taskId: OPEN_TASK, projectData: { id: LOCKED_PROJECT }, oldProject: { id: OPEN_PROJECT } }, 'task.task_create'],
        ['bulkConvertToTask', { action: 'bulkConvertToTask', taskIds: [OPEN_TASK], projectData: { id: LOCKED_PROJECT } }, 'task.task_create', BULK],
        ['duplicateTask', { action: 'duplicateTask', selectedTaskId: OPEN_TASK, projectData: { id: LOCKED_PROJECT } }, 'task.task_duplicate'],
        ['bulkDuplicate', { action: 'bulkDuplicate', taskIds: [OPEN_TASK], projectData: { id: LOCKED_PROJECT } }, 'task.task_duplicate', BULK],
        ['mergeTask', { action: 'mergeTask', taskId: OPEN_TASK, mergeTaskId: OPEN_TASK_2, projectData: { id: LOCKED_PROJECT } }, 'task.task_merge'],
        ['convertToSubTask', { action: 'convertToSubTask', selectedTaskId: OPEN_TASK, taskId: OPEN_TASK_2, projectData: { id: LOCKED_PROJECT } }, 'task.sub_task_create'],
    ];

    test.each(INTO_LOCKED)('%s into a project that refuses the key is recorded in report and refused in enforce', async (_, body, key, [route, method] = []) => {
        setMode('report');
        expect((await run(guard, token(MEMBER, body, route, method))).passed).toBe(true);
        expect(decisions()[0]).toMatchObject({ permission: key, scope: LOCKED_PROJECT, reason: 'denied' });

        setMode('enforce');
        expect(await run(guard, session(MEMBER, body, route, method))).toMatchObject({ passed: false, code: 403, body: { permission: key } });
    });

    test.each(INTO_LOCKED)('%s into a project that grants the key passes', async (_, body, key, [route, method] = []) => {
        setMode('enforce');
        const intoParity = { ...body, projectData: { id: PARITY_PROJECT } };
        expect((await run(guard, session(MEMBER, intoParity, route, method))).passed).toBe(true);
    });

    test.each([
        ['bulkConvertToSubTask', { action: 'bulkConvertToSubTask', taskIds: [OPEN_TASK], parentTaskId: OPEN_TASK_2, projectData: { id: LOCKED_PROJECT } }],
    ])('%s stays judged on the tasks it names', async (_, body) => {
        setMode('enforce');
        expect((await run(guard, session(MEMBER, body, ...BULK))).passed).toBe(true);
    });
});

describe('the bulk bar keys match what the web app checks', () => {
    beforeEach(() => {
        setMode('enforce');
        setRule(LOCKED_PROJECT, 'task_status', true);
    });

    test.each([
        ['bulkMove', { action: 'bulkMove', taskIds: [LOCKED_TASK, LOCKED_TASK_2], projectData: { id: LOCKED_PROJECT } }],
        ['bulkUpdateTags', { action: 'bulkUpdateTags', taskIds: [LOCKED_TASK], tagId: 'tag-1', operation: 'add' }],
    ])('%s passes on task.task_status alone, as the list bulk bar offers it', async (_, body) => {
        expect((await run(guard, session(MEMBER, body, ...BULK))).passed).toBe(true);
        setRule(LOCKED_PROJECT, 'task_status', null);
        const refused = await run(guard, session(MEMBER, body, ...BULK));
        expect(refused).toMatchObject({ code: 403, body: { permission: expect.stringContaining('task.task_status') } });
        expect(decisions()[0]).toMatchObject({ scope: LOCKED_PROJECT, permission: refused.body.permission });
    });

    test('a single-task move still needs task.task_move, as the task menu checks', async () => {
        const result = await run(guard, session(MEMBER, { action: 'moveTask', moveTaskId: LOCKED_TASK, projectData: { id: LOCKED_PROJECT } }));
        expect(result).toMatchObject({ code: 403, body: { permission: 'task.task_move' } });
    });
});

describe('restores need what the web app checks for restore', () => {
    test.each([
        ['bulkRestore', { action: 'bulkRestore', taskIds: [LOCKED_TASK] }, BULK],
        ['_bulkArchiveDelete back to 0 from the trash', { action: '_bulkArchiveDelete', taskIds: [LOCKED_TASK], deletedStatusKey: 0, includeDeleted: true }],
        ['updateArchiveDelete back to 0', { action: 'updateArchiveDelete', task: { _id: LOCKED_TASK }, deletedStatusKey: 0 }],
    ])('%s needs the task to be visible, not task.task_archive', async (_, body, [route, method] = []) => {
        setMode('enforce');
        expect((await run(guard, session(MEMBER, body, route, method))).passed).toBe(true);
        setRule(LOCKED_PROJECT, 'task_list', null);
        expect(await run(guard, session(MEMBER, body, route, method))).toMatchObject({ code: 403, body: { permission: 'task.task_list' } });
    });
});
