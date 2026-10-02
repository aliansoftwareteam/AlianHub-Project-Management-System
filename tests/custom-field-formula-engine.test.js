const F = require('../Modules/CustomField/helpers/formula');

const ok = (expression, scope) => {
    const out = F.evaluateFormula(expression, scope);
    if (!out.ok) throw new Error(`${expression} failed: ${out.code} ${out.error}`);
    return out.value;
};
const fail = (expression, scope) => F.evaluateFormula(expression, scope);

describe('evaluateFormula: arithmetic', () => {
    it('follows the usual order of operations', () => {
        expect(ok('2 + 3 * 4')).toBe(14);
        expect(ok('(2 + 3) * 4')).toBe(20);
        expect(ok('10 - 4 - 3')).toBe(3);
        expect(ok('100 / 5 / 2')).toBe(10);
    });

    it('handles a sign in front of numbers and brackets', () => {
        expect(ok('-5 + 2')).toBe(-3);
        expect(ok('--5')).toBe(5);
        expect(ok('-(2 + 3)')).toBe(-5);
        expect(ok('+4')).toBe(4);
    });

    it('reads decimals including a leading dot', () => {
        expect(ok('.5 + 1.25')).toBe(1.75);
    });

    it('rounds the result to 6 decimals', () => {
        expect(ok('1 / 3')).toBe(0.333333);
        expect(ok('0.1 + 0.2')).toBe(0.3);
    });

    it('reads field references with spaces in the name', () => {
        expect(ok('{story points} * 2', { 'story points': 8 })).toBe(16);
    });

    it('reads numbers given as text, with thousands commas, and booleans', () => {
        expect(ok('{a} + {b} + {c}', { a: '1,250', b: ' 5 ', c: true })).toBe(1256);
    });
});

describe('evaluateFormula: comparisons and IF', () => {
    it.each([
        ['3 > 2', 1], ['2 > 3', 0], ['2 >= 2', 1], ['1 <= 0', 0],
        ['2 = 2', 1], ['2 == 2', 1], ['2 != 2', 0], ['2 <> 3', 1], ['1 < 2', 1],
    ])('%s is %s', (expression, expected) => { expect(ok(expression)).toBe(expected); });

    it('picks a branch with IF', () => {
        expect(ok('IF({done} > 0, {price}, 0)', { done: 1, price: 50 })).toBe(50);
        expect(ok('IF({done} > 0, {price}, 0)', { done: 0, price: 50 })).toBe(0);
    });

    it('does not evaluate the branch it does not take', () => {
        expect(ok('IF(1, 5, 1 / 0)')).toBe(5);
    });

    it('needs exactly three parts in IF', () => {
        expect(fail('IF(1, 2)').code).toBe(F.ERROR.BAD_ARITY);
        expect(fail('IF(1, 2, 3, 4)').code).toBe(F.ERROR.BAD_ARITY);
    });
});

describe('evaluateFormula: functions', () => {
    it('sums, averages, counts, and finds min and max over lists and scalars', () => {
        const scope = { hours: [2, 4, 6], rate: 10 };
        expect(ok('SUM({hours})', scope)).toBe(12);
        expect(ok('AVG({hours})', scope)).toBe(4);
        expect(ok('COUNT({hours})', scope)).toBe(3);
        expect(ok('MIN({hours}, {rate})', scope)).toBe(2);
        expect(ok('MAX({hours}, {rate})', scope)).toBe(10);
    });

    it('is not case sensitive about function names', () => {
        expect(ok('sum(1, 2)')).toBe(3);
    });

    it('rounds to the given places, none by default, and caps places at 10', () => {
        expect(ok('ROUND(2.567, 2)')).toBe(2.57);
        expect(ok('ROUND(2.5)')).toBe(3);
        expect(ok('ROUND(1.23456789012345, 99)')).toBe(1.234568);
    });

    it('does not round negative places below zero', () => {
        expect(ok('ROUND(1234.5, -2)')).toBe(1235);
    });

    it('refuses ROUND with the wrong number of parts', () => {
        expect(fail('ROUND()').code).toBe(F.ERROR.BAD_ARITY);
        expect(fail('ROUND(1, 2, 3)').code).toBe(F.ERROR.BAD_ARITY);
    });

    it('refuses an aggregate with no values', () => {
        expect(fail('SUM()').code).toBe(F.ERROR.BAD_ARITY);
    });

    it('refuses an aggregate over an empty list but counts it as zero', () => {
        expect(fail('MAX({xs})', { xs: [] }).code).toBe(F.ERROR.NOT_A_NUMBER);
        expect(ok('COUNT({xs})', { xs: [] })).toBe(0);
    });

    it('asks for an aggregate when a list is used as a single number', () => {
        expect(fail('{xs} + 1', { xs: [1, 2] }).code).toBe(F.ERROR.NOT_A_NUMBER);
        expect(ok('{xs} + 1', { xs: [4] })).toBe(5);
    });
});

