jest.mock('../Modules/Workflows/store');
jest.mock('../Modules/Workflows/queue');
jest.mock('../Modules/Workflows/definitions');
jest.mock('../Modules/Agents/access');
jest.mock('../utils/mongo-handler/mongoQueries');

const store = require('../Modules/Workflows/store');
const queue = require('../Modules/Workflows/queue');
const definitions = require('../Modules/Workflows/definitions');
const access = require('../Modules/Agents/access');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const controller = require('../Modules/Workflows/controller');
const stepTypes = require('../Modules/Workflows/stepTypes');

const COMPANY = '0123456789abcdef01234567';
const WORKFLOW_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TASK_ID = 'cccccccccccccccccccccccc';
const AGENT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const OWNER = 'dddddddddddddddddddddddd';
const MEMBER = 'eeeeeeeeeeeeeeeeeeeeeeee';

const VALID_STEPS = [
    { id: 'sOne', type: 'agent_run', config: { agentId: AGENT_ID, taskId: TASK_ID, budgetUsd: 2 } },
    { id: 'sTwo', type: 'human_approval', dependsOn: ['sOne'], config: { prompt: 'Ship $sOne.findings?' } },
];

const reqFor = (over = {}) => ({ headers: { companyid: COMPANY }, params: {}, query: {}, body: {}, ip: '', ...over });

const resSpy = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};

const asCaller = ({ privileged = true, userId = OWNER } = {}) => {
    access.callerOf.mockResolvedValue({ actor: { userId, kind: 'human' }, human: true, privileged });
    access.canManageAgents.mockImplementation((caller) => Boolean(caller && caller.human && caller.privileged));
    access.visibleProjectIdsFor.mockResolvedValue([]);
};

const savedFlag = process.env.WORKFLOW_ENGINE;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.WORKFLOW_ENGINE = 'on';
    asCaller();
    queue.dispatch.mockResolvedValue('queued');
    definitions.list.mockResolvedValue([]);
    definitions.create.mockImplementation(async (companyId, data) => ({ _id: WORKFLOW_ID, enabled: false, ...data }));
    definitions.update.mockImplementation(async (companyId, id, data) => ({ _id: id, enabled: false, ...data }));
    definitions.get.mockResolvedValue({ _id: WORKFLOW_ID, name: 'Ship it', enabled: false, steps: VALID_STEPS });
    definitions.setEnabled.mockImplementation(async (companyId, id, enabled) => ({ _id: id, enabled }));
    definitions.remove.mockResolvedValue({ _id: WORKFLOW_ID });
    MongoDbCrudOpration.mockResolvedValue(null);
});

afterAll(() => { if (savedFlag === undefined) delete process.env.WORKFLOW_ENGINE; else process.env.WORKFLOW_ENGINE = savedFlag; });

describe('the step-type manifest is what the builder composes from', () => {
    it('serves every registered contract with its config and output fields', async () => {
        const res = resSpy();
        await controller.getStepTypes(reqFor(), res);
        expect(res.body.status).toBe(true);
        expect(res.body.data.stepTypes.map((contract) => contract.key)).toEqual(stepTypes.TYPES);
        const agentRun = res.body.data.stepTypes.find((contract) => contract.key === stepTypes.AGENT_RUN);
        expect(agentRun.config.agentId).toMatchObject({ type: 'agent', required: true });
        expect(agentRun.output.costUsd).toMatchObject({ type: 'number', required: true });
        expect(res.body.data.bounds).toEqual(expect.objectContaining({ maxFanOut: expect.any(Number) }));
    });

    it('answers 503 on the builder surface while the engine is off', async () => {
        process.env.WORKFLOW_ENGINE = 'off';
        const handlers = [controller.getStepTypes, controller.listDefinitions, controller.createDefinition, controller.updateDefinition, controller.setDefinitionEnabled, controller.deleteDefinition, controller.dryRun];
        for (const handler of handlers) {
            const res = resSpy();
            // eslint-disable-next-line no-await-in-loop
            await handler(reqFor({ params: { id: WORKFLOW_ID }, body: { steps: VALID_STEPS } }), res);
            expect(res.statusCode).toBe(503);
            expect(res.body.message).toMatch(/WORKFLOW_ENGINE/);
        }
    });
});

describe('a workflow is saved turned off', () => {
    it('ignores an "enabled" the body asked for', async () => {
        const res = resSpy();
        await controller.createDefinition(reqFor({ body: { name: 'Ship it', enabled: true, steps: VALID_STEPS } }), res);
        expect(res.body.status).toBe(true);
        expect(res.body.data.enabled).toBe(false);
        expect(definitions.create).toHaveBeenCalledWith(COMPANY, expect.objectContaining({ name: 'Ship it', by: OWNER }));
        expect(definitions.create.mock.calls[0][1]).not.toHaveProperty('enabled');
    });

    it('turns one on only as its own act, and only when it still validates', async () => {
        const res = resSpy();
        await controller.setDefinitionEnabled(reqFor({ params: { id: WORKFLOW_ID }, body: { enabled: true } }), res);
        expect(definitions.setEnabled).toHaveBeenCalledWith(COMPANY, WORKFLOW_ID, true, OWNER);
        expect(res.body.data.enabled).toBe(true);

        definitions.get.mockResolvedValue({ _id: WORKFLOW_ID, enabled: false, steps: [{ id: 'sOne', type: 'tool_call', config: {} }] });
        const refused = resSpy();
        await controller.setDefinitionEnabled(reqFor({ params: { id: WORKFLOW_ID }, body: { enabled: true } }), refused);
        expect(refused.statusCode).toBe(400);
        expect(refused.body.errors[0]).toMatch(/config\.tool/);
        expect(definitions.setEnabled).toHaveBeenCalledTimes(1);
    });

    it('refuses to start a run of a workflow nobody turned on', async () => {
        const res = resSpy();
        await controller.startRun(reqFor({ body: { definitionId: WORKFLOW_ID } }), res);
        expect(res.statusCode).toBe(409);
        expect(store.createRun).not.toHaveBeenCalled();
    });
});

