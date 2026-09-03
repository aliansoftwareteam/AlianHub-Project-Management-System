const S = require('../Modules/Automations/helpers/sentenceRules');
const { validateRuleV2 } = require('../Modules/Automations/helpers/ruleSchemaV2');

describe('parseSentence — a sentence it understands', () => {
    test('compiles trigger, conditions and actions into a v2 rule', () => {
        const out = S.parseSentence('When a task status changes to Blocked, if the priority is HIGH, post a comment saying "needs help" and set the priority to LOW.');
        expect(out.ok).toBe(true);
        expect(out.errors).toEqual([]);
        expect(out.rule.trigger).toEqual({ type: 'event', event: 'task.status_changed' });
        expect(out.rule.conditions).toEqual({
            op: 'and',
            args: [
                { op: 'changedTo', field: 'statusType', value: 'Blocked' },
                { op: 'eq', field: 'Task_Priority', value: 'HIGH' },
            ],
        });
        expect(out.rule.steps).toEqual([
            { id: 's1', type: 'action', action: 'add_comment', config: { body: 'needs help' } },
            { id: 's2', type: 'action', action: 'set_priority', config: { priority: 'LOW' } },
        ]);
    });

    test('the compiled rule passes the server-side v2 validator', () => {
        const out = S.parseSentence('When a task is created, set the priority to HIGH.', { name: 'Triage' });
        expect(out.ok).toBe(true);
        expect(validateRuleV2(out.rule).valid).toBe(true);
    });

    test('a quoted body may contain the word "and" without splitting the action', () => {
        const out = S.parseSentence('When a task is created, post a comment saying "read the brief and the spec".');
        expect(out.ok).toBe(true);
        expect(out.rule.steps).toHaveLength(1);
        expect(out.rule.steps[0].config.body).toBe('read the brief and the spec');
    });

    test('a rule with no conditions carries an empty condition tree', () => {
        const out = S.parseSentence('When a task is renamed, run the qa-review agent.');
        expect(out.ok).toBe(true);
        expect(out.rule.conditions).toEqual({});
        expect(out.rule.steps[0]).toEqual({ id: 's1', type: 'action', action: 'run_agent', config: { skill: 'qa-review' } });
    });
});

describe('parseSentence — a sentence it cannot parse', () => {
    test('names the unknown event instead of guessing', () => {
        const out = S.parseSentence('When the moon is full, set the priority to HIGH.');
        expect(out.ok).toBe(false);
        expect(out.rule).toBeNull();
        expect(out.errors).toContain('I do not know the event "the moon is full".');
    });

    test('names the unknown action', () => {
        const out = S.parseSentence('When a task is created, delete the project.');
        expect(out.ok).toBe(false);
        expect(out.errors).toContain('I do not know the action "delete the project".');
    });

    test('reports every unreadable slot, not just the first', () => {
        const out = S.parseSentence('When a task is created, if the phase of the moon is waxing, delete the project.');
        expect(out.errors).toHaveLength(2);
    });

    test('rejects a sentence that does not start with When', () => {
        expect(S.parseSentence('Notify me when something breaks.').errors).toEqual(['A rule has to start with "When".']);
    });

    test('rejects a sentence with no break between the event and the action', () => {
        expect(S.parseSentence('When a task is created set the priority to HIGH').errors)
            .toEqual(['Put a comma between what happens and what to do about it.']);
    });
});

describe('parseSentence — an ambiguous sentence', () => {
    test('"marked High" is flagged because High is both a status name and a priority', () => {
        const out = S.parseSentence('When a task is marked High, post a comment saying "check it".');
        expect(out.ok).toBe(true);
        expect(out.ambiguities).toHaveLength(1);
        expect(out.ambiguities[0].at).toBe('trigger');
        expect(out.ambiguities[0].options.map((o) => o.sentence)).toEqual([
            'a task status changes to High',
            'a task priority changes to High',
        ]);
    });

    test('an unambiguous status name raises nothing', () => {
        expect(S.parseSentence('When a task is marked Blocked, post a comment saying "check it".').ambiguities).toEqual([]);
    });

    test('picking either option removes the ambiguity', () => {
        const out = S.parseSentence('When a task is marked High, post a comment saying "check it".');
        const chosen = out.ambiguities[0].options[1].sentence;
        const resolved = S.parseSentence(`When ${chosen}, post a comment saying "check it".`);
        expect(resolved.ambiguities).toEqual([]);
        expect(resolved.rule.trigger.event).toBe('task.priority_changed');
        expect(resolved.rule.conditions).toEqual({ op: 'changedTo', field: 'Task_Priority', value: 'HIGH' });
    });
});

describe('round trip', () => {
    const canonical = [
        'When a task status changes to Blocked, if the priority is HIGH, post a comment saying "needs help".',
        'When a task is created, if it has no assignee, set the priority to LOW and create a subtask called "triage".',
        'When a task priority changes to HIGH, run the qa-review agent.',
        'When a task is renamed, if the title contains "spike", post a comment saying "time-box this".',
        'When a task assignee changes, if it is a parent task, set the status to In progress.',
    ];

    test.each(canonical)('sentence → rule → sentence is a fixed point: %s', (sentence) => {
        const first = S.parseSentence(sentence);
        expect(first.ok).toBe(true);
        expect(S.describeRule(first.rule)).toBe(sentence);
    });

    test('a non-canonical phrasing normalises to the canonical sentence and stays stable', () => {
        const out = S.parseSentence('When a task is moved to Blocked, then set the priority to HIGH');
        expect(out.ok).toBe(true);
        const canonicalSentence = S.describeRule(out.rule);
        expect(canonicalSentence).toBe('When a task status changes to Blocked, set the priority to HIGH.');
        expect(S.describeRule(S.parseSentence(canonicalSentence).rule)).toBe(canonicalSentence);
    });

    test('rule → sentence works on a rule that was never a sentence', () => {
        const rule = {
            trigger: { type: 'event', event: 'task.created' },
            conditions: { op: 'empty', field: 'AssigneeUserId' },
            steps: [{ id: 's1', type: 'action', action: 'set_status', config: { status: 'To do' } }],
        };
        expect(S.describeRule(rule)).toBe('When a task is created, if it has no assignee, set the status to To do.');
    });
});

describe('grammar', () => {
    test('every phrase the help text offers is one the parser accepts', () => {
        const g = S.grammar();
        g.triggers.forEach((phrase) => {
            const out = S.parseSentence(`When ${phrase}, post a comment saying "x".`);
            expect(out.errors).toEqual([]);
        });
    });
});
