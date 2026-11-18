const { evaluate, validate, readField, usesChangeOps } = require('../Modules/Automations/engine/expression');
const { render, placeholdersIn } = require('../Modules/Automations/engine/template');

const ctx = {
    task: { statusType: 'close', Task_Priority: 'HIGH', TaskName: 'Fix the bus', AssigneeUserId: ['u1', 'u2'], taskType: 'story', subTasks: 3 },
    previous: { statusType: 'inprogress', Task_Priority: 'LOW' },
    actor: { kind: 'user', userId: 'u9' },
    scope: { projectId: 'p1' },
    entity: { kind: 'task', id: 't1', key: 'AHE-1' },
    changedFields: ['statusType', 'Task_Priority'],
    steps: { s1: { verdict: 'fail', summary: 'two defects' } },
};

describe('automation expression evaluator', () => {
    describe('security — the reason this is an AST and not a string', () => {
        it('cannot reach the prototype chain', () => {
            expect(readField('__proto__', ctx)).toBeUndefined();
            expect(readField('constructor', ctx)).toBeUndefined();
            expect(readField('task.__proto__.polluted', ctx)).toBeUndefined();
        });

        it('rejects unknown operators instead of ignoring them', () => {
            expect(validate({ op: 'exec', field: 'x', value: 1 })).toEqual(
                ['conditions.op: unknown operator "exec"']);
            expect(evaluate({ op: 'exec', field: 'statusType', value: 'close' }, ctx)).toBe(false);
        });

        it('contains no dynamic code execution', () => {
            // Strip comments first — the file explains *why* it avoids eval(), and
            // prose about the hazard must not read as the hazard.
            const code = require('fs')
                .readFileSync(require.resolve('../Modules/Automations/engine/expression'), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*$/gm, '');
            expect(code).not.toMatch(/\beval\s*\(/);
            expect(code).not.toMatch(/new\s+Function\s*\(/);
            expect(code).not.toMatch(/require\(['"]vm['"]\)/);
            expect(code).toContain('evaluateNode'); // sanity: we stripped comments, not the code
        });

        it('stops runaway nesting rather than blowing the stack', () => {
            let node = { op: 'eq', field: 'statusType', value: 'close' };
            for (let i = 0; i < 50; i++) node = { op: 'and', args: [node] };
            expect(() => evaluate(node, ctx)).not.toThrow();
            expect(evaluate(node, ctx)).toBe(false); // depth-capped → no match
        });
    });

    describe('field resolution', () => {
        it('treats a bare field as a task field — what rule authors actually write', () => {
            expect(readField('statusType', ctx)).toBe('close');
            expect(readField('task.statusType', ctx)).toBe('close');
        });

        it('reads a previous step output via $sN', () => {
            expect(readField('$s1.verdict', ctx)).toBe('fail');
            expect(readField('$s1.missing', ctx)).toBeUndefined();
        });
    });

    describe('operators', () => {
        it('eq / neq / in / notIn compare as strings so ObjectIds and strings match', () => {
            expect(evaluate({ op: 'eq', field: 'statusType', value: 'close' }, ctx)).toBe(true);
            expect(evaluate({ op: 'neq', field: 'statusType', value: 'open' }, ctx)).toBe(true);
            expect(evaluate({ op: 'in', field: 'Task_Priority', value: ['HIGH', 'MEDIUM'] }, ctx)).toBe(true);
            expect(evaluate({ op: 'notIn', field: 'Task_Priority', value: ['LOW'] }, ctx)).toBe(true);
        });

        it('contains works on arrays and on text', () => {
            expect(evaluate({ op: 'contains', field: 'AssigneeUserId', value: 'u2' }, ctx)).toBe(true);
            expect(evaluate({ op: 'contains', field: 'TaskName', value: 'bus' }, ctx)).toBe(true);
        });

        it('empty / notEmpty treat [] and "" as empty', () => {
            expect(evaluate({ op: 'notEmpty', field: 'AssigneeUserId' }, ctx)).toBe(true);
            expect(evaluate({ op: 'empty', field: 'AssigneeUserId' }, { task: { AssigneeUserId: [] } })).toBe(true);
            expect(evaluate({ op: 'empty', field: 'nope' }, ctx)).toBe(true);
        });

        it('numeric comparisons', () => {
            expect(evaluate({ op: 'gt', field: 'subTasks', value: 2 }, ctx)).toBe(true);
            expect(evaluate({ op: 'lte', field: 'subTasks', value: 3 }, ctx)).toBe(true);
        });
    });

    describe('change operators — "changed TO" vs "IS"', () => {
        it('changedTo fires only when the field is in changedFields', () => {
            expect(evaluate({ op: 'changedTo', field: 'statusType', value: 'close' }, ctx)).toBe(true);
        });

        it('does NOT fire when the value matches but nothing changed — the every-save bug', () => {
            const unchanged = { ...ctx, changedFields: ['TaskName'] };
            expect(evaluate({ op: 'changedTo', field: 'statusType', value: 'close' }, unchanged)).toBe(false);
            expect(evaluate({ op: 'eq', field: 'statusType', value: 'close' }, unchanged)).toBe(true);
        });

        it('changedFrom reads the previous snapshot', () => {
            expect(evaluate({ op: 'changedFrom', field: 'statusType', value: 'inprogress' }, ctx)).toBe(true);
            expect(evaluate({ op: 'changedFrom', field: 'statusType', value: 'close' }, ctx)).toBe(false);
        });

        it('usesChangeOps reports the dependency so a bad trigger pairing is caught at save time', () => {
            expect(usesChangeOps({ op: 'and', args: [{ op: 'changedTo', field: 'statusType', value: 'x' }] })).toBe(true);
            expect(usesChangeOps({ op: 'eq', field: 'statusType', value: 'x' })).toBe(false);
        });
    });

    describe('logical composition', () => {
        it('and / or / not', () => {
            expect(evaluate({ op: 'and', args: [
                { op: 'changedTo', field: 'statusType', value: 'close' },
                { op: 'eq', field: 'taskType', value: 'story' },
                { op: 'notEmpty', field: 'AssigneeUserId' },
            ] }, ctx)).toBe(true);
            expect(evaluate({ op: 'or', args: [{ op: 'eq', field: 'taskType', value: 'bug' }, { op: 'eq', field: 'taskType', value: 'story' }] }, ctx)).toBe(true);
            expect(evaluate({ op: 'not', args: [{ op: 'eq', field: 'taskType', value: 'bug' }] }, ctx)).toBe(true);
        });

        it('no conditions matches everything', () => {
            expect(evaluate(null, ctx)).toBe(true);
            expect(evaluate({}, ctx)).toBe(true);
        });
    });

    describe('validate', () => {
        it('reports field-level errors, not one opaque failure', () => {
            const errs = validate({ op: 'and', args: [{ op: 'eq' }, { op: 'nope', field: 'a', value: 1 }] });
            expect(errs).toContain('conditions.args[0].field: required for "eq"');
            expect(errs).toContain('conditions.args[0].value: required for "eq"');
            expect(errs).toContain('conditions.args[1].op: unknown operator "nope"');
        });

        it('does not demand a value for the unary operators', () => {
            expect(validate({ op: 'notEmpty', field: 'AssigneeUserId' })).toEqual([]);
            expect(validate({ op: 'changed', field: 'statusType' })).toEqual([]);
        });
    });
});

describe('automation templates', () => {
    it('renders whitelisted paths', () => {
        expect(render('QA on {{task.TaskName}} → {{ $s1.verdict }}', ctx))
            .toBe('QA on Fix the bus → fail');
    });

    it('renders an unreachable path as empty, never as the literal placeholder', () => {
        expect(render('x{{task.__proto__.y}}z', ctx)).toBe('xz');
        expect(render('x{{nope.deep}}z', ctx)).toBe('xz');
    });

    it('joins arrays readably', () => {
        expect(render('{{task.AssigneeUserId}}', ctx)).toBe('u1, u2');
    });

    it('walks nested config and refuses prototype-polluting keys', () => {
        const out = render({ body: 'Now {{task.statusType}}', nested: { list: ['{{task.TaskName}}'] }, __proto__: { bad: 1 } }, ctx);
        expect(out.body).toBe('Now close');
        expect(out.nested.list[0]).toBe('Fix the bus');
        expect({}.bad).toBeUndefined();
    });

    it('reports the placeholders a config depends on', () => {
        expect([...placeholdersIn({ a: '{{task.TaskName}}', b: ['{{ $s1.verdict }}'] })].sort())
            .toEqual(['$s1.verdict', 'task.TaskName']);
    });
});
