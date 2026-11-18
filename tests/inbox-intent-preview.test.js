/* Task 047, AI-2: the preview card. A waiting task create reaches the Inbox with what it will make, in names the
   person looking may see: nothing of a project, list, task or person that is closed to them. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const intentPreview = require('../Modules/Agents/intentPreview');

const { CID, OWNER, INSIDER, OUTSIDER, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, L_PRIVATE, T_OPEN, T_SECRET, MISSING, settle } = world;
const { seed } = world.create(mockDb);

const AGENT = '6f0000000000000000000a91';
const add = (params) => ({ action: 'task.add', params, label: 'task.create via MCP', reversible: true });
const propose = (what, changes, over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: AGENT, agentName: 'Claude (MCP)', what, why: 'task.create via MCP', changes, status: 'pending', gate: null, source: 'mcp', requestedBy: INSIDER,
    projectId: (changes[0].params && changes[0].params.projectId) || P_OPEN, taskId: null, createdAt: new Date(), ...over,
});
const rowOf = async (uid, what) => (await queue.readQueue(CID, uid)).find((row) => row.what === what);
const previewOf = async (uid, what) => { const row = await rowOf(uid, what); return row ? row.changes[0].preview : undefined; };
const lineOf = (preview, kind) => preview.lines.find((line) => line.kind === kind);

beforeEach(() => { seed(); });
afterEach(settle);

describe('a waiting task create carries its preview', () => {
    it('says the title, the place by name, who it is for, when it is due and what it holds', async () => {
        propose('full', [add({
            projectId: P_OPEN, sprintId: L_OPEN, title: 'Fix the login bug',
            fields: { rawDescription: 'Safari users cannot sign in.', AssigneeUserId: [OUTSIDER], DueDate: '2026-10-09', startDate: '2026-10-05', Task_Priority: 'HIGH', status: 'In Progress', TaskType: 'Task', totalEstimatedTime: 90, links: [{ url: 'https://example.com/pr/1' }] },
        })]);
        const preview = await previewOf(OWNER, 'full');
        expect(preview).toMatchObject({ kind: 'task', title: 'Fix the login bug' });
        expect(preview.lines).toEqual([
            { kind: 'place', project: 'Open', list: 'Open list' },
            { kind: 'assignees', names: ['Mia Member'], others: 0 },
            { kind: 'due', date: '2026-10-09' },
            { kind: 'start', date: '2026-10-05' },
            { kind: 'priority', value: 'HIGH' },
            { kind: 'status', name: 'In Progress' },
            { kind: 'type', name: 'Task' },
            { kind: 'estimate', minutes: 90 },
            { kind: 'description', text: 'Safari users cannot sign in.', more: false },
            { kind: 'links', count: 1 },
        ]);
    });

    it('holds only the lines the create names', async () => {
        propose('bare', [add({ projectId: P_OPEN, sprintId: '', title: 'Bare', fields: {} })]);
        expect((await previewOf(OWNER, 'bare')).lines).toEqual([{ kind: 'place', project: 'Open', list: '' }]);
    });

    it('reads the simpler create and a subtask the same way', async () => {
        propose('simple', [{ action: 'task.create', params: { projectId: P_OPEN, sprintId: L_OPEN, title: 'Simple', description: 'From the board', priority: 'LOW' }, label: 'task.create via MCP', reversible: true }]);
        propose('child', [{ action: 'subtask.add', params: { taskId: T_OPEN, title: 'Write the test', fields: { DueDate: '2026-10-09' } }, label: 'subtask.create via MCP', reversible: true }], { taskId: T_OPEN, projectId: P_OPEN });
        expect(await previewOf(OWNER, 'simple')).toEqual({
            kind: 'task', title: 'Simple',
            lines: [{ kind: 'place', project: 'Open', list: 'Open list' }, { kind: 'priority', value: 'LOW' }, { kind: 'description', text: 'From the board', more: false }],
        });
        expect(await previewOf(OWNER, 'child')).toEqual({ kind: 'subtask', title: 'Write the test', lines: [{ kind: 'parent', task: 'Open task' }, { kind: 'due', date: '2026-10-09' }] });
    });

    it('cuts a long description and says there is more', async () => {
        propose('long', [add({ projectId: P_OPEN, title: 'Long', fields: { rawDescription: 'x'.repeat(2000) } })]);
        const line = lineOf(await previewOf(OWNER, 'long'), 'description');
        expect(line.text.length).toBeLessThanOrEqual(intentPreview.DESCRIPTION_MAX);
        expect(line.more).toBe(true);
    });

    it('hands markup over as the text it is, for the card to show as text', async () => {
        propose('markup', [add({ projectId: P_OPEN, title: '<img src=x onerror=alert(1)>', fields: { rawDescription: '<script>alert(2)</script>' } })]);
        const preview = await previewOf(OWNER, 'markup');
        expect(preview.title).toBe('<img src=x onerror=alert(1)>');
        expect(lineOf(preview, 'description').text).toBe('<script>alert(2)</script>');
    });

    it('gives a change of another kind no preview of its own: the row\'s one card says what it sets', async () => {
        propose('comment', [{ action: 'task.comment', params: { taskId: T_OPEN, body: 'Ship it' }, label: 'Comment', reversible: true }], { taskId: T_OPEN });
        const row = await rowOf(OWNER, 'comment');
        expect(row.changes).toEqual([{ action: 'task.comment', label: 'Comment', reversible: true }]);
        expect(row.batch).toMatchObject({ kind: 'batch', tasks: 1, changes: 1 });
        expect(row.batch.lines.find((line) => line.kind === 'batchItem')).toMatchObject({ what: 'comment', value: 'Ship it', more: false });
    });
});

describe('it shows only what the person looking may see', () => {
    it('a proposal that names a project the person cannot open is not listed at all', async () => {
        propose('closed', [add({ projectId: P_PRIVATE, sprintId: L_PRIVATE, title: 'Secret plan', fields: {} })]);
        expect(await rowOf(OUTSIDER, 'closed')).toBeUndefined();
        expect(JSON.stringify(await queue.readQueue(CID, OUTSIDER))).not.toMatch(/Secret plan|Private/);
        expect(lineOf(await previewOf(INSIDER, 'closed'), 'place')).toEqual({ kind: 'place', project: 'Private', list: 'List of the private project' });
    });

    it('a private list the person is not on is not named', async () => {
        propose('secret list', [add({ projectId: P_OPEN, sprintId: L_SECRET, title: 'In the private list', fields: {} })]);
        expect(lineOf(await previewOf(OUTSIDER, 'secret list'), 'place')).toEqual({ kind: 'place', project: 'Open', list: '' });
        expect(lineOf(await previewOf(INSIDER, 'secret list'), 'place')).toEqual({ kind: 'place', project: 'Open', list: 'Private list' });
    });

    it('a person who is not an active member is counted, not named', async () => {
        propose('people', [add({ projectId: P_OPEN, title: 'For two', fields: { AssigneeUserId: [OUTSIDER, MISSING] } })]);
        expect(lineOf(await previewOf(OWNER, 'people'), 'assignees')).toEqual({ kind: 'assignees', names: ['Mia Member'], others: 1 });
    });

    it('built for a person directly, it names nothing of a project or a parent task closed to them', async () => {
        const changes = [
            add({ projectId: P_PRIVATE, sprintId: L_PRIVATE, title: 'Elsewhere', fields: { AssigneeUserId: [INSIDER] } }),
            { action: 'subtask.add', params: { taskId: T_SECRET, title: 'Under a hidden task', fields: {} } },
        ];
        const [elsewhere, child] = (await intentPreview.forProposals(CID, OUTSIDER, [{ _id: 'p1', changes }])).get('p1');
        expect(elsewhere).toEqual({ kind: 'task', title: 'Elsewhere', lines: [{ kind: 'assignees', names: [], others: 1 }] });
        expect(child).toEqual({ kind: 'subtask', title: 'Under a hidden task', lines: [] });
    });
});
