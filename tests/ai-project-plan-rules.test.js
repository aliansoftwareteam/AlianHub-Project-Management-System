const mockChat = jest.fn();
jest.mock('../Modules/AICore/llmProvider', () => ({
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
    isAnyProviderConfigured: () => true,
}));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async () => []), getActiveSkillSlugs: jest.fn(async () => []) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ normalizePlanColors: (p) => p, executePlan: jest.fn(async () => ({ ok: true })) }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn() }));

const persistence = require('../Modules/AICore/persistence');
const permissionGuard = require('../Config/permissionGuard');
const projectSetup = require('../Modules/Agents/projectSetup');
const permissions = require('../Modules/Agents/permissions');
const actions = require('../Modules/Agents/actions');
const sseEmitter = require('../Modules/AIProjectGenerator/sseEmitter');
const orchestrator = require('../Modules/AIProjectGenerator/orchestrator');
const ctrl = require('../Modules/AIProjectGenerator/controller');
const planAutomations = require('../Modules/AIProjectGenerator/planAutomations');
const { PlanSchema } = require('../Modules/AIProjectGenerator/schemaValidator');
const { buildSystemPrompt } = require('../Modules/AIProjectGenerator/promptBuilder');
const { catalogueForAgents } = require('../Modules/Agents/automationRequests');

const C = '6f0000000000000000000c01';
const U = '6f0000000000000000000a01';
const P = '6f0000000000000000000702';
const ROLE_OWNER = 1;
const ROLE_MEMBER = 3;

