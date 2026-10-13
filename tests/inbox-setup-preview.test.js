/* Task 047, AI-3: the preview card of a waiting field or view. It lists each field with its type, and what a view
   shows, in names the person looking may see; for someone who cannot open the project it lists nothing. */
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

const { CID, OWNER, INSIDER, OUTSIDER, P_OPEN, P_PRIVATE, T_OPEN, T_SECRET, T_PRIVATE, MISSING, settle } = world;
const { seed } = world.create(mockDb);

const AGENT = '6f0000000000000000000a91';
const F_REGION = '6f0000000000000000000f01';
const F_ELSEWHERE = '6f0000000000000000000f02';
const FIVE = [
    { name: 'Budget', type: 'money' },
    { name: 'Client', type: 'text' },
    { name: 'Region', type: 'dropdown', options: ['North', 'South'] },
    { name: 'Rating', type: 'rating' },
    { name: 'Owner', type: 'people' },
];

const change = (action, params) => ({ action, params, label: `${action} via MCP`, reversible: true });
const propose = (what, changes) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: AGENT, agentName: 'Claude (MCP)', what, why: 'via MCP', changes, status: 'pending', gate: null, source: 'mcp', requestedBy: INSIDER,
    projectId: changes[0].params.projectId, taskId: null, createdAt: new Date(),
});
const previewOf = async (uid, what) => {
    const row = (await queue.readQueue(CID, uid)).find((entry) => entry.what === what);
    return row ? row.changes[0].preview : undefined;
};
const direct = async (uid, proposal) => (await intentPreview.forProposals(CID, uid, [proposal])).get(String(proposal._id));

beforeEach(() => {
    seed();
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: F_REGION, fieldTitle: 'Region', fieldType: 'dropdown', type: 'task', isDelete: true, global: false, projectId: [P_OPEN] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: F_ELSEWHERE, fieldTitle: 'Secret score', fieldType: 'number', type: 'task', isDelete: true, global: false, projectId: [P_PRIVATE] });
});
afterEach(settle);

describe('waiting fields carry their preview', () => {
    it('lists the project and each of five fields with its type, and a dropdown\'s options', async () => {
        propose('five', [change('fields.create', { projectId: P_OPEN, definitions: FIVE })]);
        expect(await previewOf(OWNER, 'five')).toEqual({
            kind: 'fields',
            title: 'Budget, Client, Region, Rating, Owner',
            lines: [
                { kind: 'place', project: 'Open', list: '' },
                { kind: 'field', name: 'Budget', type: 'money', options: [] },
                { kind: 'field', name: 'Client', type: 'text', options: [] },
                { kind: 'field', name: 'Region', type: 'dropdown', options: ['North', 'South'] },
                { kind: 'field', name: 'Rating', type: 'rating', options: [] },
                { kind: 'field', name: 'Owner', type: 'people', options: [] },
            ],
        });
    });

    it('takes a name, a type and an option only as text, and leaves out what is not', async () => {
        propose('odd', [change('fields.create', { projectId: P_OPEN, definitions: [{ name: { $ne: 1 }, type: 'text' }, { name: 'Stage', type: 'gallery', options: [{ label: 'x' }, 'Lead'] }, null] })]);
        expect(await previewOf(OWNER, 'odd')).toEqual({
            kind: 'fields', title: 'Stage',
            lines: [{ kind: 'place', project: 'Open', list: '' }, { kind: 'field', name: 'Stage', type: '', options: ['Lead'] }],
        });
    });
});

describe('waiting fields with their first values', () => {
    const values = [
        { taskId: T_OPEN, field: 'Client', value: 'Acme' },
        { taskId: T_OPEN, field: 'Budget', value: 120 },
        { taskId: T_OPEN, field: 'Owner', value: [OUTSIDER, MISSING] },
        { taskId: T_OPEN, field: 'Signed', value: true },
        { taskId: T_OPEN, field: 'Region', value: null },
        { taskId: T_SECRET, field: 'Client', value: 'Hidden' },
        { taskId: T_PRIVATE, field: 'Client', value: 'Elsewhere' },
        { taskId: { $ne: '' }, field: 'Client', value: 'x' },
    ];

    it('lists each value under the fields, on a task by its name', async () => {
        propose('valued', [change('fields.create', { projectId: P_OPEN, definitions: FIVE, values })]);
        const lines = (await previewOf(INSIDER, 'valued')).lines.slice(6);
        expect(lines).toEqual([
            { kind: 'fieldValue', field: 'Client', task: 'Open task', value: 'Acme', others: 0 },
            { kind: 'fieldValue', field: 'Budget', task: 'Open task', value: '120', others: 0 },
            { kind: 'fieldValue', field: 'Owner', task: 'Open task', value: 'Mia Member', others: 1 },
            { kind: 'fieldValue', field: 'Signed', task: 'Open task', checked: true },
            { kind: 'fieldValue', field: 'Region', task: 'Open task', value: '', others: 0 },
            { kind: 'fieldValue', field: 'Client', task: 'Secret task', value: 'Hidden', others: 0 },
            { kind: 'fieldValuesHidden', count: 2 },
        ]);
    });

    it('names no task the person looking cannot open, and none of its values', async () => {
        propose('valued', [change('fields.create', { projectId: P_OPEN, definitions: FIVE, values })]);
        const preview = await previewOf(OUTSIDER, 'valued');
        expect(preview.lines.slice(6).map((line) => line.kind)).toEqual(['fieldValue', 'fieldValue', 'fieldValue', 'fieldValue', 'fieldValue', 'fieldValuesHidden']);
        expect(preview.lines[preview.lines.length - 1]).toEqual({ kind: 'fieldValuesHidden', count: 3 });
        expect(JSON.stringify(preview)).not.toMatch(/Secret task|"Hidden"|Elsewhere|Private task/);
    });
});

