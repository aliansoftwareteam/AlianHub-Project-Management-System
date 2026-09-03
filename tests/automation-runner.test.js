jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const runner = require('../Modules/Automations/engine/runner');
const matcher = require('../Modules/Automations/engine/matcher');
const registry = require('../Modules/Automations/engine/registry');
const { createInlineDriver } = require('../Modules/Automations/engine/queue');

const TASK_ID = '507f1f77bcf86cd799439011';
const PROJECT_ID = '507f1f77bcf86cd799439012';

const envelope = (over = {}) => ({
    id: 'evt_1', companyId: 'c1', type: 'task.status_changed',
    actor: { kind: 'user', userId: 'u1' }, depth: 0,
    scope: { projectId: PROJECT_ID }, entity: { kind: 'task', id: TASK_ID, key: 'AHE-1' },
    data: { _id: TASK_ID, ProjectID: PROJECT_ID, statusType: 'close', Task_Priority: 'LOW', TaskName: 'Fix' },
    previous: { statusType: 'inprogress' }, changedFields: ['statusType'],
    ...over,
});

beforeEach(() => { MongoDbCrudOpration.mockReset(); matcher.invalidateAll(); });

describe('matcher', () => {
    const ruleFor = (over = {}) => ({
        _id: 'r1', name: 'Escalate', enabled: true, deletedStatusKey: 0,
        trigger: { type: 'event', event: 'task.status_changed' },
        conditions: { op: 'changedTo', field: 'statusType', value: 'close' },
        steps: [], ...over,
    });

    it('matches a rule whose trigger and conditions both hold', async () => {
        MongoDbCrudOpration.mockResolvedValue([ruleFor()]);
        expect(await matcher.match('c1', envelope())).toHaveLength(1);
    });

    it('ignores rules listening to a different event', async () => {
        MongoDbCrudOpration.mockResolvedValue([ruleFor({ trigger: { type: 'event', event: 'task.renamed' } })]);
        expect(await matcher.match('c1', envelope())).toHaveLength(0);
    });

    it('caches — a burst of events must not become a burst of queries', async () => {
        MongoDbCrudOpration.mockResolvedValue([ruleFor()]);
        await matcher.match('c1', envelope());
        await matcher.match('c1', envelope());
        await matcher.match('c1', envelope());
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
    });

    it('invalidate() makes a saved rule take effect immediately', async () => {
        MongoDbCrudOpration.mockResolvedValue([ruleFor()]);
        await matcher.match('c1', envelope());
        matcher.invalidate('c1');
        await matcher.match('c1', envelope());
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(2);
    });

    describe('loop guard', () => {
        it('ignores automation-authored events by default', async () => {
            MongoDbCrudOpration.mockResolvedValue([ruleFor()]);
            const fromAutomation = envelope({ actor: { kind: 'automation', userId: null } });
            expect(await matcher.match('c1', fromAutomation)).toHaveLength(0);
        });

        it('honours an explicit opt-in', async () => {
            MongoDbCrudOpration.mockResolvedValue([ruleFor({ reactToAutomation: true })]);
            const fromAutomation = envelope({ actor: { kind: 'automation', userId: null } });
            expect(await matcher.match('c1', fromAutomation)).toHaveLength(1);
        });
    });

    it('scopes rules to their projects', async () => {
        MongoDbCrudOpration.mockResolvedValue([ruleFor({ scope: { allProjects: false, projectIds: ['507f1f77bcf86cd7994390ff'] } })]);
        expect(await matcher.match('c1', envelope())).toHaveLength(0);
    });

    it('a malformed condition matches nothing — it must never fire on every event', async () => {
        MongoDbCrudOpration.mockResolvedValue([ruleFor({ conditions: { op: 'and', args: null } }), ruleFor({ _id: 'r2' })]);
        const hits = await matcher.match('c1', envelope());
        expect(hits.map((r) => r._id)).toEqual(['r2']);
    });
});

describe('runner — idempotency', () => {
    it('drops a duplicate event: the unique index rejects the second insert', async () => {
        const dup = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        MongoDbCrudOpration.mockRejectedValueOnce(dup);
        const run = await runner.createRun('c1', { _id: 'r1', name: 'x' }, envelope());
        expect(run).toBeNull();
    });

    it('propagates a non-duplicate insert failure rather than silently dropping work', async () => {
        MongoDbCrudOpration.mockRejectedValueOnce(new Error('connection reset'));
        await expect(runner.createRun('c1', { _id: 'r1' }, envelope())).rejects.toThrow('connection reset');
    });
});

