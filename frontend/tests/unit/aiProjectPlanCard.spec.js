import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { cardOf } from '@/components/organisms/AiProjectCreator/plan/planCard';
import { chosenParts } from '@/components/molecules/IntentPreview/planPicks';

const plan = {
    project: { ProjectName: 'Maker Shop' },
    sprints: [
        { sprintName: 'Week 1', tasks: [{ TaskName: 'Set up the shop' }, { TaskName: 'Pick a theme' }] },
        { sprintName: 'Week 2', tasks: [{ TaskName: 'Launch' }] },
    ],
    views: [{ name: 'Board', kind: 'board' }],
    rules: [{ name: 'Tell the creator', sentence: 'When a task is done, tell its creator' }],
    locked: ['rules:0'],
    lockedWhy: { 'rules:0': 'owner_admin' },
};

const mountCard = (preview, leftOut = []) => mount(IntentPreview, {
    props: { preview, choosable: true, leftOut },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false })] },
});

describe("the generator's plan card", () => {
    it('reads the plan as the shared card does, with the Guide agent and the locked rule', () => {
        const wrapper = mountCard(cardOf(plan, { withGuide: true }));
        const text = wrapper.text();
        expect(text).toContain('Week 1');
        expect(text).toContain('Set up the shop (list: Week 1)');
        expect(text).toContain('Board: Board');
        expect(text).toContain('When a task is done, tell its creator (starts switched off)');
        expect(text).toContain('Maker Shop Guide, which answers when mentioned on a task');
        expect(wrapper.find('[data-test="intent-pick-locked"]').text()).toBe('An owner or admin approves this part');
    });

    it('has no agent part without a brief, and keeps the locked rule out of what is sent', () => {
        const card = cardOf(plan);
        expect(card.lines.some((line) => line.kind === 'planAgent')).toBe(false);
        expect(chosenParts(card, ['tasks:1'])).toEqual({ lists: [0, 1], tasks: [0, 2], views: [0], rules: [] });
    });
});