describe('a waiting view carries its preview', () => {
    const look = { groupBy: F_REGION, sortBy: 'due', sortDirection: 'desc', mine: true, statuses: ['In Progress'], priorities: ['HIGH'], assigneeIds: [OUTSIDER], search: 'invoice', showFieldIds: [F_REGION, F_ELSEWHERE] };

    it('says its name, its layout and what it shows, naming a field only when it is one of that project', async () => {
        propose('view', [change('view.create', { projectId: P_OPEN, name: 'My open work', kind: 'board', look })]);
        expect(await previewOf(OWNER, 'view')).toEqual({
            kind: 'view',
            title: 'My open work',
            lines: [
                { kind: 'place', project: 'Open', list: '' },
                { kind: 'layout', value: 'board' },
                { kind: 'group', by: '', field: 'Region' },
                { kind: 'sort', by: 'due', field: '', descending: true },
                { kind: 'mine' },
                { kind: 'assignees', names: ['Mia Member'], others: 0 },
                { kind: 'statuses', names: ['In Progress'] },
                { kind: 'priorities', values: ['HIGH'] },
                { kind: 'search', text: 'invoice' },
                { kind: 'columns', names: ['Region'], others: 1 },
            ],
        });
    });

    it('holds only the lines the view names', async () => {
        propose('bare', [change('view.create', { projectId: P_OPEN, name: 'Plain', kind: 'list', look: { groupBy: 'priority' } })]);
        expect((await previewOf(OWNER, 'bare')).lines).toEqual([{ kind: 'place', project: 'Open', list: '' }, { kind: 'layout', value: 'list' }, { kind: 'group', by: 'priority', field: '' }]);
    });

    it('says which due dates it keeps: a named span, or a range of days', async () => {
        propose('week', [change('view.create', { projectId: P_OPEN, name: 'Mine this week', kind: 'list', look: { mine: true, due: 'this_week' } })]);
        propose('range', [change('view.create', { projectId: P_OPEN, name: 'Launch week', kind: 'list', look: { dueFrom: '2026-10-05', dueTo: '2026-10-09' } })]);
        propose('odd', [change('view.create', { projectId: P_OPEN, name: 'Odd', kind: 'list', look: { due: 'someday', dueFrom: { $gt: '' }, dueTo: '2026-10-09' } })]);
        const place = { kind: 'place', project: 'Open', list: '' };
        const layout = { kind: 'layout', value: 'list' };
        expect((await previewOf(OWNER, 'week')).lines).toEqual([place, layout, { kind: 'mine' }, { kind: 'dueFilter', when: 'this_week' }]);
        expect((await previewOf(OWNER, 'range')).lines).toEqual([place, layout, { kind: 'dueFilter', from: '2026-10-05', to: '2026-10-09' }]);
        expect((await previewOf(OWNER, 'odd')).lines).toEqual([place, layout]);
    });
});

describe('for someone who cannot open the project', () => {
    it('lists nothing of a view or of fields waiting there', async () => {
        const view = propose('hidden view', [change('view.create', { projectId: P_PRIVATE, name: 'Board of secrets', kind: 'board', look: { groupBy: F_ELSEWHERE, showFieldIds: [F_ELSEWHERE] } })]);
        const fields = propose('hidden fields', [change('fields.create', { projectId: P_PRIVATE, definitions: FIVE })]);
        expect(await direct(OUTSIDER, view)).toEqual([null]);
        expect(await direct(OUTSIDER, fields)).toEqual([null]);
        expect(await previewOf(OUTSIDER, 'hidden view')).toBeUndefined();
        expect((await direct(INSIDER, view))[0]).toMatchObject({ kind: 'view', title: 'Board of secrets', lines: expect.arrayContaining([{ kind: 'group', by: '', field: 'Secret score' }]) });
        expect(JSON.stringify(await direct(OUTSIDER, view))).not.toMatch(/secret/i);
    });
});