describe('evaluateFormula: errors', () => {
    it('reports an empty formula', () => {
        expect(fail('').code).toBe(F.ERROR.EMPTY);
        expect(fail('   ').code).toBe(F.ERROR.EMPTY);
        expect(fail(undefined).code).toBe(F.ERROR.EMPTY);
    });

    it('reports a formula that is too long', () => {
        expect(fail('1+'.repeat(600)).code).toBe(F.ERROR.TOO_LONG);
    });

    it('reports a formula with too many parts', () => {
        expect(fail(Array(250).fill('1').join('+')).code).toBe(F.ERROR.TOO_COMPLEX);
    });

    it('reports division by zero', () => {
        expect(fail('1 / 0').code).toBe(F.ERROR.DIVIDE_BY_ZERO);
        expect(fail('{a} / ({b} - 2)', { a: 1, b: 2 }).code).toBe(F.ERROR.DIVIDE_BY_ZERO);
    });

    it('reports a field with no value, including blank and null', () => {
        expect(fail('{x}', {}).code).toBe(F.ERROR.UNKNOWN_FIELD);
        expect(fail('{x}', { x: '' }).code).toBe(F.ERROR.UNKNOWN_FIELD);
        expect(fail('{x}', { x: null }).code).toBe(F.ERROR.UNKNOWN_FIELD);
        expect(fail('{x}').code).toBe(F.ERROR.UNKNOWN_FIELD);
    });

    it('does not read inherited properties as fields', () => {
        expect(fail('{toString}', {}).code).toBe(F.ERROR.UNKNOWN_FIELD);
        expect(fail('{constructor}', {}).code).toBe(F.ERROR.UNKNOWN_FIELD);
    });

    it('reports a field that is not a number', () => {
        expect(fail('{x} + 1', { x: 'abc' }).code).toBe(F.ERROR.NOT_A_NUMBER);
        expect(fail('{x} + 1', { x: Infinity }).code).toBe(F.ERROR.NOT_A_NUMBER);
    });

    it('reports characters and words that are not allowed', () => {
        expect(fail('1 ; 2').code).toBe(F.ERROR.UNSUPPORTED);
        expect(fail('process.exit()').code).toBe(F.ERROR.UNKNOWN_FUNCTION);
        expect(fail('constructor("x")').code).toBe(F.ERROR.UNKNOWN_FUNCTION);
    });

    it.each(['1 +', '(1 + 2', '1 2', 'SUM 1', 'SUM(1 2)', 'SUM(1', '1..2', '{', '{}', '{a{b}', ')'])(
        'reports %p as a syntax error',
        (expression) => { expect(fail(expression, { a: 1 }).code).toBe(F.ERROR.SYNTAX); },
    );

    it('never throws, whatever it is given', () => {
        expect(() => F.evaluateFormula({ toString() { throw new Error('boom'); } })).not.toThrow();
        expect(F.evaluateFormula(12345, null)).toEqual({ ok: true, value: 12345 });
    });
});

describe('extractReferences', () => {
    it('lists each field once in the order first used', () => {
        expect(F.extractReferences('{b} + {a} * {b} + SUM({c}, {a})')).toEqual(['b', 'a', 'c']);
    });

    it('returns nothing for a formula without fields and throws on a broken one', () => {
        expect(F.extractReferences('1 + 2')).toEqual([]);
        expect(() => F.extractReferences('1 +')).toThrow();
    });
});

