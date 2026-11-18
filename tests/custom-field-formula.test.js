const { evaluateFormula, extractReferences, aggregate, computeFormulaValues, ERROR } = require('../Modules/CustomField/helpers/formula');
const { computeTaskFields, validateFormulaDefinition } = require('../Modules/CustomField/helpers/computeFields');

describe('formula evaluator — arithmetic and precedence', () => {
    test('multiplication binds tighter than addition', () => {
        expect(evaluateFormula('2 + 3 * 4', {})).toEqual({ ok: true, value: 14 });
    });

    test('brackets override precedence', () => {
        expect(evaluateFormula('(2 + 3) * 4', {})).toEqual({ ok: true, value: 20 });
    });

    test('division binds tighter than subtraction and is left-associative', () => {
        expect(evaluateFormula('100 - 60 / 3 / 2', {})).toEqual({ ok: true, value: 90 });
    });

    test('unary minus applies before multiplication', () => {
        expect(evaluateFormula('-2 * 3 + 1', {})).toEqual({ ok: true, value: -5 });
    });

    test('field references are resolved from the scope', () => {
        const result = evaluateFormula('{logged_hours} * {billable_rate}', { logged_hours: 10.18, billable_rate: 140 });
        expect(result.ok).toBe(true);
        expect(result.value).toBeCloseTo(1425.2, 6);
    });

    test('string values that look numeric are coerced', () => {
        expect(evaluateFormula('{estimate} + 1', { estimate: '1,024' })).toEqual({ ok: true, value: 1025 });
    });
});

describe('formula evaluator — functions', () => {
    test('SUM, AVG, MIN, MAX and COUNT flatten list-valued references', () => {
        const scope = { points: [1, 2, 3, 10] };
        expect(evaluateFormula('SUM({points})', scope).value).toBe(16);
        expect(evaluateFormula('AVG({points})', scope).value).toBe(4);
        expect(evaluateFormula('MIN({points})', scope).value).toBe(1);
        expect(evaluateFormula('MAX({points})', scope).value).toBe(10);
        expect(evaluateFormula('COUNT({points})', scope).value).toBe(4);
    });

    test('ROUND takes an optional decimal count', () => {
        expect(evaluateFormula('ROUND(1425.2049, 2)', {})).toEqual({ ok: true, value: 1425.2 });
        expect(evaluateFormula('ROUND(2.5)', {})).toEqual({ ok: true, value: 3 });
    });

    test('IF only evaluates the branch it takes', () => {
        expect(evaluateFormula('IF({billable} > 0, {rate} * 2, 0)', { billable: 1, rate: 21 }).value).toBe(42);
        expect(evaluateFormula('IF(0, 1 / 0, 7)', {})).toEqual({ ok: true, value: 7 });
    });

    test('a function called with the wrong number of arguments is rejected', () => {
        const result = evaluateFormula('IF(1, 2)', {});
        expect(result.ok).toBe(false);
        expect(result.code).toBe(ERROR.BAD_ARITY);
    });
});

describe('formula evaluator — failure modes', () => {
    test('division by zero is refused rather than returning Infinity', () => {
        const result = evaluateFormula('{estimate} / 0', { estimate: 8 });
        expect(result.ok).toBe(false);
        expect(result.code).toBe(ERROR.DIVIDE_BY_ZERO);
        expect(result.error).toMatch(/divides by zero/i);
    });

    test('dividing by a field that happens to be zero is refused too', () => {
        expect(evaluateFormula('{a} / {b}', { a: 5, b: 0 }).code).toBe(ERROR.DIVIDE_BY_ZERO);
    });

    test('a missing field reference names the field it could not find', () => {
        const result = evaluateFormula('{logged_hours} * {billable_rate}', { logged_hours: 4 });
        expect(result.ok).toBe(false);
        expect(result.code).toBe(ERROR.UNKNOWN_FIELD);
        expect(result.error).toContain('{billable_rate}');
    });

    test('an empty field value counts as missing, not as zero', () => {
        expect(evaluateFormula('{rate} + 1', { rate: '' }).code).toBe(ERROR.UNKNOWN_FIELD);
    });

    test('a non-numeric field value is refused', () => {
        expect(evaluateFormula('{status} + 1', { status: 'In progress' }).code).toBe(ERROR.NOT_A_NUMBER);
    });

    test('unbalanced brackets and trailing operators are syntax errors', () => {
        expect(evaluateFormula('(1 + 2', {}).code).toBe(ERROR.SYNTAX);
        expect(evaluateFormula('1 +', {}).code).toBe(ERROR.SYNTAX);
        expect(evaluateFormula('', {}).code).toBe(ERROR.EMPTY);
    });

    test('an over-long expression is refused', () => {
        expect(evaluateFormula(`1 ${'+ 1 '.repeat(400)}`, {}).code).toBe(ERROR.TOO_LONG);
    });
});

