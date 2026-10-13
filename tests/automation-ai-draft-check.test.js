const { checkDraft, draftSchema, kindOf } = require('../Modules/Automations/helpers/aiDraftCheck');

const APOLLO = '6f0000000000000000000a01';
const ZEUS = '6f0000000000000000000a02';
const ANA_LOPEZ = '6f0000000000000000000b01';
const ANA_SMITH = '6f0000000000000000000b02';
const BO = '6f0000000000000000000b03';

const refs = () => ({
    projects: [
        { id: APOLLO, name: 'Apollo', statuses: ['To Do', 'Review', 'Done'] },
        { id: ZEUS, name: 'Zeus', statuses: ['Backlog', 'Done'] },
    ],
    people: [
        { id: ANA_LOPEZ, name: 'Ana Lopez', email: 'Ana@Example.com' },
        { id: ANA_SMITH, name: 'Ana Smith' },
        { id: BO, name: 'Bo Chen' },
    ],
    taskTypes: ['Bug', 'Story'],
    statusCatalogue: [
        { projectId: APOLLO, key: 1, name: 'To Do', type: 'default_active' },
        { projectId: APOLLO, key: 2, name: 'Review', type: 'active' },
        { projectId: APOLLO, key: 3, name: 'Done', type: 'close' },
    ],
});

const draft = (over = {}) => ({
    trigger: 'task.created',
    conditions: [],
    actions: [{ action: 'set_priority', config: { priority: 'high' } }],
    ...over,
});

describe('kindOf', () => {
    it('reads what a field must be checked against', () => {
        expect(kindOf({ type: 'select', options: ['A'] })).toBe('option');
        expect(kindOf({ type: 'status_picker' })).toBe('status');
        expect(kindOf({ type: 'user_multi' })).toBe('person');
        expect(kindOf({ type: 'project_picker' })).toBe('project');
        expect(kindOf({ type: 'task_type' })).toBe('task_type');
        expect(kindOf({ type: 'boolean' })).toBe('boolean');
        expect(kindOf({ type: 'number' })).toBe('number');
        expect(kindOf({ type: 'textarea' })).toBe('text');
    });

    it('refuses to offer a type it cannot check', () => {
        expect(kindOf({ type: 'date' })).toBeNull();
        expect(kindOf({})).toBeNull();
        expect(kindOf()).toBeNull();
    });
});

describe('draftSchema', () => {
    it('offers the event triggers', () => {
        const keys = draftSchema().triggers.map((t) => t.key);
        expect(keys).toContain('task.created');
        expect(keys).toContain('form.submitted');
    });

    it('only offers actions whose settings can all be checked', () => {
        const { actions } = draftSchema();
        expect(actions.length).toBeGreaterThan(0);
        actions.forEach((a) => Object.values(a.config).forEach((spec) => expect(spec.type).toBeTruthy()));
    });

    it('tells the model which settings are required and which take a list', () => {
        const assign = draftSchema().actions.find((a) => a.key === 'assign');
        expect(assign.config.mode.required).toBe(true);
        expect(assign.config.userIds.list).toBe(true);
        expect(assign.config.userIds.alsoAccepts).toContain('task_creator');
    });
});

describe('checkDraft: shape', () => {
    it.each([null, undefined, 'a rule', 5, []])('rejects %p as not a rule', (input) => {
        expect(checkDraft(input, refs())).toEqual({ rule: null, unmapped: [], rejected: ['The draft was not a rule.'] });
    });

    it('rejects a part the rule format does not have', () => {
        const out = checkDraft(draft({ webhook: 'https://x' }), refs());
        expect(out.rule).toBeNull();
        expect(out.rejected).toEqual(['The draft has a part the rule format does not: "webhook".']);
    });

    it('rejects a draft with no trigger and nothing set aside as unmapped', () => {
        const out = checkDraft({ actions: [] }, refs());
        expect(out.rejected).toContain('The draft does not say what starts the rule.');
    });

    it('rejects an unknown trigger', () => {
        expect(checkDraft(draft({ trigger: 'task.exploded' }), refs()).rejected).toEqual(['There is no "task.exploded" trigger.']);
    });

    it('rejects a draft with no action', () => {
        expect(checkDraft(draft({ actions: [] }), refs()).rejected).toContain('The draft has no action.');
    });

    it('rejects conditions or actions that are not lists', () => {
        const out = checkDraft(draft({ conditions: 'x', actions: {} }), refs());
        expect(out.rejected).toEqual(expect.arrayContaining(["The draft's conditions are not a list.", "The draft's actions are not a list."]));
    });

    it('rejects more than 10 conditions', () => {
        const conditions = Array.from({ length: 11 }, () => ({ field: 'isParentTask', op: 'eq', value: true }));
        expect(checkDraft(draft({ conditions }), refs()).rejected).toContain('A drafted rule may have at most 10 conditions.');
    });

    it('keeps what the model could not map, clipped and capped', () => {
        const unmapped = [
            { text: '  every   Friday ', reason: 'no time triggers' },
            { text: '' },
            'junk',
            ...Array.from({ length: 15 }, (_, i) => ({ text: `t${i}`, reason: 'x'.repeat(500) })),
        ];
        const out = checkDraft(draft({ unmapped }), refs());
        expect(out.unmapped[0]).toEqual({ text: 'every Friday', reason: 'no time triggers' });
        expect(out.unmapped).toHaveLength(10);
        expect(out.unmapped[1].reason).toHaveLength(200);
    });
});

