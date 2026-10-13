import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import PlanRules from '@/components/organisms/AiProjectCreator/plan/PlanRules.vue';

const mountRules = (props) => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
    return mount(PlanRules, { props, global: { plugins: [i18n], mocks: { $t: (key, params) => i18n.global.t(key, params) } } });
};

describe('PlanRules', () => {
    it('shows each rule as off, with the sentence of what will be made', () => {
        const wrapper = mountRules({ title: 'Automations', rules: [{ name: 'Tell the creator', sentence: 'When a task status changes to done, notify the task creator.' }] });
        expect(wrapper.find('[data-test="plan-rules"]').text()).toContain('Tell the creator');
        expect(wrapper.find('[data-test="plan-rules"]').text()).toContain(en.AiProject.rule_off);
        expect(wrapper.find('[data-test="plan-rule-sentence"]').text()).toBe('When a task status changes to done, notify the task creator.');
    });

    it('words each reason code in plain language, with the maximum the server sent', () => {
        const wrapper = mountRules({
            notesTitle: 'Left out',
            notes: [
                { name: 'Email the client', reason: 'Only these steps can be proposed', code: 'step' },
                { name: 'Fourth', reason: 'x', code: 'too_many', max: 3 },
                { name: 'Odd one', reason: 'x', code: 'unheard_of' },
                { name: '', reason: 'x', code: 'name_missing' },
            ],
        });
        expect(wrapper.findAll('[data-test="plan-rules-notes"] li').map((li) => li.text())).toEqual([
            `Email the client — ${en.AiProject.rule_reason_step}`,
            'Fourth — a plan holds at most 3 automations',
            `Odd one — ${en.AiProject.rule_reason_other}`,
            en.AiProject.rule_reason_name_missing,
        ]);
        expect(wrapper.text()).not.toContain('Only these steps');
    });
});