describe('formula evaluator — sandbox', () => {
    test('a JavaScript injection attempt never reaches an evaluator', () => {
        const result = evaluateFormula("constructor.constructor('return 1')()", {});
        expect(result.ok).toBe(false);
        expect(result.code).toBe(ERROR.UNKNOWN_FUNCTION);
        expect(result.value).toBeUndefined();
    });

    test.each([
        ['{a}.constructor.constructor("return process")()', ERROR.UNSUPPORTED],
        ['process.exit(1)', ERROR.UNKNOWN_FUNCTION],
        ['require("fs")', ERROR.UNKNOWN_FUNCTION],
        ['this["constructor"]', ERROR.UNKNOWN_FUNCTION],
        ['1; global.leak = 1', ERROR.UNSUPPORTED],
        ['`${1}`', ERROR.UNSUPPORTED]
    ])('rejects %s', (expression, code) => {
        const result = evaluateFormula(expression, { a: 1 });
        expect(result.ok).toBe(false);
        expect(result.code).toBe(code);
    });

    test('a prototype-polluting field name is just a missing reference', () => {
        expect(evaluateFormula('{__proto__} + 1', {}).code).toBe(ERROR.UNKNOWN_FIELD);
        expect(evaluateFormula('{constructor} + 1', {}).code).toBe(ERROR.UNKNOWN_FIELD);
    });

    test('extractReferences reports the fields an expression reads', () => {
        expect(extractReferences('IF({billable} > 0, {logged_hours} * {rate}, 0)')).toEqual(['billable', 'logged_hours', 'rate']);
    });
});

describe('formula dependency resolution', () => {
    test('a formula may read another formula that is resolved first', () => {
        const results = computeFormulaValues(
            [
                { key: 'total', expression: '{subtotal} * 1.2' },
                { key: 'subtotal', expression: '{hours} * {rate}' }
            ],
            { hours: 10, rate: 100 }
        );
        expect(results.subtotal).toEqual({ ok: true, value: 1000 });
        expect(results.total).toEqual({ ok: true, value: 1200 });
    });

    test('two formulas that reference each other are refused as circular', () => {
        const results = computeFormulaValues(
            [
                { key: 'a', expression: '{b} + 1' },
                { key: 'b', expression: '{a} + 1' }
            ],
            {}
        );
        expect(results.a.ok).toBe(false);
        expect(results.a.code).toBe(ERROR.CIRCULAR);
        expect(results.b.ok).toBe(false);
        expect(results.b.code).toBe(ERROR.CIRCULAR);
    });

    test('a self-referencing formula is circular', () => {
        const results = computeFormulaValues([{ key: 'a', expression: '{a} + 1' }], {});
        expect(results.a.code).toBe(ERROR.CIRCULAR);
    });

    test('a longer cycle is caught too', () => {
        const results = computeFormulaValues(
            [
                { key: 'a', expression: '{b}' },
                { key: 'b', expression: '{c}' },
                { key: 'c', expression: '{a}' }
            ],
            {}
        );
        ['a', 'b', 'c'].forEach((key) => expect(results[key].code).toBe(ERROR.CIRCULAR));
    });
});

describe('rollup aggregation', () => {
    test('aggregates numeric values across children', () => {
        expect(aggregate('sum', [1, 2, '3'])).toEqual({ ok: true, value: 6 });
        expect(aggregate('avg', [2, 4])).toEqual({ ok: true, value: 3 });
        expect(aggregate('min', [5, 2])).toEqual({ ok: true, value: 2 });
        expect(aggregate('max', [5, 2])).toEqual({ ok: true, value: 5 });
        expect(aggregate('count', [5, 2, null])).toEqual({ ok: true, value: 3 });
    });

    test('an empty rollup sums to zero and averages to nothing', () => {
        expect(aggregate('sum', [])).toEqual({ ok: true, value: 0 });
        expect(aggregate('avg', [])).toEqual({ ok: true, value: null });
    });
});

describe('computeTaskFields', () => {
    const definitions = [
        { _id: 'f1', fieldTitle: 'Billable rate', fieldType: 'money' },
        { _id: 'f2', fieldTitle: 'Billable value', fieldType: 'formula', formulaExpression: '{logged_hours} * {billable_rate}' },
        { _id: 'f3', fieldTitle: 'Sprint total', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: 'f1' }
    ];

    test('computes a formula from a sibling field and a task built-in', () => {
        const task = { totalEstimatedTime: 12, remainingHours: 2, customField: { f1: { fieldValue: 140 } } };
        const { values, errors } = computeTaskFields({ definitions, task, children: [] });
        expect(values.f2).toBe(1400);
        expect(errors.f2).toBeUndefined();
    });

    test('a rollup sums the source field across children and feeds later formulas', () => {
        const children = [{ customField: { f1: { fieldValue: 100 } } }, { customField: { f1: { fieldValue: 40 } } }];
        const { values } = computeTaskFields({ definitions, task: { customField: {} }, children });
        expect(values.f3).toBe(140);
    });

    test('a formula whose input is missing reports an error instead of a value', () => {
        const { values, errors } = computeTaskFields({ definitions, task: { customField: {} }, children: [] });
        expect(values.f2).toBeNull();
        expect(errors.f2).toContain('{logged_hours}');
    });
});

describe('validateFormulaDefinition', () => {
    const stored = [{ _id: 'a', fieldTitle: 'Alpha', fieldType: 'formula', formulaExpression: '{beta} + 1' }];

    test('refuses a definition that closes a cycle with a stored formula', () => {
        const result = validateFormulaDefinition({ definitions: stored, fieldTitle: 'Beta', expression: '{alpha} + 1' });
        expect(result.valid).toBe(false);
        expect(result.code).toBe(ERROR.CIRCULAR);
    });

    test('accepts a definition that only reads plain fields', () => {
        expect(validateFormulaDefinition({ definitions: stored, fieldTitle: 'Beta', expression: '{estimate} * 2' }).valid).toBe(true);
    });

    test('refuses an expression the parser cannot read', () => {
        expect(validateFormulaDefinition({ definitions: stored, fieldTitle: 'Beta', expression: 'DROP TABLE tasks' }).valid).toBe(false);
    });
});