describe('checkDraft: a good rule', () => {
    it('builds a v2 rule for all projects with the option spelled as the engine has it', () => {
        const out = checkDraft(draft(), refs());
        expect(out.rejected).toEqual([]);
        expect(out.rule).toMatchObject({
            version: 2,
            trigger: { type: 'event', event: 'task.created' },
            scope: { allProjects: true, projectIds: [] },
            conditions: {},
            steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }],
        });
    });

    it('scopes the rule to a project named by name or by id, in any letter case', () => {
        expect(checkDraft(draft({ project: 'apollo' }), refs()).rule.scope).toEqual({ allProjects: false, projectIds: [APOLLO] });
        expect(checkDraft(draft({ project: ZEUS }), refs()).rule.scope.projectIds).toEqual([ZEUS]);
    });

    it('joins several conditions with and, and passes a single one alone', () => {
        const one = checkDraft(draft({ conditions: [{ field: 'isParentTask', op: 'eq', value: 'true' }] }), refs());
        expect(one.rule.conditions).toEqual({ op: 'eq', field: 'isParentTask', value: true });
        const two = checkDraft(draft({ conditions: [
            { field: 'isParentTask', op: 'eq', value: true },
            { field: 'TaskName', op: 'contains', value: ' urgent ' },
        ] }), refs());
        expect(two.rule.conditions.op).toBe('and');
        expect(two.rule.conditions.args[1]).toEqual({ op: 'contains', field: 'TaskName', value: 'urgent' });
    });

    it('numbers the steps in order', () => {
        const out = checkDraft(draft({ actions: [
            { action: 'set_priority', config: { priority: 'low' } },
            { action: 'add_comment', config: { body: 'Seen' } },
        ] }), refs());
        expect(out.rule.steps.map((s) => s.id)).toEqual(['s1', 's2']);
    });
});

describe('checkDraft: conditions', () => {
    const withCondition = (condition, scope) => checkDraft(draft({ conditions: [condition], ...scope }), refs());

    it('rejects a condition that is not an object or names an unknown field', () => {
        expect(withCondition('x').rejected).toEqual(['A condition in the draft is not an object.']);
        expect(withCondition({ field: 'Salary', op: 'eq', value: 1 }).rejected[0]).toContain('"Salary"');
    });

    it('rejects an operator the field does not allow', () => {
        expect(withCondition({ field: 'isParentTask', op: 'contains', value: true }).rejected[0]).toContain('cannot be compared with "contains"');
    });

    it('rejects an extra part on a condition', () => {
        expect(withCondition({ field: 'isParentTask', op: 'eq', value: true, extra: 1 }).rejected[0]).toContain('"extra"');
    });

    it('needs no value for empty, notEmpty and changed', () => {
        expect(withCondition({ field: 'Task_Leader', op: 'empty' }).rule.conditions).toEqual({ op: 'empty', field: 'Task_Leader' });
    });

    it('turns a person into their id, by email or by a first name that is unique', () => {
        expect(withCondition({ field: 'Task_Leader', op: 'eq', value: 'ana@example.com' }).rule.conditions.value).toBe(ANA_LOPEZ);
        expect(withCondition({ field: 'Task_Leader', op: 'eq', value: 'Bo' }).rule.conditions.value).toBe(BO);
    });

    it('refuses a first name shared by two people instead of guessing', () => {
        const out = withCondition({ field: 'Task_Leader', op: 'eq', value: 'Ana' });
        expect(out.rule).toBeNull();
        expect(out.rejected[0]).toContain('There is no one called "Ana"');
    });

    it('refuses an id that is not a person the caller can use', () => {
        const out = withCondition({ field: 'Task_Leader', op: 'eq', value: '6f00000000000000000000ff' });
        expect(out.rule).toBeNull();
    });

    it('checks every value of an in list and reports each bad one', () => {
        const ok = withCondition({ field: 'Task_Priority', op: 'in', value: ['low', 'High'] });
        expect(ok.rule.conditions.value).toEqual(['LOW', 'HIGH']);
        const bad = withCondition({ field: 'Task_Priority', op: 'in', value: ['low', 'urgent', 'nope'] });
        expect(bad.rule).toBeNull();
        expect(bad.rejected).toHaveLength(2);
    });

    it('reads a lone value as a one item list for in', () => {
        expect(withCondition({ field: 'taskType', op: 'in', value: 'bug' }).rule.conditions.value).toEqual(['Bug']);
    });

    it('rejects a value that is a list or an object where one value is needed', () => {
        expect(withCondition({ field: 'Task_Priority', op: 'eq', value: ['low'] }).rejected[0]).toContain('needs a single value');
        expect(withCondition({ field: 'Task_Priority', op: 'eq', value: { a: 1 } }).rejected[0]).toContain('needs a single value');
        expect(withCondition({ field: 'Task_Priority', op: 'eq' }).rejected[0]).toContain('needs a single value');
    });

    it('rejects a task type that does not exist and a boolean that is not one', () => {
        expect(withCondition({ field: 'taskType', op: 'eq', value: 'Epic' }).rejected[0]).toContain('no task type called "Epic"');
        expect(withCondition({ field: 'isParentTask', op: 'eq', value: 'maybe' }).rejected[0]).toContain('must be true or false');
    });

    it('rejects empty text', () => {
        expect(withCondition({ field: 'TaskName', op: 'contains', value: '   ' }).rejected[0]).toContain('is empty');
    });

    it('rejects text longer than 2000 characters', () => {
        expect(withCondition({ field: 'TaskName', op: 'contains', value: 'x'.repeat(2001) }).rejected[0]).toContain('longer than 2000');
    });

    it('turns a status name into the project\'s status reference', () => {
        const out = withCondition({ field: 'statusRef', op: 'in', value: 'review' });
        expect(out.rejected).toEqual([]);
        expect(JSON.stringify(out.rule.conditions)).toContain(`${APOLLO}:2`);
    });

    it('refuses a status that needs a name but has none', () => {
        expect(withCondition({ field: 'statusRef', op: 'in', value: [] }).rejected).toEqual(['Status needs a status name.']);
        expect(withCondition({ field: 'statusRef', op: 'in', value: [5] }).rejected).toEqual(['Status needs a status name.']);
    });
});

