jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const registry = require('../Modules/Automations/engine/registry');
const matcher = require('../Modules/Automations/engine/matcher');
const { validateRuleV2 } = require('../Modules/Automations/helpers/ruleSchemaV2');
const { buildFormEnvelope, answerMap, EVENT_TYPE } = require('../Modules/Automations/engine/formEvent');

const COMPANY_ID = 'c1';
const FORM_ID = '507f1f77bcf86cd799439021';
const PROJECT_ID = '507f1f77bcf86cd799439012';
const TASK_ID = '507f1f77bcf86cd799439011';

const submission = (over = {}) => buildFormEnvelope({
    companyId: COMPANY_ID,
    form: { _id: FORM_ID, title: 'Bug report', ProjectID: PROJECT_ID, sprintId: null },
    submissionId: 'sub1',
    answers: [
        { questionId: 'q1', label: 'Severity', value: 'Blocking' },
        { questionId: 'q2', label: 'Email', value: 'a@b.c' },
    ],
    task: { _id: TASK_ID, TaskKey: 'AHE-9', TaskName: 'Login is down', Task_Priority: 'LOW' },
    actor: { kind: 'system' },
    ...over,
});

const rule = (over = {}) => ({
    _id: 'r1',
    name: 'On submit: Change priority',
    enabled: true,
    deletedStatusKey: 0,
    trigger: { type: 'event', event: EVENT_TYPE },
    scope: { allProjects: false, projectIds: [PROJECT_ID] },
    conditions: {
        op: 'and',
        args: [
            { op: 'eq', field: 'formId', value: FORM_ID },
            { op: 'eq', field: 'answers.q1', value: 'Blocking' },
        ],
    },
    steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }],
    ...over,
});

beforeEach(() => { MongoDbCrudOpration.mockReset(); matcher.invalidateAll(); });

describe('form.submitted trigger', () => {
    it('is registered and offered by the manifest', () => {
        const trigger = registry.getTrigger(EVENT_TYPE);
        expect(trigger).toBeTruthy();
        expect(trigger.entity).toBe('form');
        expect(trigger.hasDiff).toBe(false);
        expect(registry.manifest().triggers.map((t) => t.key)).toContain(EVENT_TYPE);
        expect(registry.manifest().conditionFieldsByEntity.form.map((f) => f.field)).toContain('answers');
    });

    it('accepts a rule bound to it', () => {
        const check = validateRuleV2(rule());
        expect(check.errors).toEqual([]);
        expect(check.value.trigger).toEqual({ type: 'event', event: EVENT_TYPE });
    });

    it('rejects a "changed to" condition, since a submission carries no before/after', () => {
        const check = validateRuleV2(rule({ conditions: { op: 'changedTo', field: 'answers.q1', value: 'Blocking' } }));
        expect(check.valid).toBe(false);
        expect(check.errors.join(' ')).toMatch(/carries no before\/after/);
    });

    it('carries the task the submission filed, so task actions have something to act on', () => {
        const envelope = submission();
        expect(envelope.type).toBe(EVENT_TYPE);
        expect(envelope.entity).toEqual({ kind: 'task', id: TASK_ID, key: 'AHE-9' });
        expect(envelope.scope.projectId).toBe(PROJECT_ID);
        expect(envelope.data.ProjectID).toBe(PROJECT_ID);
        expect(envelope.data.answers).toEqual({ q1: 'Blocking', q2: 'a@b.c' });
    });

    it('falls back to the form as the entity when no task was filed', () => {
        const envelope = submission({ task: null });
        expect(envelope.entity).toEqual({ kind: 'form', id: FORM_ID, key: 'Bug report' });
        expect(envelope.data.taskId).toBeNull();
    });

    it('keys answers by question id', () => {
        expect(answerMap([{ questionId: 'q1', value: ['a', 'b'] }])).toEqual({ q1: ['a', 'b'] });
        expect(answerMap(null)).toEqual({});
    });
});

describe('matching a submission', () => {
    it('fires a rule bound to form.submitted whose conditions hold', async () => {
        MongoDbCrudOpration.mockResolvedValue([rule()]);
        expect(await matcher.match(COMPANY_ID, submission())).toHaveLength(1);
    });

    it('does not fire when the answer condition does not hold', async () => {
        MongoDbCrudOpration.mockResolvedValue([rule()]);
        const other = submission({ answers: [{ questionId: 'q1', label: 'Severity', value: 'Minor' }] });
        expect(await matcher.match(COMPANY_ID, other)).toHaveLength(0);
    });

    it('does not fire for a submission on a different form', async () => {
        MongoDbCrudOpration.mockResolvedValue([rule()]);
        const other = submission({ form: { _id: '507f1f77bcf86cd799439099', title: 'Other', ProjectID: PROJECT_ID } });
        expect(await matcher.match(COMPANY_ID, other)).toHaveLength(0);
    });

    it('does not fire a rule bound to a different trigger', async () => {
        MongoDbCrudOpration.mockResolvedValue([rule({
            trigger: { type: 'event', event: 'task.created' },
            conditions: {},
        })]);
        expect(await matcher.match(COMPANY_ID, submission())).toHaveLength(0);
    });

    it('does not fire a form.submitted rule on a task event', async () => {
        MongoDbCrudOpration.mockResolvedValue([rule({ conditions: {} })]);
        const taskEvent = {
            id: 'evt_2', companyId: COMPANY_ID, type: 'task.created',
            actor: { kind: 'user', userId: 'u1' }, depth: 0,
            scope: { projectId: PROJECT_ID }, entity: { kind: 'task', id: TASK_ID },
            data: { _id: TASK_ID, ProjectID: PROJECT_ID }, previous: null, changedFields: [],
        };
        expect(await matcher.match(COMPANY_ID, taskEvent)).toHaveLength(0);
    });

    it('ignores a submission from a project the rule is not scoped to', async () => {
        MongoDbCrudOpration.mockResolvedValue([rule()]);
        const other = submission({
            form: { _id: FORM_ID, title: 'Bug report', ProjectID: '507f1f77bcf86cd799439033' },
        });
        expect(await matcher.match(COMPANY_ID, other)).toHaveLength(0);
    });
});
