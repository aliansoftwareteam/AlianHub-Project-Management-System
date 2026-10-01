import { describe, expect, it } from 'vitest';
import fixture from '../../../tests/fixtures/formLogicCases.json';
import { checkRule, pruneAnswers, visibleIds } from '@formLogic';

const TARGET = 't';

const formFor = (testCase) => {
    const source = fixture.sources[testCase.source];
    const condition = { question: source.id, op: testCase.op };
    if (testCase.value !== undefined) condition.value = testCase.value;
    return [source, { id: TARGET, type: 'short_text', label: 'Target', showWhen: { all: [condition] } }];
};

const answersFor = (testCase) => (testCase.answer === undefined ? {} : { [fixture.sources[testCase.source].id]: testCase.answer });

const titleOf = (testCase) => `${testCase.source} ${testCase.op} ${JSON.stringify(testCase.value)} for ${JSON.stringify(testCase.answer)}`;

const targetIndex = fixture.malformedForm.findIndex((q) => q.id === TARGET);

describe('the form rules the builder shares with the server', () => {
    it.each(fixture.cases.map((testCase) => [titleOf(testCase), testCase]))('%s', (_title, testCase) => {
        expect(visibleIds(formFor(testCase), answersFor(testCase)).includes(TARGET)).toBe(testCase.shown);
    });

    it.each(fixture.forms.map((form) => [form.name, form]))('%s', (_name, form) => {
        expect(visibleIds(form.questions, form.answers)).toEqual(form.shown);
    });

    it.each(fixture.malformed.map((entry) => [entry.name, entry.rule]))('%s is refused and shows the question', (_name, rule) => {
        const questions = fixture.malformedForm.map((q) => (q.id === TARGET ? { ...q, showWhen: rule } : q));

        expect(checkRule(rule, questions, targetIndex).ok).toBe(false);
        expect(visibleIds(questions, { a: 'x', n: '1', d: '2026-10-01', k: 'One' })).toContain(TARGET);
    });

    it('drops the answers of questions that are not shown', () => {
        const { questions } = fixture.forms.find((form) => form.name.startsWith('an answer to a hidden question'));

        expect(pruneAnswers(questions, { a: 'no', b: 'typed', c: 'typed' })).toEqual({ a: 'no' });
    });
});
