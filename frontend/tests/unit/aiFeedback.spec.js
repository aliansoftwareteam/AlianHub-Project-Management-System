import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, h } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiFeedback from '@/components/molecules/AiFeedback/AiFeedback.vue';
import AiResultPreview from '@/components/molecules/AiPreview/AiResultPreview.vue';
import AskAnswer from '@/views/Ai/AskAnswer.vue';
import AiInbox from '@/views/Ai/AiInbox.vue';
import { FEEDBACK_REASONS } from '@/components/molecules/AiFeedback/aiFeedback';

const LinkStub = defineComponent({ name: 'RouterLink', props: { to: { type: [Object, String], required: true } }, setup: (props, { slots }) => () => h('a', { href: '#' }, slots.default && slots.default()) });

const saved = (over = {}) => ({ data: { status: true, data: { id: 'fb1', rating: 'down', reasons: [], note: '', shared: false, ...over } } });

const answerApi = ({ mine = {} } = {}) => apiRequest.mockImplementation((method, url, body) => {
    if (method === 'get' && url.includes('/ai/feedback/mine')) return Promise.resolve({ data: { status: true, data: { items: mine } } });
    if (method === 'put') return Promise.resolve(saved({ rating: body.rating, reasons: body.reasons || [], shared: Boolean(body.includeAnswer) }));
    if (method === 'delete') return Promise.resolve({ data: { status: true, data: { id: 'fb1' } } });
    if (url.includes('/proposals')) return Promise.resolve({ data: { status: true, data: [proposal], counts: { waiting: 1 } } });
    return Promise.resolve({ data: { status: true, data: {} } });
});

const puts = () => apiRequest.mock.calls.filter(([method]) => method === 'put').map(([, , body]) => body);

const proposal = {
    _id: 'pr1', agentName: 'QA', what: 'Move 3 tasks', why: 'The sprint is full', status: 'pending', runId: 'run1',
    changes: [{ label: 'Move T-1', reversible: true }], createdAt: new Date().toISOString()
};