describe('aggregate (rollups)', () => {
    it('sums, averages, counts, mins and maxes', () => {
        const values = [1, '2', ' 3,000 '];
        expect(F.aggregate('sum', values).value).toBe(3003);
        expect(F.aggregate('avg', [2, 4]).value).toBe(3);
        expect(F.aggregate('min', values).value).toBe(1);
        expect(F.aggregate('max', values).value).toBe(3000);
        expect(F.aggregate('count', values).value).toBe(3);
    });

    it('skips values that are not numbers, except in a count', () => {
        expect(F.aggregate('sum', [1, 'abc', null, undefined, 2]).value).toBe(3);
        expect(F.aggregate('count', [1, 'abc', null]).value).toBe(3);
    });

    it('gives 0 for an empty sum, null for other empty aggregates, and 0 for an empty count', () => {
        expect(F.aggregate('sum', []).value).toBe(0);
        expect(F.aggregate('avg', []).value).toBeNull();
        expect(F.aggregate('min', ['x']).value).toBeNull();
        expect(F.aggregate('count', []).value).toBe(0);
    });

    it('sums when the function name is unknown, and copes with a non-list', () => {
        expect(F.aggregate('median', [1, 2]).value).toBe(3);
        expect(F.aggregate('sum', 'nope').value).toBe(0);
        expect(F.aggregate('count', undefined).value).toBe(0);
    });

    it('rounds to 6 decimals', () => {
        expect(F.aggregate('avg', [1, 1, 2]).value).toBe(1.333333);
    });

    it.failing('does not count a blank string as a zero', () => {
        expect(F.aggregate('avg', ['', 4]).value).toBe(4);
    });
});

describe('computeFormulaValues', () => {
    it('evaluates fields that use other formulas in dependency order, whatever the list order', () => {
        const out = F.computeFormulaValues([
            { key: 'total', expression: '{net} + {tax}' },
            { key: 'tax', expression: '{net} * 0.2' },
            { key: 'net', expression: '{hours} * {rate}' },
        ], { hours: 10, rate: 50 });
        expect(out.net.value).toBe(500);
        expect(out.tax.value).toBe(100);
        expect(out.total.value).toBe(600);
    });

    it('reports two formulas that depend on each other as circular', () => {
        const out = F.computeFormulaValues([
            { key: 'a', expression: '{b} + 1' },
            { key: 'b', expression: '{a} + 1' },
        ], {});
        expect(out.a.code).toBe(F.ERROR.CIRCULAR);
        expect(out.b.code).toBe(F.ERROR.CIRCULAR);
    });

    it('reports a formula that refers to itself as circular', () => {
        const out = F.computeFormulaValues([{ key: 'a', expression: '{a} + 1' }], {});
        expect(out.a.code).toBe(F.ERROR.CIRCULAR);
    });

    it('keeps a failing formula from stopping the others', () => {
        const out = F.computeFormulaValues([
            { key: 'bad', expression: '1 +' },
            { key: 'good', expression: '2 * 3' },
        ], {});
        expect(out.bad.ok).toBe(false);
        expect(out.good.value).toBe(6);
    });

    it('leaves a formula that depends on a failed one failing as a missing value', () => {
        const out = F.computeFormulaValues([
            { key: 'bad', expression: '1 / 0' },
            { key: 'next', expression: '{bad} + 1' },
        ], {});
        expect(out.next.code).toBe(F.ERROR.UNKNOWN_FIELD);
    });

    it('ignores entries without a key and a missing list', () => {
        expect(F.computeFormulaValues([null, {}, { expression: '1' }], {})).toEqual({});
        expect(F.computeFormulaValues(undefined)).toEqual({});
    });

    it('does not change the scope it was given', () => {
        const scope = { hours: 2 };
        F.computeFormulaValues([{ key: 'x', expression: '{hours} * 2' }], scope);
        expect(scope).toEqual({ hours: 2 });
    });
});
