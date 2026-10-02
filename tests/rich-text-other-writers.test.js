/* The writers that store a description or a doc body without the web app's own save (an automation or agent, the AI
   project generator) store it as that save does. */
const mongoose = require('mongoose');

const mockDb = require('./fixtures/fakeMongo').create();

const mockInserted = [];
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, query, method) => {
        if (method === 'insertMany') { mockInserted.push({ type: query.type, data: query.data }); return query.data[0]; }
        return mockDb.crud(companyId, query, method);
    },
}));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskMongo/internals.js', () => ({ updateTaskKey: jest.fn(async () => undefined) }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/createProject/sampleProject', () => ({ loadUserData: jest.fn(async () => ({})) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const tools = require('../Modules/Automations/engine/tools');
const { executors } = require('../Modules/Agents/actions');
const { LIMITS } = require('../Modules/Tasks/helpers/cleanRichText');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000d01';
const SPRINT = '6f0000000000000000000501';
const ROOT = '6f0000000000000000000b11';
const oid = (id) => new mongoose.Types.ObjectId(id);

const project = {
    _id: oid(PROJECT), CompanyId: C, ProjectName: 'Launch', ProjectCode: 'LN', userId: OWNER, lastTaskId: 0,
    taskTypeCounts: [{ name: 'Task', key: 1, value: 'task' }],
    taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }, { name: 'Complete', key: 2, type: 'close' }],
};

const LINK = 'target="_blank" rel="noopener noreferrer"';
const SENT = 'Agree <b onclick="window.__ran = 1">the date</b><img src=x onerror="window.__ran = 1"> at <a href="https://example.test/spec">the spec</a>';
const KEPT = `Agree <b>the date</b> at <a href="https://example.test/spec" ${LINK}>the spec</a>`;
const sentBlocks = () => [
    { type: 'paragraph', data: { text: SENT } },
    { type: 'list', data: { style: 'unordered', items: ['<i onclick="window.__ran = 1">one</i>', 'two<script>window.__ran = 1</script>'] } },
];

const stored = (type, id) => mockDb.store[type].find((row) => String(row._id) === String(id));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockInserted.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { ...project });
    mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: oid(ROOT), TaskName: 'Launch', TaskKey: 'LN-1', TaskType: 'task', TaskTypeKey: 1, ProjectID: oid(PROJECT), CompanyId: oid(C),
        status: { key: 1, text: 'To Do', type: 'default_active' }, statusType: 'default_active', statusKey: 1, isParentTask: true, ParentTaskId: '',
        Task_Leader: OWNER, Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: oid(SPRINT), sprintArray: { id: oid(SPRINT), name: 'Sprint 7' }, subTasks: 0,
    });
});

describe('an automation or an agent', () => {
    test('edits a task\'s description: stored as the editor would draw it', async () => {
        await tools.updateTask(C, ROOT, { description: SENT, rawDescription: 'Agree the date', descriptionBlock: { blocks: sentBlocks() }, TaskName: 'Launch day' });
        expect(stored(SCHEMA_TYPE.TASKS, ROOT)).toMatchObject({
            TaskName: 'Launch day',
            description: KEPT,
            rawDescription: 'Agree the date at the spec\n- one\n- two',
            descriptionBlock: { blocks: [{ type: 'paragraph', data: { text: KEPT } }, { type: 'list', data: { style: 'unordered', items: ['<i>one</i>', 'two'] } }] },
        });
    });

    test('is refused a description beyond a size limit, and the task keeps what it had', async () => {
        await expect(tools.updateTask(C, ROOT, { description: 'x'.repeat(LIMITS.textLength + 1) })).rejects.toMatchObject({ statusCode: 400, limit: 'textLength' });
        expect(stored(SCHEMA_TYPE.TASKS, ROOT).description).toBeUndefined();
    });

    test('adds a subtask and a task with a description: stored as the editor would draw it', async () => {
        const { subtaskId } = await tools.createSubtask(C, ROOT, { title: 'Check the copy', description: SENT });
        expect(stored(SCHEMA_TYPE.TASKS, subtaskId)).toMatchObject({ description: KEPT, rawDescription: SENT });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(SPRINT), name: 'Sprint 7', projectId: oid(PROJECT), deletedStatusKey: 0 });
        await tools.createTask(C, PROJECT, { title: 'Write the copy', description: SENT, sprintId: SPRINT });
        expect(mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task.TaskName === 'Write the copy')).toMatchObject({ description: KEPT, rawDescription: SENT });
    });

    test('drafts a doc: its body is stored as the docs editor would draw it', async () => {
        const content = { html: '<p onclick="window.__ran = 1">One</p><iframe src="https://remote.example.test"></iframe>', blocks: { time: 1, version: '2.30.7', blocks: sentBlocks() } };
        const { result } = await executors['page.draft']({ companyId: C, actor: { userId: OWNER, personName: 'Olivia' }, params: { title: 'Launch notes', text: 'One', content, projectId: PROJECT } });
        expect(stored(SCHEMA_TYPE.PAGES, result.pageId).content).toEqual({
            html: '<p>One</p>',
            blocks: { time: 1, version: '2.30.7', blocks: [
                { type: 'paragraph', data: { text: `Agree <b>the date</b><img> at <a href="https://example.test/spec" ${LINK}>the spec</a>` } },
                { type: 'list', data: { style: 'unordered', items: ['<i>one</i>', 'two'] } },
            ] },
        });
    });
});

describe('the AI project generator', () => {
    test('a generated task stores its description as the editor would draw it', async () => {
        const { createTasksForSprint } = require('../Modules/AIProjectGenerator/orchestrator');
        await createTasksForSprint({
            companyId: C, projectDoc: project, sprintDoc: { _id: oid(SPRINT), name: 'Sprint 7' }, creatorUid: OWNER, statusByName: new Map(), taskTypeByKey: new Map(),
            tasks: [{ TaskName: 'Plan the launch', descriptionBlocks: sentBlocks() }],
        });
        const [doc] = mockInserted.filter((made) => made.type === SCHEMA_TYPE.TASKS).flatMap((made) => made.data[0]);
        expect(doc.descriptionBlock.blocks).toEqual([
            { type: 'paragraph', data: { text: KEPT } },
            { type: 'list', data: { style: 'unordered', items: [{ content: '<i>one</i>', items: [] }, { content: 'two', items: [] }] } },
        ]);
        expect(doc.rawDescription).not.toMatch(/[<>]|__ran/);
    });

    test('a generated project stores its description as the editor would draw it', () => {
        const { briefDescription } = require('../Modules/AIProjectGenerator/executeAgents');
        const brief = briefDescription({ approvedBrief: '# Launch\n\nShip <b onclick="x">it</b> & rest', assumptions: [] });
        expect(brief.descriptionBlock.blocks).toEqual([
            { type: 'header', data: { text: 'Launch', level: 2 } },
            { type: 'paragraph', data: { text: 'Ship <b>it</b> &amp; rest' } },
        ]);
        expect(brief.description).toBe('Launch\nShip <b>it</b> &amp; rest');
        expect(Object.keys(brief)).toEqual(['description', 'descriptionBlock']);
    });
});