describe('checkDraft: actions', () => {
    const withAction = (action, scope) => checkDraft(draft({ actions: [action], ...scope }), refs());

    it('rejects an action that is not an object, is unknown, or has an extra part', () => {
        expect(withAction('x').rejected).toEqual(['An action in the draft is not an object.']);
        expect(withAction({ action: 'delete_everything' }).rejected[0]).toContain('"delete_everything"');
        expect(withAction({ action: 'add_comment', config: { body: 'x' }, run: 'now' }).rejected[0]).toContain('"run"');
    });

    it('rejects settings that are not an object, and settings the action does not have', () => {
        expect(withAction({ action: 'add_comment', config: 'hi' }).rejected[0]).toContain('needs its settings as an object');
        expect(withAction({ action: 'add_comment', config: { body: 'x', color: 'red' } }).rejected[0]).toContain('no setting called "color"');
    });

    it('rejects a missing required setting, treating blank as missing', () => {
        expect(withAction({ action: 'add_comment' }).rejected[0]).toContain('needs Comment');
        expect(withAction({ action: 'add_comment', config: { body: '' } }).rejected[0]).toContain('needs Comment');
        expect(withAction({ action: 'add_comment', config: { body: null } }).rejected[0]).toContain('needs Comment');
    });

    it('rejects an option that is not on the list', () => {
        const out = withAction({ action: 'set_priority', config: { priority: 'critical' } });
        expect(out.rejected[0]).toContain('is not one of LOW, MEDIUM, HIGH');
    });

    it('turns people into ids, keeps role words, and removes duplicates', () => {
        const out = withAction({ action: 'notify', config: { recipients: ['bo chen', 'Bo Chen', 'task_creator'], message: 'Hi' } });
        expect(out.rejected).toEqual([]);
        expect(out.rule.steps[0].config.recipients).toEqual([BO, 'task_creator']);
    });

    it('rejects a recipient who is not on the projects the caller can use', () => {
        const out = withAction({ action: 'notify', config: { recipients: ['Mallory'], message: 'Hi' } });
        expect(out.rule).toBeNull();
        expect(out.rejected[0]).toContain('"Mallory"');
    });

    it('accepts one recipient given as text rather than a list', () => {
        const out = withAction({ action: 'notify', config: { recipients: 'Bo Chen', message: 'Hi' } });
        expect(out.rule.steps[0].config.recipients).toEqual([BO]);
    });

    it('limits a status to the scoped project', () => {
        const apollo = withAction({ action: 'set_status', config: { status: 'Review' } }, { project: 'Apollo' });
        expect(apollo.rejected).toEqual([]);
        const zeus = withAction({ action: 'set_status', config: { status: 'Review' } }, { project: 'Zeus' });
        expect(zeus.rule).toBeNull();
        expect(zeus.rejected[0]).toContain('no status called "Review"');
    });

    it('says which project is unknown when the scope names one the caller cannot use', () => {
        const out = checkDraft(draft({ project: 'Atlantis' }), refs());
        expect(out.rule).toBeNull();
        expect(out.rejected).toEqual(['There is no project called "Atlantis" that you can use.']);
        expect(checkDraft(draft({ project: 7 }), refs()).rule).toBeNull();
    });

    it('rejects the whole draft when any one action is bad, so nothing is silently dropped', () => {
        const out = checkDraft(draft({ actions: [
            { action: 'set_priority', config: { priority: 'low' } },
            { action: 'add_comment', config: {} },
        ] }), refs());
        expect(out.rule).toBeNull();
    });
});