let wrapper = null;
const mountFeedback = async (props = {}) => {
    wrapper = mount(AiFeedback, { props: { feature: 'ask', kind: 'ask_turn', itemId: 'turn-000001', answer: 'The answer body', ...props }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};

beforeEach(() => { apiRequest.mockReset(); answerApi(); });
afterEach(() => { if (wrapper) wrapper.unmount(); wrapper = null; document.body.innerHTML = ''; });

describe('AiFeedback', () => {
    it('offers a thumbs up and a thumbs down, both labelled and unpressed', async () => {
        await mountFeedback();
        const up = wrapper.get('[data-test="feedback-up"]');
        const down = wrapper.get('[data-test="feedback-down"]');
        expect(up.attributes('aria-label')).toBe('AiFeedback.up');
        expect(down.attributes('aria-label')).toBe('AiFeedback.down');
        expect(up.attributes('aria-pressed')).toBe('false');
        expect(down.attributes('aria-pressed')).toBe('false');
    });

    it('saves a thumbs up straight away without the answer text', async () => {
        await mountFeedback();
        await wrapper.get('[data-test="feedback-up"]').trigger('click');
        await flushPromises();
        expect(puts()).toEqual([expect.objectContaining({ feature: 'ask', kind: 'ask_turn', itemId: 'turn-000001', rating: 'up' })]);
        expect(puts()[0].answer).toBeUndefined();
        expect(wrapper.get('[data-test="feedback-up"]').attributes('aria-pressed')).toBe('true');
        expect(wrapper.find('[data-test="feedback-reasons"]').exists()).toBe(false);
    });

    it('asks for reasons after a thumbs down and sends the picked ones, the note and the opted-in answer', async () => {
        await mountFeedback();
        await wrapper.get('[data-test="feedback-down"]').trigger('click');
        await flushPromises();
        expect(puts()[0]).toMatchObject({ rating: 'down' });
        const panel = wrapper.get('[data-test="feedback-reasons"]');
        expect(panel.findAll('[data-reason]').map((chip) => chip.attributes('data-reason'))).toEqual(FEEDBACK_REASONS);
        expect(FEEDBACK_REASONS).toEqual(['wrong', 'missing_sources', 'too_long', 'not_asked', 'other']);

        await panel.get('[data-reason="wrong"]').trigger('click');
        await panel.get('[data-reason="too_long"]').trigger('click');
        expect(panel.get('[data-reason="wrong"]').attributes('aria-pressed')).toBe('true');
        await panel.get('[data-test="feedback-note"]').setValue('cites the wrong project');
        await panel.get('[data-test="feedback-share"]').setValue(true);
        await panel.get('[data-test="feedback-send"]').trigger('click');
        await flushPromises();

        expect(puts()[1]).toMatchObject({ rating: 'down', reasons: ['wrong', 'too_long'], note: 'cites the wrong project', includeAnswer: true, answer: 'The answer body' });
        expect(wrapper.find('[data-test="feedback-reasons"]').exists()).toBe(false);
        expect(wrapper.get('[data-test="feedback-thanks"]').text()).toBe('AiFeedback.thanks');
    });

    it('sends no answer text unless the box is ticked', async () => {
        await mountFeedback();
        await wrapper.get('[data-test="feedback-down"]').trigger('click');
        await flushPromises();
        await wrapper.get('[data-reason="not_asked"]').trigger('click');
        await wrapper.get('[data-test="feedback-send"]').trigger('click');
        await flushPromises();
        expect(puts()[1]).toMatchObject({ reasons: ['not_asked'], includeAnswer: false });
        expect(puts()[1].answer).toBeUndefined();
    });

    it('closes the reasons with Escape and keeps the thumbs down', async () => {
        await mountFeedback();
        await wrapper.get('[data-test="feedback-down"]').trigger('click');
        await flushPromises();
        await wrapper.get('[data-test="feedback-reasons"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('[data-test="feedback-reasons"]').exists()).toBe(false);
        expect(wrapper.get('[data-test="feedback-down"]').attributes('aria-pressed')).toBe('true');
    });

    it('shows the rating already given and clears it when the same thumb is pressed again', async () => {
        answerApi({ mine: { 'turn-000001': { id: 'fb1', rating: 'up', reasons: [], shared: false } } });
        await mountFeedback();
        expect(wrapper.get('[data-test="feedback-up"]').attributes('aria-pressed')).toBe('true');
        await wrapper.get('[data-test="feedback-up"]').trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.some(([method, url]) => method === 'delete' && url.endsWith('/fb1'))).toBe(true);
        expect(wrapper.get('[data-test="feedback-up"]').attributes('aria-pressed')).toBe('false');
    });

    it('hides the share box when there is no answer text to share', async () => {
        await mountFeedback({ answer: '' });
        await wrapper.get('[data-test="feedback-down"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="feedback-share"]').exists()).toBe(false);
    });
});

describe('where the thumbs appear', () => {
    it('sits under a saved Ask answer, rating its turn', async () => {
        const answer = { mode: 'ask', answer: 'Bands are set.', cited: [], sources: [], usage: { model: 'm-1' }, turnId: 'turn-000009' };
        wrapper = mount(AskAnswer, { props: { answer }, global: { stubs: { teleport: true, RouterLink: LinkStub } } });
        await flushPromises();
        const feedback = wrapper.findComponent(AiFeedback);
        expect(feedback.exists()).toBe(true);
        expect(feedback.props()).toMatchObject({ feature: 'ask', kind: 'ask_turn', itemId: 'turn-000009' });
    });

    it('is not offered on an answer that was never saved or is still streaming', async () => {
        const answer = { mode: 'ask', answer: 'Bands', cited: [], sources: [] };
        wrapper = mount(AskAnswer, { props: { answer }, global: { stubs: { teleport: true, RouterLink: LinkStub } } });
        expect(wrapper.findComponent(AiFeedback).exists()).toBe(false);
        wrapper.unmount();
        wrapper = mount(AskAnswer, { props: { answer: { ...answer, turnId: 'turn-1' }, streaming: true }, global: { stubs: { teleport: true, RouterLink: LinkStub } } });
        expect(wrapper.findComponent(AiFeedback).exists()).toBe(false);
    });

    it('sits on an AI preview that names its feature, and not while it is working', async () => {
        wrapper = mount(AiResultPreview, { props: { text: 'Drafted', feedback: { feature: 'page_compose' } } });
        await flushPromises();
        const feedback = wrapper.findComponent(AiFeedback);
        expect(feedback.props()).toMatchObject({ feature: 'page_compose', kind: 'preview', answer: 'Drafted' });
        await wrapper.setProps({ busy: true });
        expect(wrapper.findComponent(AiFeedback).exists()).toBe(false);
        wrapper.unmount();
        wrapper = mount(AiResultPreview, { props: { text: 'Drafted' } });
        expect(wrapper.findComponent(AiFeedback).exists()).toBe(false);
    });

    it('sits on an agent proposal in the AI Inbox', async () => {
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });
        wrapper = mount(AiInbox, { global: { plugins: [store] } });
        await flushPromises();
        await wrapper.find('.ai-item').trigger('click');
        await flushPromises();
        const feedback = wrapper.findComponent(AiFeedback);
        expect(feedback.exists()).toBe(true);
        expect(feedback.props()).toMatchObject({ feature: 'agent_run', kind: 'proposal', itemId: 'pr1' });
    });
});
