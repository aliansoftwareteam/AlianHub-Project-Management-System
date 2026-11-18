const fs = require('fs');
const fixture = require('./fixtures/formLogicCases.json');
const { TYPES } = require('../Modules/Forms/helpers/questionTypes');
const logic = require('../Modules/Forms/helpers/formLogic');

const TARGET = 't';
const NO_ANSWER_TYPES = ['files', 'info_block'];

const formFor = (testCase) => {
    const source = fixture.sources[testCase.source];
    const condition = { question: source.id, op: testCase.op };
    if (testCase.value !== undefined) condition.value = testCase.value;
    return [source, { id: TARGET, type: 'short_text', label: 'Target', showWhen: { all: [condition] } }];
};

const answersFor = (testCase) => (testCase.answer === undefined ? {} : { [fixture.sources[testCase.source].id]: testCase.answer });

const titleOf = (testCase) => `${testCase.source} ${testCase.op} ${JSON.stringify(testCase.value)} for ${JSON.stringify(testCase.answer)}`;

const withRuleOnTarget = (rule) => fixture.malformedForm.map((q) => (q.id === TARGET ? { ...q, showWhen: rule } : q));
const targetIndex = fixture.malformedForm.findIndex((q) => q.id === TARGET);

describe('which questions a form shows for a set of answers', () => {
    it.each(fixture.cases.map((testCase) => [titleOf(testCase), testCase]))('%s', (_title, testCase) => {
        const questions = formFor(testCase);

        expect(logic.checkRule(questions[1].showWhen, questions, 1).ok).toBe(true);
        expect(logic.visibleIds(questions, answersFor(testCase)).includes(TARGET)).toBe(testCase.shown);
    });

    it.each(fixture.forms.map((form) => [form.name, form]))('%s', (_name, form) => {
        expect(logic.visibleIds(form.questions, form.answers)).toEqual(form.shown);
    });

    it('offers each question type only the operators its answers can be compared with', () => {
        for (const type of Object.keys(TYPES)) {
            const offered = logic.operatorsFor(type);
            expect(offered.every((op) => logic.OPERATORS.includes(op))).toBe(true);
            expect(offered.length > 0).toBe(!NO_ANSWER_TYPES.includes(type));
        }
        expect(logic.operatorsFor('short_text')).toEqual(['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty']);
        expect(logic.operatorsFor('number')).toEqual(['equals', 'not_equals', 'greater_than', 'less_than', 'is_empty', 'is_not_empty']);
        expect(logic.operatorsFor('date')).toEqual(logic.operatorsFor('number'));
        expect(logic.operatorsFor('dropdown')).toEqual(['equals', 'not_equals', 'one_of', 'is_empty', 'is_not_empty']);
        expect(logic.operatorsFor('labels')).toEqual(['contains', 'one_of', 'is_empty', 'is_not_empty']);
        expect(logic.operatorsFor('no_such_type')).toEqual([]);
    });
});

