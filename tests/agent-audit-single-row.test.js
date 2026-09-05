const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({
    forStatusChange: jest.fn(async () => null),
    recordWork: jest.fn(async () => null),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Automations/engine/tools');

const CID = '6a8ee973d625fca52e519a12';
const TASK_ID = '6f0000000000000000000701';
const AGENT_ID = '6f0000000000000000000a01';
const RUN_ID = '6f0000000000000000000c01';
const RULE_ID = '6f0000000000000000000b01';
const PROJECT_ID = '6a9954186dd786246031e47b';

const agentActor = { kind: 'agent', userId: '', agentId: AGENT_ID, agentName: 'Code Reviewer', runId: RUN_ID, viaAccount: 'workspace' };
const ruleContext = { runId: 'auto1', ruleId: RULE_ID, ruleName: 'QA on done', depth: 0 };

const auditRows = () => mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_ID, CompanyId: CID, ProjectID: PROJECT_ID, TaskName: 'Fix the thing', TaskKey: 'AR-1', Task_Priority: 'LOW' });
});

describe('an agent action through actions.perform is audited exactly once', () => {
    it('task.comment leaves one agent.action row carrying the undo descriptor and the agent attribution', async () => {
        const out = await actions.perform({ companyId: CID, actor: agentActor, action: 'task.comment', params: { taskId: TASK_ID, body: 'Looks good' }, reason: 'qa-review finding' });

        const rows = auditRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            _id: out.auditId,
            action: 'agent.action',
            actorId: AGENT_ID,
            actorName: 'Code Reviewer',
            entityType: 'task',
            entityId: TASK_ID,
            meta: {
                action: 'task.comment',
                actorType: 'agent',
                agentId: AGENT_ID,
                runId: RUN_ID,
                undoable: true,
                undo: { kind: 'comment', commentId: out.result.commentId, taskId: TASK_ID },
            },
        });
        expect(rows.some((r) => String(r.action).startsWith('automation.'))).toBe(false);
    });

    it('task.update (the updateTask path) also leaves a single row, with the previous values for undo', async () => {
        const out = await actions.perform({ companyId: CID, actor: agentActor, action: 'task.update', params: { taskId: TASK_ID, fields: { Task_Priority: 'HIGH' } } });

        const rows = auditRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ _id: out.auditId, action: 'agent.action', actorId: AGENT_ID, meta: { actorType: 'agent', undo: { kind: 'update', taskId: TASK_ID, previous: { Task_Priority: 'LOW' } } } });
        expect(mockDb.store[SCHEMA_TYPE.TASKS][0].Task_Priority).toBe('HIGH');
    });
});

describe('a plain automation rule still gets its automation.task.* row', () => {
    it('addComment run by the engine records automation.task.comment against the rule', async () => {
        await tools.addComment(CID, TASK_ID, 'Reminder from the rule', ruleContext);

        const rows = auditRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: 'automation.task.comment', actorId: `rule:${RULE_ID}`, actorName: 'QA on done', entityId: TASK_ID, meta: { runId: 'auto1', ruleId: RULE_ID } });
    });

    it('updateTask run by the engine records the action the step named', async () => {
        await tools.updateTask(CID, TASK_ID, { Task_Priority: 'URGENT' }, { ...ruleContext, action: 'automation.task.set_priority' });

        const rows = auditRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: 'automation.task.set_priority', actorId: `rule:${RULE_ID}`, meta: { fields: ['Task_Priority'] } });
    });

    it('a tool called with no context at all still writes its row as "automation"', async () => {
        await tools.updateTask(CID, TASK_ID, { Task_Priority: 'MEDIUM' });

        expect(auditRows()).toHaveLength(1);
        expect(auditRows()[0]).toMatchObject({ action: 'automation.task.update', actorId: 'automation', actorName: 'Automation' });
    });
});
