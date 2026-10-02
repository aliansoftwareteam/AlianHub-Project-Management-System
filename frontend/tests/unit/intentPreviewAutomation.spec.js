import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { intentTitle } from '@/components/molecules/IntentPreview/intentLines';
import { decideOne } from '@/views/Inbox/approvalQueue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = (key, named) => i18n().global.t(key, named);

let wrapper;
const mountCard = (preview) => {
    wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const rows = () => wrapper.findAll('[data-test="intent-line"]').map((el) => [el.attributes('data-kind'), el.find('dt').text(), el.find('dd').text()]);

afterEach(() => { wrapper?.unmount(); wrapper = null; });

const SENTENCE = 'When a task status changes to done, send "Done notice" to the assignees and set the priority to LOW.';
const rule = (lines) => ({ kind: 'automation', title: SENTENCE, lines: [{ kind: 'place', project: 'Website', list: '' }, ...lines] });

describe('the preview card for an automation an agent wants to add', () => {
    it('says what starts it, the rule, each step, how it starts and what it matches', () => {
        const preview = rule([
            { kind: 'ruleStart', text: 'Task status changes' },
            { kind: 'rule', text: SENTENCE },
            { kind: 'ruleStep', n: 1, text: 'Send "Done notice" to the assignees' },
            { kind: 'ruleStep', n: 2, text: 'Set the priority to LOW' },
            { kind: 'ruleReach' },
            { kind: 'ruleState', on: false },
            { kind: 'ruleRuns', count: 3, days: 30 },
            { kind: 'ruleExamples', tasks: ['WEB-1 Fix the login', 'WEB-2 New footer', 'WEB-3 Launch'] },
        ]);
        mountCard(preview);
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('New automation');
        expect(rows()).toEqual([
            ['place', 'Where', 'Website'],
            ['ruleStart', 'Starts when', 'Task status changes'],
            ['rule', 'Rule', SENTENCE],
            ['ruleStep', 'Step 1', 'Send "Done notice" to the assignees'],
            ['ruleStep', 'Step 2', 'Set the priority to LOW'],
            ['ruleReach', 'Works on', 'Tasks of this project, each time one meets the rule after it is switched on. It does not run on what happened before.'],
            ['ruleState', 'Once approved', 'Saved in your name, switched off until you turn it on'],
            ['ruleRuns', 'Last 30 days', 'Matches 3 tasks you can open'],
            ['ruleExamples', 'For example', 'WEB-1 Fix the login, WEB-2 New footer, WEB-3 Launch'],
        ]);
        expect(intentTitle(t, preview)).toBe(`add the automation “${SENTENCE}”`);
    });

    it('says when it starts switched on, and when it matches one task or none', () => {
        mountCard(rule([{ kind: 'ruleState', on: true }, { kind: 'ruleRuns', count: 1, days: 30 }]));
        expect(rows().slice(1)).toEqual([
            ['ruleState', 'Once approved', 'Saved in your name and switched on straight away'],
            ['ruleRuns', 'Last 30 days', 'Matches 1 task you can open'],
        ]);
        wrapper.unmount();
        mountCard(rule([{ kind: 'ruleRuns', count: 0, days: 30 }, { kind: 'ruleExamples', tasks: [] }]));
        expect(rows().slice(1)).toEqual([['ruleRuns', 'Last 30 days', 'Matches no task you can open']]);
    });

    it('says why a rule cannot be made, and draws every text as text', () => {
        mountCard(rule([{ kind: 'ruleProblem', text: 'There is no status called "<b>Shipped</b>" in the projects you can use.' }, { kind: 'ruleStep', n: 1, text: '' }]));
        expect(rows().slice(1)).toEqual([['ruleProblem', 'Cannot be made', 'There is no status called "<b>Shipped</b>" in the projects you can use.']]);
        expect(wrapper.find('b').exists()).toBe(false);
    });
});

describe('an undo that left something in place', () => {
    const answer = (results) => () => Promise.resolve({ data: { status: true, data: { results } } });

    it('hands back why, in the server\'s words', async () => {
        const out = await decideOne(answer([{ ok: true }, { ok: false, reason: 'the automation "Notice" was changed after it was made, so it stays' }]), 'p1', 'undo', {}, 'failed');
        expect(out).toMatchObject({ ok: true, left: ['the automation "Notice" was changed after it was made, so it stays'] });
    });

    it('hands back nothing when everything was undone', async () => {
        expect((await decideOne(answer([{ ok: true }]), 'p1', 'undo', {}, 'failed')).left).toEqual([]);
        expect((await decideOne(() => Promise.resolve({ data: { status: true, data: {} } }), 'p1', 'approve', {}, 'failed')).left).toEqual([]);
    });
});
