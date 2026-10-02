/* Task 047, AI-3 (automations): the preview card of a waiting rule. It says what starts the rule, the rule in a
   sentence, each step, whether it starts switched on, and how many past tasks it matches: counted for the person
   looking, over tasks they can open, and only for someone who may approve it. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const queue = require('../Modules/Inbox/helpers/approvalQueue');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, T_OPEN, T_SECRET, T_OPEN_2, T_TWIN, settle } = world;
const { seed, stored } = world.create(mockDb);

const AGENT = '6f0000000000000000000a91';
const T_ELSEWHERE = '6f0000000000000000000d21';
const NOTICE = '[AI bench] Done notice';
const DONE = { statusKey: 3, statusType: 'close', status: { text: 'Done', key: 3 } };

const draft = (over = {}) => ({
    projectId: P_OPEN,
    trigger: 'task.status_changed',
    conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Done' }],
    actions: [{ action: 'notify', config: { recipients: ['task_assignees'], message: NOTICE } }, { action: 'set_priority', config: { priority: 'LOW' } }],
    enabled: false,
    ...over,
});
const propose = (what, params) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: AGENT, agentName: 'Claude (MCP)', what, why: 'via MCP', status: 'pending', gate: 'owner_admin', source: 'mcp', requestedBy: OWNER,
    changes: [{ action: 'automation.create', params, label: 'automation.create via MCP', reversible: true }],
    projectId: params.projectId, taskId: null, createdAt: new Date(),
});
const previewOf = async (uid, what) => {
    const row = (await queue.readQueue(CID, uid)).find((entry) => entry.what === what);
    return row ? row.changes[0].preview : undefined;
};
const kinds = (preview) => preview.lines.map((line) => line.kind);
const line = (preview, kind) => preview.lines.find((entry) => entry.kind === kind);
const close = (taskId, over = {}) => Object.assign(stored(SCHEMA_TYPE.TASKS, taskId), DONE, { updatedAt: new Date() }, over);

beforeEach(() => {
    const made = seed();
    made.seedTask(T_ELSEWHERE, 'Done in the private project', P_PRIVATE, L_PRIVATE, { ...DONE, updatedAt: new Date() });
    [T_OPEN, T_OPEN_2, T_TWIN].forEach((id) => Object.assign(stored(SCHEMA_TYPE.TASKS, id), { updatedAt: new Date(), sprintId: L_OPEN }));
    Object.assign(stored(SCHEMA_TYPE.TASKS, T_SECRET), { updatedAt: new Date(), sprintId: L_SECRET });
});
afterEach(settle);

describe('a waiting rule carries its preview', () => {
    it('says what starts it, the rule in a sentence, every step, and that it starts switched off', async () => {
        propose('notice', draft());
        const preview = await previewOf(OWNER, 'notice');
        expect(preview.kind).toBe('automation');
        expect(preview.title).toContain(NOTICE);
        expect(kinds(preview)).toEqual(['place', 'ruleStart', 'rule', 'ruleStep', 'ruleStep', 'ruleState', 'ruleRuns']);
        expect(preview.lines[0]).toEqual({ kind: 'place', project: 'Open', list: '' });
        expect(line(preview, 'ruleStart')).toEqual({ kind: 'ruleStart', text: 'Task status changes' });
        expect(line(preview, 'rule').text).toMatch(/^When a task status changes to done, send "\[AI bench\] Done notice" to .+ and set the priority to LOW\.$/);
        expect(preview.lines.filter((entry) => entry.kind === 'ruleStep')).toEqual([
            { kind: 'ruleStep', n: 1, text: expect.stringContaining(NOTICE) },
            { kind: 'ruleStep', n: 2, text: 'Set the priority to LOW' },
        ]);
        expect(line(preview, 'ruleState')).toEqual({ kind: 'ruleState', on: false });
    });

    it('says when the rule starts switched on', async () => {
        propose('on', draft({ enabled: true }));
        expect(line(await previewOf(OWNER, 'on'), 'ruleState')).toEqual({ kind: 'ruleState', on: true });
    });
});

describe('how many past tasks it matches is counted for the person looking', () => {
    it('counts only this project\'s tasks, and names three of them', async () => {
        close(T_OPEN_2);
        close(T_TWIN);
        close(T_SECRET);
        close(T_OPEN, { updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) });
        propose('counted', draft());
        const preview = await previewOf(OWNER, 'counted');
        expect(line(preview, 'ruleRuns')).toEqual({ kind: 'ruleRuns', count: 3, days: 30 });
        const examples = line(preview, 'ruleExamples');
        expect(examples.tasks).toHaveLength(3);
        expect(examples.tasks.join(' | ')).toMatch(/Second open task/);
        expect(JSON.stringify(preview)).not.toMatch(/Done in the private project/);
        expect(await previewOf(ADMIN, 'counted')).toEqual(preview);
    });

    it('names at most three tasks', async () => {
        [T_OPEN, T_OPEN_2, T_TWIN, T_SECRET].forEach((id) => close(id));
        propose('four', draft());
        const preview = await previewOf(OWNER, 'four');
        expect(line(preview, 'ruleRuns')).toMatchObject({ count: 4 });
        expect(line(preview, 'ruleExamples').tasks).toHaveLength(3);
    });

    it('shows no count and no task to someone who cannot approve it', async () => {
        close(T_OPEN_2);
        close(T_SECRET);
        propose('for a member', draft());
        const preview = await previewOf(OUTSIDER, 'for a member');
        expect(kinds(preview)).toEqual(['place', 'ruleStart', 'rule', 'ruleStep', 'ruleStep', 'ruleState']);
        expect(JSON.stringify(preview)).not.toMatch(/Secret task|Second open task/);
    });

    it('shows nothing of a rule to someone who cannot open its project', async () => {
        close(T_ELSEWHERE);
        propose('hidden', draft({ projectId: P_PRIVATE }));
        expect(await previewOf(OUTSIDER, 'hidden')).toBeFalsy();
        expect(kinds(await previewOf(INSIDER, 'hidden'))).toEqual(['place', 'ruleStart', 'rule', 'ruleStep', 'ruleStep', 'ruleState']);
        propose('personal', draft({ projectId: P_PERSONAL }));
        expect(await previewOf(OWNER, 'personal')).toBeFalsy();
    });
});

describe('a rule that cannot be made says why instead', () => {
    it('names the part the project does not have', async () => {
        propose('stale', draft({ conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Shipped' }] }));
        const preview = await previewOf(OWNER, 'stale');
        expect(kinds(preview)).toEqual(['place', 'ruleProblem']);
        expect(line(preview, 'ruleProblem').text).toMatch(/Shipped/);
    });

    it('says a step an agent may not propose is not allowed, and shows no rule', async () => {
        propose('agent step', draft({ actions: [{ action: 'run_agent', config: { agent: 'Reviewer', skill: 'summarise' } }] }));
        const preview = await previewOf(OWNER, 'agent step');
        expect(kinds(preview)).toEqual(['place', 'ruleProblem']);
        expect(line(preview, 'ruleProblem').text).toMatch(/runs an AI agent/);
    });
});
