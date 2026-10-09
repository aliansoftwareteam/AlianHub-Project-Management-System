import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/molecules/IntentPreview/IntentPreview.vue', () => ({
    default: { name: 'IntentPreview', props: ['preview', 'disabled'], render() { return h('div', { 'data-test': 'preview' }, this.preview.title); } }
}));
vi.mock('@/components/molecules/AiUnavailable/ConnectAiHint.vue', () => ({ default: { name: 'ConnectAiHint', render: () => h('a', { 'data-test': 'connect-ai-hint' }) } }));

import en from '@/locales/en';
import * as env from '@/config/env';
import { useAskConversation } from '@/views/Ai/useAskConversation';
import AskPlanCard from '@/views/Ai/AskPlanCard.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = (key, values) => i18n.global.t(key, values);

const conversation = () => {
    let api;
    const host = defineComponent({ setup() { api = useAskConversation({ t }); return () => null; } });
    mount(host);
    return api;
};

const planned = (over = {}) => ({
    data: { status: true, data: { configured: true, planned: true, proposalId: 'p1', summary: 'Add a Budget field', changes: [{ title: 'Add fields' }], cannot: [{ text: 'Add an automation', reason: 'not allowed' }], ...over } }
});

beforeEach(() => apiRequest.mockReset());

describe('planning a sentence in the Ask box', () => {
    it('posts the sentence and the chosen project to the plan route, and shows a pending plan', async () => {
        apiRequest.mockResolvedValue(planned());
        const ask = conversation();

        await ask.plan({ sentence: '  Add a Budget field  ', projectId: 'proj1' });

        expect(apiRequest).toHaveBeenCalledWith('post', env.AI_ASK_PLAN, { sentence: 'Add a Budget field', projectId: 'proj1' });
        const [turn] = ask.turns.value;
        expect(turn).toMatchObject({ mode: 'plan', status: 'planned', question: 'Add a Budget field' });
        expect(turn.plan).toMatchObject({ proposalId: 'p1', decision: 'pending', summary: 'Add a Budget field' });
        expect(ask.streaming.value).toBe(false);
    });

    it('makes nothing until approved: planning calls no decision route', async () => {
        apiRequest.mockResolvedValue(planned());
        await conversation().plan({ sentence: 'Add a Budget field' });
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('approves through the proposal decision route, once', async () => {
        const ask = conversation();
        apiRequest.mockResolvedValueOnce(planned());
        await ask.plan({ sentence: 'Add a Budget field' });
        apiRequest.mockResolvedValue({ data: { status: true } });

        const turn = ask.turns.value[0];
        await Promise.all([ask.decidePlan(turn, 'approve'), ask.decidePlan(turn, 'approve')]);

        expect(apiRequest).toHaveBeenLastCalledWith('post', `${env.AGENT_PROPOSALS}/p1/approve`, {});
        expect(apiRequest.mock.calls.filter(([, url]) => String(url).endsWith('/approve'))).toHaveLength(1);
        expect(turn.plan.decision).toBe('approved');
    });

    it('keeps the plan pending and says why when the approval is refused', async () => {
        const ask = conversation();
        apiRequest.mockResolvedValueOnce(planned());
        await ask.plan({ sentence: 'Add a rule' });
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'This proposal needs an Owner or Admin.' } });

        await ask.decidePlan(ask.turns.value[0], 'approve');

        expect(ask.turns.value[0].plan).toMatchObject({ decision: 'pending', error: 'This proposal needs an Owner or Admin.', busy: false });
    });

    it('declines through the same route', async () => {
        const ask = conversation();
        apiRequest.mockResolvedValueOnce(planned());
        await ask.plan({ sentence: 'Add a Budget field' });
        apiRequest.mockResolvedValue({ data: { status: true } });
        await ask.decidePlan(ask.turns.value[0], 'decline');
        expect(apiRequest).toHaveBeenLastCalledWith('post', `${env.AGENT_PROPOSALS}/p1/decline`, {});
        expect(ask.turns.value[0].plan.decision).toBe('declined');
    });

    it.each([
        ['no_key', 'Ask.plan_needs_key', true],
        ['unpriced', 'Ask.plan_unpriced', false],
        ['ai_off', 'Ask.plan_ai_off', false],
        ['nothing_planned', 'Ask.plan_nothing', false]
    ])('says plainly why nothing was planned for %s', async (code, key, needsAi) => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { configured: false, planned: false, code, cannot: [] } } });
        const ask = conversation();
        await ask.plan({ sentence: 'Add a task' });
        expect(ask.turns.value[0]).toMatchObject({ status: 'plan_none', error: t(key), needsAi });
    });

    it('reports a failed request without a plan', async () => {
        apiRequest.mockRejectedValueOnce(new Error('network'));
        const ask = conversation();
        await ask.plan({ sentence: 'Add a task' });
        expect(ask.turns.value[0]).toMatchObject({ status: 'plan_error', error: t('Ask.plan_failed') });
    });
});

describe('the plan card', () => {
    const turn = (status, extra = {}) => ({
        status,
        error: '',
        cannot: [],
        plan: { proposalId: 'p1', summary: 'Add a Budget field', changes: [{ title: 'Add fields' }], cannot: [{ text: 'Add an automation', reason: 'not allowed' }], decision: 'pending', busy: false, error: '' },
        ...extra
    });
    const card = (value) => mount(AskPlanCard, { props: { turn: value }, global: { mocks: { $t: t } } });

    it('shows the summary, one preview per change and what was left out, with Approve and Decline', () => {
        const wrapper = card(turn('planned'));
        expect(wrapper.get('[data-test="ask-plan-summary"]').text()).toBe('Add a Budget field');
        expect(wrapper.findAll('[data-test="preview"]')).toHaveLength(1);
        expect(wrapper.get('[data-test="ask-plan-cannot"]').text()).toContain('Not planned: Add an automation (not allowed)');
        expect(wrapper.find('[data-test="ask-plan-approve"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="ask-plan-decline"]').exists()).toBe(true);
    });

    it('emits the decision and disables both buttons while one is running', async () => {
        const wrapper = card(turn('planned'));
        await wrapper.get('[data-test="ask-plan-approve"]').trigger('click');
        await wrapper.get('[data-test="ask-plan-decline"]').trigger('click');
        expect(wrapper.emitted('decide')).toEqual([['approve'], ['decline']]);

        const busy = card(turn('planned', { plan: { ...turn('planned').plan, busy: true } }));
        expect(busy.get('[data-test="ask-plan-approve"]').attributes('disabled')).toBeDefined();
        expect(busy.get('[data-test="ask-plan-decline"]').attributes('disabled')).toBeDefined();
    });

    it('drops the buttons once decided', () => {
        const wrapper = card(turn('planned', { plan: { ...turn('planned').plan, decision: 'approved' } }));
        expect(wrapper.find('[data-test="ask-plan-approve"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="ask-plan-approved"]').exists()).toBe(true);
    });

    it('offers the person\'s own AI beside the missing-key message', () => {
        const wrapper = card(turn('plan_none', { error: t('Ask.plan_needs_key'), needsAi: true }));
        expect(wrapper.get('[data-test="ask-plan-none"]').text()).toContain('AI key');
        expect(wrapper.find('[data-test="connect-ai-hint"]').exists()).toBe(true);
    });

    it('shows task text as text, never as markup', () => {
        const wrapper = card(turn('planned', { plan: { ...turn('planned').plan, summary: '<img src=x onerror=alert(1)>' } }));
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.get('[data-test="ask-plan-summary"]').text()).toBe('<img src=x onerror=alert(1)>');
    });
});
