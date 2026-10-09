/* The summary under a goal's progress bar: asked for only by pressing the button, shown with the time it was
   made, marked when the goal has changed since, and absent as a button when no AI provider is configured. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import goals from '@/store/Goals';
import GoalSummary from '@/views/Goals/GoalSummary.vue';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';

const ID = '6f0000000000000000000a01';
const MADE = '2026-10-01T09:30:00.000Z';
const goal = (over = {}) => ({ _id: ID, name: 'Grow revenue', canEdit: true, archived: false, progressPct: 60, targets: [], ...over });
const kept = (stale = false) => ({ text: 'Growth is at 60 percent.', madeAt: MADE, stale });
const answer = (data) => Promise.resolve({ data: { status: true, statusText: 'Summary saved.', data } });
const refused = (status, data) => Promise.reject({ response: { status, data: { status: false, ...data } } });

let wrapper;
const show = async (props, store = createStore({ modules: { goals } })) => {
    wrapper = mount(GoalSummary, { props: { goal: props }, global: { plugins: [store] } });
    await flushPromises();
    return wrapper;
};
const button = () => wrapper.find('[data-test="gsm-ask"]');

const i18n = config.global.plugins[0];

beforeEach(() => {
    i18n.global.setLocaleMessage('en', en);
    config.global.mocks.$t = i18n.global.t;
    apiRequest.mockReset();
    resetAiAvailability();
    applyAiAvailability({ state: AI_STATE.ON, loaded: true });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
});

describe('the Summarise button', () => {
    it('is offered to someone who can edit a goal with no summary, and asks nothing until it is pressed', async () => {
        await show(goal());
        expect(apiRequest).not.toHaveBeenCalled();
        expect(button().text()).toBe('Summarise');

        apiRequest.mockImplementationOnce(() => answer(goal({ summary: kept() })));
        await button().trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls).toEqual([['post', `/api/v2/goals/${ID}/summary`, {}]]);
    });

    it('is not shown when no AI provider is configured, nor when AI is off', async () => {
        applyAiAvailability({ state: AI_STATE.UNCONFIGURED });
        await show(goal());
        expect(button().exists()).toBe(false);
        expect(wrapper.find('[data-test="gsm"]').exists()).toBe(false);

        wrapper.unmount();
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        await show(goal());
        expect(button().exists()).toBe(false);
    });

    it('is not shown to someone who can only read the goal, or on an archived goal', async () => {
        await show(goal({ canEdit: false }));
        expect(button().exists()).toBe(false);
        wrapper.unmount();
        await show(goal({ archived: true }));
        expect(button().exists()).toBe(false);
    });

    it('is held while the summary is being written, so a second press cannot ask again', async () => {
        let finish;
        apiRequest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        await show(goal());
        await button().trigger('click');
        await button().trigger('click');
        expect(button().attributes('disabled')).toBeDefined();
        expect(button().text()).toBe('Summarising…');
        expect(apiRequest).toHaveBeenCalledTimes(1);
        finish({ data: { status: true, data: goal({ summary: kept() }) } });
        await flushPromises();
    });

    it('shows the written summary and the time it was made, with nothing left to press', async () => {
        const store = createStore({ modules: { goals } });
        await show(goal(), store);
        apiRequest.mockImplementationOnce(() => answer(goal({ summary: kept() })));
        await button().trigger('click');
        await flushPromises();
        await wrapper.setProps({ goal: store.getters['goals/goalById'](ID) || goal({ summary: kept() }) });
        expect(wrapper.find('[data-test="gsm-text"]').text()).toBe('Growth is at 60 percent.');
        expect(wrapper.find('[data-test="gsm-meta"]').text()).toMatch(/^From .*2026/);
        expect(button().exists()).toBe(false);
    });
});

describe('a summary that is behind the goal', () => {
    it('keeps its text, says the goal has changed, and offers Regenerate', async () => {
        await show(goal({ summary: kept(true) }));
        expect(wrapper.find('[data-test="gsm-text"]').text()).toBe('Growth is at 60 percent.');
        expect(wrapper.find('[data-test="gsm-stale"]').text()).toBe('The goal has changed since this was written.');
        expect(button().text()).toBe('Regenerate');
    });

    it('is read as it is by someone who cannot edit, with no button', async () => {
        await show(goal({ canEdit: false, summary: kept(true) }));
        expect(wrapper.find('[data-test="gsm-text"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="gsm-stale"]').exists()).toBe(true);
        expect(button().exists()).toBe(false);
    });

    it('is still read when no provider is configured, with no button', async () => {
        applyAiAvailability({ state: AI_STATE.UNCONFIGURED });
        await show(goal({ summary: kept(true) }));
        expect(wrapper.find('[data-test="gsm-text"]').exists()).toBe(true);
        expect(button().exists()).toBe(false);
    });

    it('is not offered again while it is up to date', async () => {
        await show(goal({ summary: kept(false) }));
        expect(wrapper.find('[data-test="gsm-stale"]').exists()).toBe(false);
        expect(button().exists()).toBe(false);
    });
});

describe('a refusal', () => {
    it.each([
        [402, { code: 'ai_budget_exhausted', message: 'ai_budget_exhausted: spent' }, "This workspace's AI budget for the month is spent."],
        [503, { code: 'budget_unavailable', message: 'budget_unavailable: unread' }, "The workspace's AI budget could not be checked, so no summary was made. Try again in a moment."],
        [409, { code: 'ai_unavailable', message: 'off' }, 'AI is not available right now.'],
        [502, { code: 'summary_failed', message: 'vendor down' }, 'The summary could not be written. Try again.']
    ])('%s is said in the page\'s own words and leaves the button to try again', async (status, data, said) => {
        apiRequest.mockImplementationOnce(() => refused(status, data));
        await show(goal());
        await button().trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="gsm-error"]').text()).toBe(said);
        expect(button().attributes('disabled')).toBeUndefined();
    });
});