const TELL_CREATOR = { name: 'Tell the creator when done', trigger: 'task.status_changed', conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Done' }], actions: [{ action: 'notify', config: { recipients: ['task_creator'], message: 'Finished.' } }] };
const REVIEW_SUBTASK = { name: 'Add a review subtask', trigger: 'task.created', actions: [{ action: 'create_subtask', config: { title: 'Review' } }] };
const OVERDUE_HIGH = { name: 'Overdue goes high', trigger: 'task.due_date_passed', actions: [{ action: 'set_priority', config: { priority: 'HIGH' } }] };

const project = {
    ProjectName: 'Bike shop',
    description: 'A project long enough to pass the minimum.',
    projectStatusData: [{ name: 'Planning', type: 'default_active' }, { name: 'Closed', type: 'close' }],
    taskStatusData: [{ name: 'To Do', type: 'default_active' }, { name: 'Done', type: 'close' }],
    taskTypeCounts: [{ name: 'Task', key: 1 }],
};

const validPlan = (rules) => ({
    project,
    sprints: [{
        sprintName: 'Sprint 1',
        tasks: [{
            TaskName: 'Set up the repo',
            status: 'To Do',
            priority: 'Medium',
            descriptionBlocks: [
                { type: 'paragraph', data: { text: 'Context for the task.' } },
                { type: 'header', data: { text: 'What to do', level: 4 } },
                { type: 'list', data: { style: 'ordered', items: ['Step one'] } },
                { type: 'header', data: { text: 'Acceptance criteria', level: 4 } },
                { type: 'list', data: { style: 'unordered', items: ['It works'] } },
            ],
        }],
    }],
    ...(rules ? { rules } : {}),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body) => ({ headers: { companyid: C }, aud: [C], body, uid: U });
const shapeOf = ({ name, trigger, conditions = [], actions: steps }) => ({ name, trigger, conditions, actions: steps });
const keptOf = (rule) => ({ ...shapeOf(rule), sentence: expect.stringMatching(/^When .+\.$/) });

let mem;
const flag = process.env.MCP_TOOLS_WORK;
beforeEach(() => {
    mockChat.mockReset();
    sseEmitter.emit.mockClear();
    orchestrator.executePlan.mockClear();
    permissionGuard.getRoleType.mockReset();
    mem = persistence.useInMemory();
});
afterEach(() => {
    mem.reset();
    persistence.useMongo();
    jest.restoreAllMocks();
    if (flag === undefined) delete process.env.MCP_TOOLS_WORK; else process.env.MCP_TOOLS_WORK = flag;
});

describe('the plan schema and prompt', () => {
    it('lets any rule through for /plan to trim, rather than sending the plan back for repair', () => {
        expect(PlanSchema.safeParse(validPlan([TELL_CREATOR, 'junk', { trigger: 42 }])).success).toBe(true);
        expect(PlanSchema.safeParse(validPlan()).success).toBe(true);
        expect(PlanSchema.safeParse(validPlan(Array.from({ length: 21 }, () => REVIEW_SUBTASK))).success).toBe(false);
        expect(PlanSchema.safeParse({ ...validPlan(), rulesDropped: [{ name: 'x', reason: 'y', code: 'step' }] }).data.rulesDropped).toEqual([{ name: 'x', reason: 'y', code: 'step' }]);
    });

    it('asks the model for up to three automations, from catalogue triggers and steps only', () => {
        const prompt = buildSystemPrompt();
        expect(prompt).toContain('# Automations');
        expect(prompt).toContain('"rules": [');
        const catalogue = catalogueForAgents();
        const start = prompt.indexOf('# Automations');
        const section = prompt.slice(start, prompt.indexOf('\n---\n', start));
        const triggers = [...section.matchAll(/`(task\.[a-z_]+)`/g)].map((m) => m[1]);
        expect(triggers.length).toBeGreaterThan(0);
        triggers.forEach((key) => expect(catalogue.triggers.map((t) => t.key)).toContain(key));
        const steps = [...section.matchAll(/^ {2}- `([a-z_]+)`: /gm)].map((m) => m[1]);
        expect(steps.sort()).toEqual(catalogue.steps.map((s) => s.key).sort());
    });
});

describe('trimming the rules', () => {
    it('keeps up to three catalogue rules and drops the rest, each with a code', () => {
        const { kept, dropped } = planAutomations.trimRules([
            TELL_CREATOR,
            { name: 'Email the client', trigger: 'task.created', actions: [{ action: 'send_email', config: {} }] },
            { name: 'Run the agent', trigger: 'task.created', actions: [{ action: 'run_agent', config: {} }] },
            { name: 'From a form', trigger: 'form.submitted', actions: [{ action: 'set_priority', config: { priority: 'HIGH' } }] },
            { name: 'Made up', trigger: 'task.exploded', actions: [{ action: 'set_priority', config: { priority: 'HIGH' } }] },
            { name: 'Odd status', trigger: 'task.status_changed', conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Shipped' }], actions: [{ action: 'add_comment', config: { body: 'x' } }] },
            { name: 'Names a person', trigger: 'task.created', actions: [{ action: 'assign', config: { mode: 'add', userIds: ['Priya'] } }] },
            { name: '', trigger: 'task.created', actions: [{ action: 'add_comment', config: { body: 'x' } }] },
            REVIEW_SUBTASK, OVERDUE_HIGH,
            { name: 'One too many', trigger: 'task.created', actions: [{ action: 'add_comment', config: { body: 'x' } }] },
        ], project);
        expect(kept.map((rule) => rule.name)).toEqual(['Tell the creator when done', 'Add a review subtask', 'Overdue goes high']);
        expect(dropped.map(({ name, code }) => [name, code])).toEqual([
            ['Email the client', 'step'],
            ['Run the agent', 'step'],
            ['From a form', 'trigger'],
            ['Made up', 'trigger'],
            ['Odd status', 'fit'],
            ['Names a person', 'fit'],
            ['', 'name_missing'],
            ['One too many', 'too_many'],
        ]);
        expect(dropped.every((entry) => typeof entry.reason === 'string' && entry.reason)).toBe(true);
    });

    it('keeps each rule as the draft automation.create takes, never switched on and never reacting to automations', () => {
        const { kept } = planAutomations.trimRules([{ ...TELL_CREATOR, enabled: true, reactToAutomation: true, projectId: P, junk: 1 }], project);
        expect(kept).toEqual([keptOf(TELL_CREATOR)]);
        expect(planAutomations.trimRules(kept, project).kept).toEqual(kept);
    });

    it('carries the sentence of the rule that will be made, for the person to read before approving', () => {
        const { kept } = planAutomations.trimRules([TELL_CREATOR, OVERDUE_HIGH], project);
        expect(kept[0].sentence).toBe('When a task status changes to done, send "Finished." to the task creator.');
        expect(kept[1].sentence).toMatch(/^When .*HIGH/i);
    });

    it('holds a starter automation to 1 to 3 steps, as the prompt says', () => {
        const step = { action: 'add_comment', config: { body: 'x' } };
        const { kept, dropped } = planAutomations.trimRules([
            { name: 'None', trigger: 'task.created', actions: [] },
            { name: 'Four', trigger: 'task.created', actions: [step, step, step, step] },
            { name: 'Three', trigger: 'task.created', actions: [step, step, step] },
        ], project);
        expect(kept.map((rule) => rule.name)).toEqual(['Three']);
        expect(dropped.map(({ name, code }) => [name, code])).toEqual([['None', 'steps'], ['Four', 'steps']]);
    });

    it('caps a dropped reason, so a long model value cannot fail the plan\'s final validation', () => {
        const long = 'x'.repeat(2500);
        const { dropped } = planAutomations.trimRules([{ name: 'Long', trigger: 'task.status_changed', conditions: [{ field: 'statusRef', op: 'changedTo', value: long }], actions: [{ action: 'add_comment', config: { body: 'x' } }] }], project);
        expect(dropped).toHaveLength(1);
        expect(dropped[0].reason.length).toBeLessThanOrEqual(300);
        expect(PlanSchema.safeParse({ ...validPlan(), rulesDropped: dropped }).success).toBe(true);
    });

    it('reads anything that is not a list as no rules', () => {
        expect(planAutomations.trimRules(undefined, project)).toEqual({ kept: [], dropped: [] });
        expect(planAutomations.trimRules('rules', project)).toEqual({ kept: [], dropped: [] });
    });

    it('says a refusal in a code a screen can word', () => {
        expect(planAutomations.refusalCode('Only an owner or an admin can approve an automation, so it was not made.')).toBe('admin');
        expect(planAutomations.refusalCode('Only owners and admins can manage automations, so a rule cannot be proposed for anyone else. Ask an owner or an admin.')).toBe('admin');
        expect(planAutomations.refusalCode('automation.create is switched off on this server, so this part was not made.')).toBe('off');
        expect(planAutomations.refusalCode('The person approving may not make this part: permission_denied: x')).toBe('permission');
        expect(planAutomations.refusalCode('The automation was not saved.')).toBe('other');
        expect(planAutomations.refusalCode(undefined)).toBe('other');
    });
});

describe('/plan and /execute', () => {
    it('sends the kept rules and what was left out, with why', async () => {
        permissionGuard.getRoleType.mockResolvedValue(ROLE_OWNER);
        const bad = { name: 'Email the client', trigger: 'task.created', actions: [{ action: 'send_email', config: {} }] };
        mockChat.mockResolvedValue({ content: JSON.stringify({ needsClarification: false, plan: validPlan([TELL_CREATOR, bad]) }), inputTokens: 1, outputTokens: 1, totalTokens: 2, model: 'fake-1' });
        const r = res();
        await ctrl.plan(req({ description: 'A shop for bikes; tell whoever opened a task when it is done.' }), r);
        expect(r.body).toMatchObject({ status: true });
        await sleep(350);
        const complete = sseEmitter.emit.mock.calls.map(([, payload]) => payload).find((payload) => payload.event === 'complete');
        expect(complete.plan.rules).toEqual([keptOf(TELL_CREATOR)]);
        expect(complete.plan.rulesDropped).toEqual([{ name: 'Email the client', reason: expect.stringContaining('Only these steps'), code: 'step' }]);
    });

    it('keeps the rules at /plan but locks them, with why, for a person who may not manage automations', async () => {
        permissionGuard.getRoleType.mockResolvedValue(ROLE_MEMBER);
        mockChat.mockResolvedValue({ content: JSON.stringify({ needsClarification: false, plan: validPlan([TELL_CREATOR, REVIEW_SUBTASK]) }), inputTokens: 1, outputTokens: 1, totalTokens: 2, model: 'fake-1' });
        await ctrl.plan(req({ description: 'A shop for bikes; tell whoever opened a task when it is done.' }), res());
        await sleep(350);
        const complete = sseEmitter.emit.mock.calls.map(([, payload]) => payload).find((payload) => payload.event === 'complete');
        expect(complete.plan.rules.map((rule) => rule.name)).toEqual(['Tell the creator when done', 'Add a review subtask']);
        expect(complete.plan.rulesDropped).toEqual([]);
        expect(complete.plan.locked).toEqual(['rules:0', 'rules:1']);
        expect(complete.plan.lockedWhy).toEqual({ 'rules:0': 'owner_admin', 'rules:1': 'owner_admin' });
    });

    it('still sends the plan when a rule carries a 2500-character value', async () => {
        permissionGuard.getRoleType.mockResolvedValue(ROLE_OWNER);
        const long = { name: 'Long', trigger: 'task.status_changed', conditions: [{ field: 'statusRef', op: 'changedTo', value: 'y'.repeat(2500) }], actions: [{ action: 'add_comment', config: { body: 'x' } }] };
        mockChat.mockResolvedValue({ content: JSON.stringify({ needsClarification: false, plan: validPlan([long]) }), inputTokens: 1, outputTokens: 1, totalTokens: 2, model: 'fake-1' });
        await ctrl.plan(req({ description: 'A shop for bikes with a very long rule.' }), res());
        await sleep(350);
        const complete = sseEmitter.emit.mock.calls.map(([, payload]) => payload).find((payload) => payload.event === 'complete');
        expect(complete.plan.rulesDropped).toEqual([{ name: 'Long', reason: expect.any(String), code: 'fit' }]);
    });

    it('trims the rules again at /execute, whatever the client sends back', async () => {
        permissionGuard.getRoleType.mockResolvedValue(ROLE_OWNER);
        const sneaked = { name: 'Sneaked in', trigger: 'task.created', actions: [{ action: 'run_agent', config: {} }], enabled: true };
        const r = res();
        await ctrl.execute(req({ plan: { ...validPlan([sneaked, TELL_CREATOR, REVIEW_SUBTASK, OVERDUE_HIGH, REVIEW_SUBTASK]), rulesDropped: [] }, source: 'other' }), r);
        expect(r.body).toMatchObject({ status: true });
        await sleep(350);
        const { plan } = orchestrator.executePlan.mock.calls[0][0];
        expect(plan.rules.map((rule) => rule.name)).toEqual(['Tell the creator when done', 'Add a review subtask', 'Overdue goes high']);
        expect(plan.rules.every((rule) => !('enabled' in rule))).toBe(true);
        expect(plan.rulesDropped).toBeUndefined();
    });

    it('leaves the rules out at /execute for a person who may not manage automations, even when ticked', async () => {
        permissionGuard.getRoleType.mockResolvedValue(ROLE_MEMBER);
        const r = res();
        await ctrl.execute(req({ plan: validPlan([TELL_CREATOR]), picks: { lists: [0], tasks: [0], rules: [0] }, source: 'other' }), r);
        expect(r.body).toMatchObject({ status: true });
        await sleep(350);
        expect(orchestrator.executePlan.mock.calls[0][0].plan.rules).toEqual([]);
    });
});

describe('making the rules', () => {
    it('hands the kept rules to the shared plan executor as the person who ran the generator, who approves them', async () => {
        const carryOut = jest.spyOn(projectSetup, 'carryOut').mockResolvedValue([{ part: 'rules', ok: false, items: [
            { name: 'When a task is done…', made: true, ruleId: 'r1', auditId: 'a1' },
            { name: 'automation number 2', made: false, error: 'The automation was not saved.' },
        ] }]);
        const out = await planAutomations.makeRules({ companyId: C, uid: U, projectId: P, plan: validPlan([TELL_CREATOR, REVIEW_SUBTASK, { name: 'Bad', trigger: 'nope', actions: [] }]) });
        expect(carryOut).toHaveBeenCalledTimes(1);
        const [given] = carryOut.mock.calls[0];
        expect(given).toMatchObject({ companyId: C, projectId: P, approvedBy: U, who: { uid: U }, asked: { actor: { kind: 'human', userId: U }, depth: 0 } });
        expect(given.plan).toEqual({ rules: [TELL_CREATOR, REVIEW_SUBTASK].map(({ name, ...rule }) => ({ conditions: [], ...rule })) });
        expect(out).toEqual({
            made: [{ name: 'Tell the creator when done', sentence: expect.stringMatching(/^When /), ruleId: 'r1' }],
            notMade: [{ name: 'Add a review subtask', reason: 'The automation was not saved.', code: 'other' }],
        });
    });

    it('makes nothing and asks nothing when the plan has no rules', async () => {
        const carryOut = jest.spyOn(projectSetup, 'carryOut');
        expect(await planAutomations.makeRules({ companyId: C, uid: U, projectId: P, plan: validPlan() })).toEqual({ made: [], notMade: [] });
        expect(carryOut).not.toHaveBeenCalled();
    });

    it('creates each rule switched off, through automation.create with its own audit row', async () => {
        permissionGuard.getRoleType.mockResolvedValue(ROLE_OWNER);
        jest.spyOn(permissions, 'holderMay').mockResolvedValue({ allowed: true });
        const perform = jest.spyOn(actions, 'perform').mockImplementation(async ({ params }) => ({ result: { ruleId: `rule-${params.trigger}`, sentence: 'x' }, auditId: 'audit-1' }));
        const out = await planAutomations.makeRules({ companyId: C, uid: U, projectId: P, plan: validPlan([TELL_CREATOR, REVIEW_SUBTASK]) });
        expect(perform).toHaveBeenCalledTimes(2);
        perform.mock.calls.forEach(([call]) => {
            expect(call).toMatchObject({ companyId: C, action: 'automation.create', actor: { kind: 'human', userId: U }, approved: true, approvedBy: U });
            expect(call.params).toMatchObject({ projectId: P, enabled: false, __proposal: true });
        });
        expect(out.made.map((rule) => rule.ruleId)).toEqual(['rule-task.status_changed', 'rule-task.created']);
        expect(out.notMade).toEqual([]);
    });

    it('gives a person who may not make rules the project without them, and a line saying why', async () => {
        permissionGuard.getRoleType.mockResolvedValue(ROLE_MEMBER);
        const perform = jest.spyOn(actions, 'perform');
        const out = await planAutomations.makeRules({ companyId: C, uid: U, projectId: P, plan: validPlan([TELL_CREATOR]) });
        expect(perform).not.toHaveBeenCalled();
        expect(out).toEqual({ made: [], notMade: [{ name: 'Tell the creator when done', reason: expect.stringMatching(/^Only an owner or an admin/), code: 'admin' }] });
    });

    it('says so when automations are switched off on the server', async () => {
        process.env.MCP_TOOLS_WORK = 'false';
        const out = await planAutomations.makeRules({ companyId: C, uid: U, projectId: P, plan: validPlan([TELL_CREATOR]) });
        expect(out.notMade.map((entry) => entry.code)).toEqual(['off']);
    });

    it('never throws, so a rule that breaks cannot undo the project', async () => {
        jest.spyOn(projectSetup, 'carryOut').mockRejectedValue(new Error('the database went away'));
        await expect(planAutomations.makeRules({ companyId: C, uid: U, projectId: P, plan: validPlan([TELL_CREATOR]) }))
            .resolves.toEqual({ made: [], notMade: [{ name: 'Tell the creator when done', reason: 'the database went away', code: 'other' }] });
    });
});