describe('a rule the form cannot read', () => {
    it.each(fixture.malformed.map((entry) => [entry.name, entry.rule]))('%s is refused, and shows the question rather than hiding it', (_name, rule) => {
        const questions = withRuleOnTarget(rule);

        expect(logic.checkRule(rule, questions, targetIndex).ok).toBe(false);
        expect(logic.visibleIds(questions, { a: 'x', n: '1', d: '2026-10-01', k: 'One' })).toContain(TARGET);
    });

    it('names what is wrong, so the builder can tell a stale rule from a broken one', () => {
        const code = (rule) => logic.checkRule(rule, fixture.malformedForm, targetIndex).code;

        expect(code({ all: [{ question: 'nowhere', op: 'is_empty' }] })).toBe('question_missing');
        expect(code({ all: [{ question: 'h', op: 'is_empty' }] })).toBe('question_missing');
        expect(code({ all: [{ question: 'z', op: 'is_empty' }] })).toBe('question_later');
        expect(code({ all: [{ question: 't', op: 'is_empty' }] })).toBe('question_later');
        expect(code({ all: [{ question: 'k', op: 'equals', value: 'o9' }] })).toBe('option_missing');
        expect(code({ all: [{ question: 'n', op: 'contains', value: '1' }] })).toBe('operator');
        expect(code({ all: [{ question: 'n', op: 'equals', value: '1' }] })).toBe('value');
        expect(code('a === 1')).toBe('shape');
        expect(code(fixture.malformed.find((entry) => entry.name === 'eleven conditions').rule)).toBe('too_many');
        expect(code(fixture.malformed.find((entry) => entry.name === 'three levels of groups').rule)).toBe('too_deep');
    });

    it('keeps only the keys it knows when it accepts a rule', () => {
        const checked = logic.checkRule({
            any: [
                { question: 'a', op: 'equals', value: '  Acme  ' },
                { all: [{ question: 'k', op: 'one_of', value: ['o2', 'o1', 'o2'] }, { question: 'n', op: 'is_empty' }] },
            ],
        }, fixture.malformedForm, targetIndex);

        expect(checked).toEqual({
            ok: true,
            rule: {
                any: [
                    { question: 'a', op: 'equals', value: 'Acme' },
                    { all: [{ question: 'k', op: 'one_of', value: ['o2', 'o1'] }, { question: 'n', op: 'is_empty' }] },
                ],
            },
        });
        expect(logic.checkRule({ all: [] }, fixture.malformedForm, targetIndex)).toEqual({ ok: true, rule: null });
        expect(logic.checkRule(null, fixture.malformedForm, targetIndex)).toEqual({ ok: true, rule: null });
    });

    it('allows ten conditions and two levels', () => {
        const ten = { any: Array.from({ length: 5 }, (_, i) => ({ all: [{ question: 'a', op: 'equals', value: `v${i}` }, { question: 'n', op: 'equals', value: i }] })) };

        expect(logic.MAX_CONDITIONS).toBe(10);
        expect(logic.MAX_DEPTH).toBe(2);
        expect(logic.checkRule(ten, fixture.malformedForm, targetIndex).ok).toBe(true);
    });
});

describe('answers the evaluator is handed', () => {
    const questions = fixture.forms.find((form) => form.name.startsWith('an answer to a hidden question')).questions;

    it.each([[undefined], [null], ['a=yes'], [['yes']], [42]])('reads %j as no answers at all', (answers) => {
        expect(logic.visibleIds(questions, answers)).toEqual(['a']);
    });

    it.each([[undefined], [null], ['questions'], [{}], [[null, 'q', 7, { type: 'short_text' }]]])('reads %j as a form with nothing to show', (list) => {
        expect(logic.visibleIds(list, {})).toEqual([]);
    });

    it('does not read an answer off the prototype', () => {
        const form = [
            { id: 'constructor', type: 'short_text', label: 'A' },
            { id: '__proto__', type: 'short_text', label: 'B' },
            { id: TARGET, type: 'short_text', label: 'T', showWhen: { all: [{ question: 'constructor', op: 'is_empty' }, { question: '__proto__', op: 'is_empty' }] } },
        ];

        expect(logic.visibleIds(form, {})).toContain(TARGET);
    });

    it('drops the answers of questions that are not shown', () => {
        const answers = { a: 'no', b: 'typed before it was hidden', c: 'also typed', stray: 'x' };

        expect(logic.pruneAnswers(questions, answers)).toEqual({ a: 'no' });
        expect(logic.pruneAnswers(questions, { ...answers, a: 'yes' })).toEqual({ a: 'yes', b: 'typed before it was hidden', c: 'also typed' });
        expect(answers.b).toBe('typed before it was hidden');
    });

    it('requires nothing and builds no code from a rule, so the web app can bundle it under its script policy', () => {
        const source = fs.readFileSync(require.resolve('../Modules/Forms/helpers/formLogic'), 'utf8');

        expect(source).not.toMatch(/\brequire\(|\bimport\b/);
        expect(source).not.toMatch(/\beval\(|new Function|new RegExp|RegExp\(/);
    });

    it('says whether a form has any rule', () => {
        expect(logic.hasRules(questions)).toBe(true);
        expect(logic.hasRules(fixture.malformedForm)).toBe(false);
        expect(logic.hasRules(undefined)).toBe(false);
    });
});