describe('an invalid definition is refused with the field named', () => {
    it.each([
        [[{ id: 'sOne', type: 'tool_call', config: {} }], /steps\[0\]\.config\.tool: required/],
        [[{ id: 'sOne', type: 'human_approval', config: { onReject: 'explode' } }], /config\.onReject: must be one of/],
        [[{ id: 'sOne', type: 'wait', dependsOn: ['sGhost'], config: { forMs: 10 } }], /dependsOn/],
    ])('names the slot rather than refusing the whole workflow in one sentence', async (steps, expected) => {
        const res = resSpy();
        await controller.createDefinition(reqFor({ body: { name: 'Broken', steps } }), res);
        expect(res.statusCode).toBe(400);
        expect(res.body.errors.join('; ')).toMatch(expected);
        expect(definitions.create).not.toHaveBeenCalled();
    });

    it('needs a name', async () => {
        const res = resSpy();
        await controller.createDefinition(reqFor({ body: { steps: VALID_STEPS } }), res);
        expect(res.body.errors).toContain('name: required');
    });
});

describe('a dry run plans against a real input and writes nothing', () => {
    it('resolves the task, orders the steps and says what each one would do', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: TASK_ID, TaskName: 'Fix the importer', ProjectID: 'p1' });
        const res = resSpy();
        await controller.dryRun(reqFor({ body: { steps: VALID_STEPS, taskId: TASK_ID, budgetUsd: 5 } }), res);

        expect(res.body.data.valid).toBe(true);
        expect(res.body.data.input).toMatchObject({ kind: 'task', found: true, name: 'Fix the importer' });
        expect(res.body.data.waves).toEqual([['sOne'], ['sTwo']]);
        expect(res.body.data.steps[0]).toMatchObject({ stepId: 'sOne', effect: 'writes', wave: 1 });
        expect(res.body.data.steps[1]).toMatchObject({ stepId: 'sTwo', effect: 'asks', reads: ['$sOne.findings'] });
        expect(res.body.data.summary).toMatchObject({ stepCount: 2, waveCount: 2, writeCount: 1, approvalCount: 1 });

        expect(store.createRun).not.toHaveBeenCalled();
        expect(queue.dispatch).not.toHaveBeenCalled();
        expect(MongoDbCrudOpration.mock.calls.every(([, , method]) => method === 'findOne')).toBe(true);
    });

    it('answers with the invalid field rather than a plan', async () => {
        const res = resSpy();
        await controller.dryRun(reqFor({ body: { steps: [{ id: 'sOne', type: 'tool_call', config: {} }] } }), res);
        expect(res.body.data.valid).toBe(false);
        expect(res.body.data.errors[0]).toMatch(/config\.tool: required/);
        expect(res.body.data.steps).toEqual([]);
    });

    it('names a step that could never run', async () => {
        const res = resSpy();
        await controller.dryRun(reqFor({
            body: {
                steps: [
                    { id: 'sOne', type: 'wait', dependsOn: ['sTwo'], config: { forMs: 10 } },
                    { id: 'sTwo', type: 'wait', dependsOn: ['sOne'], config: { forMs: 10 } },
                ],
            },
        }), res);
        expect(res.body.data.unreachable).toEqual(['sOne', 'sTwo']);
    });
});

describe('the builder is an Owner and an Admin surface', () => {
    it('refuses a member every write and the dry run', async () => {
        asCaller({ privileged: false, userId: MEMBER });
        const handlers = [controller.createDefinition, controller.updateDefinition, controller.setDefinitionEnabled, controller.deleteDefinition, controller.dryRun, controller.listDefinitions];
        for (const handler of handlers) {
            const res = resSpy();
            // eslint-disable-next-line no-await-in-loop
            await handler(reqFor({ params: { id: WORKFLOW_ID }, body: { name: 'Ship it', steps: VALID_STEPS } }), res);
            expect(res.statusCode).toBe(403);
            expect(res.body.message).toMatch(/Owner or an Admin/);
        }
        expect(definitions.create).not.toHaveBeenCalled();
        expect(definitions.setEnabled).not.toHaveBeenCalled();
    });

    it('refuses an agent outright', async () => {
        access.callerOf.mockResolvedValue({ actor: { userId: AGENT_ID, kind: 'agent' }, human: false, privileged: false });
        const res = resSpy();
        await controller.dryRun(reqFor({ body: { steps: VALID_STEPS } }), res);
        expect(res.statusCode).toBe(403);
    });
});