describe('runner — checkpointing and retry', () => {
    const rule = {
        _id: 'r1', name: 'Escalate',
        steps: [
            { id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } },
            { id: 's2', type: 'action', action: 'add_comment', config: { body: 'Now {{task.statusType}}' } },
        ],
    };

    it('resumes at the cursor — completed steps are never replayed', async () => {
        const patches = [];
        const calls = [];
        MongoDbCrudOpration.mockImplementation(async (companyId, q, method) => {
            if (q.type === SCHEMA_TYPE.AUTOMATION_RUNS && method === 'findOne') {
                return { _id: 'run1', ruleId: 'r1', status: 'running', cursor: 1, attempts: 1, steps: [{ id: 's1' }], outputs: { s1: { changed: true } }, envelope: envelope() };
            }
            if (q.type === SCHEMA_TYPE.AUTOMATION_RULES && method === 'findOne') return rule;
            if (q.type === SCHEMA_TYPE.AUTOMATION_RUNS && method === 'updateOne') { patches.push(q.data[1].$set); return {}; }
            if (q.type === SCHEMA_TYPE.TASKS && method === 'findOne') return { _id: TASK_ID, CompanyId: 'c1', TaskName: 'Fix', ProjectID: PROJECT_ID };
            if (q.type === SCHEMA_TYPE.COMMENTS && method === 'save') { calls.push('comment'); return { _id: 'c99' }; }
            if (q.type === SCHEMA_TYPE.TASKS && method === 'findOneAndUpdate') { calls.push('update'); return { _id: TASK_ID, TaskName: 'Fix' }; }
            return null;
        });

        const out = await runner.execute({ companyId: 'c1', runId: 'run1', ruleId: 'r1' });
        expect(out.status).toBe('success');
        // Only step 2 ran: no second priority write.
        expect(calls).toEqual(['comment']);
        expect(patches.some((p) => p.cursor === 2)).toBe(true);
    });

    it('renders templates against the event before the action sees them', async () => {
        let savedComment = null;
        MongoDbCrudOpration.mockImplementation(async (companyId, q, method) => {
            if (q.type === SCHEMA_TYPE.AUTOMATION_RUNS && method === 'findOne') {
                return { _id: 'run1', ruleId: 'r1', status: 'queued', cursor: 1, steps: [], outputs: {}, envelope: envelope() };
            }
            if (q.type === SCHEMA_TYPE.AUTOMATION_RULES && method === 'findOne') return rule;
            if (q.type === SCHEMA_TYPE.TASKS && method === 'findOne') return { _id: TASK_ID, CompanyId: 'c1', ProjectID: PROJECT_ID };
            if (q.type === SCHEMA_TYPE.COMMENTS && method === 'save') { savedComment = q.data.message; return { _id: 'c1' }; }
            return {};
        });
        await runner.execute({ companyId: 'c1', runId: 'run1', ruleId: 'r1' });
        expect(savedComment).toBe('Now close');
    });

    it('fails a deterministic error immediately — no retry storm on a broken rule', async () => {
        const enqueue = jest.fn();
        let finalStatus = null;
        MongoDbCrudOpration.mockImplementation(async (companyId, q, method) => {
            if (q.type === SCHEMA_TYPE.AUTOMATION_RUNS && method === 'findOne') {
                return { _id: 'run1', ruleId: 'r1', status: 'queued', cursor: 0, attempts: 0, steps: [], outputs: {}, envelope: envelope() };
            }
            if (q.type === SCHEMA_TYPE.AUTOMATION_RULES && method === 'findOne') {
                return { _id: 'r1', name: 'x', steps: [{ id: 's1', type: 'action', action: 'no_such_action', config: {} }] };
            }
            if (q.type === SCHEMA_TYPE.AUTOMATION_RUNS && method === 'updateOne') {
                if (q.data[1].$set.status) finalStatus = q.data[1].$set.status;
                return {};
            }
            return {};
        });
        const out = await runner.execute({ companyId: 'c1', runId: 'run1', ruleId: 'r1', enqueue });
        expect(out.status).toBe('failed');
        expect(finalStatus).toBe('failed');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('retries a transient error with backoff', async () => {
        const enqueue = jest.fn();
        MongoDbCrudOpration.mockImplementation(async (companyId, q, method) => {
            if (q.type === SCHEMA_TYPE.AUTOMATION_RUNS && method === 'findOne') {
                return { _id: 'run1', ruleId: 'r1', status: 'queued', cursor: 0, attempts: 0, steps: [], outputs: {}, envelope: envelope() };
            }
            if (q.type === SCHEMA_TYPE.AUTOMATION_RULES && method === 'findOne') {
                return { _id: 'r1', name: 'x', steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }] };
            }
            if (q.type === SCHEMA_TYPE.TASKS && method === 'findOneAndUpdate') throw new Error('socket hang up');
            return {};
        });
        const out = await runner.execute({ companyId: 'c1', runId: 'run1', ruleId: 'r1', enqueue });
        expect(out.status).toBe('retrying');
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue.mock.calls[0][1].runAt.getTime()).toBeGreaterThan(Date.now() + 20000);
    });

    it('a condition step that fails stops the run without failing it', async () => {
        let finalStatus = null;
        MongoDbCrudOpration.mockImplementation(async (companyId, q, method) => {
            if (q.type === SCHEMA_TYPE.AUTOMATION_RUNS && method === 'findOne') {
                return { _id: 'run1', ruleId: 'r1', status: 'queued', cursor: 0, steps: [], outputs: {}, envelope: envelope() };
            }
            if (q.type === SCHEMA_TYPE.AUTOMATION_RULES && method === 'findOne') {
                return { _id: 'r1', steps: [{ id: 's1', type: 'condition', condition: { op: 'eq', field: 'taskType', value: 'bug' } }, { id: 's2', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }] };
            }
            if (q.type === SCHEMA_TYPE.AUTOMATION_RUNS && method === 'updateOne') {
                if (q.data[1].$set.status) finalStatus = q.data[1].$set.status;
                return {};
            }
            if (q.type === SCHEMA_TYPE.TASKS) throw new Error('step 2 must not run');
            return {};
        });
        const out = await runner.execute({ companyId: 'c1', runId: 'run1', ruleId: 'r1' });
        expect(out.status).toBe('stopped');
        expect(finalStatus).toBe('stopped');
    });
});

describe('registry', () => {
    it('exposes every registered action with a renderable schema', () => {
        const m = registry.manifest();
        expect(m.actions.map((a) => a.key).sort())
            .toEqual(['add_comment', 'create_subtask', 'run_agent', 'set_priority', 'set_status']);
        m.actions.forEach((a) => {
            expect(typeof a.label).toBe('string');
            expect(Object.keys(a.schema).length).toBeGreaterThan(0);
        });
    });

    it('never serialises the run function', () => {
        // Assert on the SHAPE, not on the substring "run" — `run_agent` is a
        // legitimate action key, and the original substring check only passed by
        // accident until an action was named after what it does.
        registry.manifest().actions.forEach((a) => {
            expect(a.run).toBeUndefined();
            expect(Object.values(a).some((v) => typeof v === 'function')).toBe(false);
        });
        expect(JSON.stringify(registry.manifest())).not.toContain('function');
    });

    it('marks which triggers carry a diff, so changedTo pairings can be validated', () => {
        const created = registry.getTrigger('task.created');
        const status = registry.getTrigger('task.status_changed');
        expect(created.hasDiff).toBe(false);
        expect(status.hasDiff).toBe(true);
    });
});

describe('queue adapter', () => {
    it('the inline driver runs a defined job', async () => {
        const d = createInlineDriver();
        const seen = [];
        d.define('j', async (job) => { seen.push(job.attrs.data); });
        await d.start();
        await d.enqueue('j', { runId: 'r1' });
        expect(seen).toEqual([{ runId: 'r1' }]);
    });

    it('refuses to enqueue a job nobody handles instead of dropping it', async () => {
        const d = createInlineDriver();
        await d.start();
        await expect(d.enqueue('missing', {})).rejects.toThrow('no handler defined');
    });
});
