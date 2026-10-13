import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({
    default: { name: 'ShellIcon', props: ['name'], template: '<i class="shell-icon" :data-icon="name"></i>' },
}));

import AutomationsPage from '@/views/Automations/AutomationsPage.vue';
import * as env from '@/config/env';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';

const MANIFEST = {
    triggers: [
        { key: 'task.created', label: 'Task is created', entity: 'task', hasDiff: false },
        { key: 'task.priority_changed', label: 'Task priority changes', entity: 'task', hasDiff: true },
    ],
    conditionFields: [
        { field: 'Task_Priority', label: 'Priority', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'], ops: ['eq', 'changedTo'] },
    ],
    actions: [
        { key: 'add_comment', label: 'Add a comment', schema: { body: { type: 'textarea', label: 'Comment', required: true } } },
        { key: 'set_priority', label: 'Change priority', schema: { priority: { type: 'select', label: 'Priority', options: ['LOW', 'MEDIUM', 'HIGH'] } } },
    ],
    operators: {},
};

const DRAFTED_RULE = {
    version: 2,
    trigger: { type: 'event', event: 'task.priority_changed' },
    scope: { allProjects: true, projectIds: [] },
    conditions: { op: 'changedTo', field: 'Task_Priority', value: 'HIGH' },
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'Escalated' } }],
};

const UNPARSED = 'When a task becomes urgent, tell the team';
const PARSED = 'When a task is created, set the priority to HIGH.';

let draftAnswer;

const answer = async (method, url, body) => {
    if (url.endsWith('/registry')) return { data: { status: true, data: MANIFEST } };
    if (url === env.AUTOMATIONS_COMPILE && body && body.sentence === UNPARSED) {
        return { data: { status: true, data: { sentence: UNPARSED, rule: null, errors: ['I do not know the event "a task becomes urgent".'], ambiguities: [], grammar: {} } } };
    }
    if (url === env.AUTOMATIONS_COMPILE && body && body.sentence === PARSED) {
        return { data: { status: true, data: { sentence: PARSED, rule: { ...DRAFTED_RULE, trigger: { type: 'event', event: 'task.created' }, conditions: {}, steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }] }, errors: [], ambiguities: [], grammar: {} } } };
    }
    if (url === env.AUTOMATIONS_COMPILE) return { data: { status: true, data: { sentence: 'When a task priority changes to HIGH, post a comment saying "Escalated".', errors: [] } } };
    if (url === env.AUTOMATIONS_AI_DRAFT) return draftAnswer();
    if (url === env.AUTOMATIONS_V2 && method === 'get') return { data: { status: true, data: [] } };
    if (url === env.AUTOMATIONS_V2 && method === 'post') return { data: { status: true, data: {} } };
    return { data: { status: true, data: [] } };
};

const open = async () => {
    const store = createStore({
        modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } },
    });
    const wrapper = mount(AutomationsPage, { global: { plugins: [store] }, attachTo: document.body });
    await flushPromises();
    await wrapper.find('.ah-toolbar .ah-btn--primary').trigger('click');
    await flushPromises();
    return wrapper;
};

const typeSentence = async (wrapper, text) => {
    const input = wrapper.find('.au__sentence-input');
    await input.setValue(text);
    await input.trigger('keyup.enter');
    await flushPromises();
};

const posts = (url) => apiRequest.mock.calls.filter(([method, u]) => method === 'post' && u === url);

describe('Draft with AI — the fallback when the sentence compiler cannot parse', () => {
    let wrapper;

    beforeEach(() => {
        resetAiAvailability();
        applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: true });
        apiRequest.mockReset();
        draftAnswer = () => ({ data: { status: true, data: { drafted: true, rule: DRAFTED_RULE, sentence: 'When a task priority changes to HIGH, post a comment saying "Escalated".', unmapped: [], rejected: [] } } });
        apiRequest.mockImplementation(answer);
    });

    afterEach(() => { if (wrapper) wrapper.unmount(); wrapper = null; });

    it('offers nothing while the compiler reads the sentence', async () => {
        wrapper = await open();
        await typeSentence(wrapper, PARSED);
        expect(wrapper.find('[data-test="ai-draft"]').exists()).toBe(false);
    });

    it('offers "Draft with AI" once the compiler fails, and only that control carries the AI mark', async () => {
        wrapper = await open();
        await typeSentence(wrapper, UNPARSED);
        const button = wrapper.find('[data-test="ai-draft"]');
        expect(button.exists()).toBe(true);
        expect(button.element.tagName).toBe('BUTTON');
        expect(button.text()).toContain('Automations.ai_draft_button');
        expect(button.find('[data-icon="ai"]').exists()).toBe(true);
    });

    it('fills the normal builder under a review banner and saves nothing until Save', async () => {
        wrapper = await open();
        await typeSentence(wrapper, UNPARSED);
        await wrapper.find('[data-test="ai-draft"]').trigger('click');
        await flushPromises();

        expect(posts(env.AUTOMATIONS_AI_DRAFT)).toHaveLength(1);
        expect(posts(env.AUTOMATIONS_AI_DRAFT)[0][2]).toEqual({ sentence: UNPARSED });

        const banner = wrapper.find('[data-test="ai-draft-banner"]');
        expect(banner.exists()).toBe(true);
        expect(banner.text()).toContain('Automations.ai_draft_banner');
        expect(banner.attributes('role')).toBe('status');

        const selects = wrapper.findAll('.au__compiled select');
        expect(selects[0].element.value).toBe('task.priority_changed');
        expect(wrapper.find('.au__sentence-input').element.value).toContain('Escalated');
        expect(wrapper.find('[data-test="ai-draft"]').exists()).toBe(false);
        expect(posts(env.AUTOMATIONS_V2)).toHaveLength(0);

        await wrapper.find('.au__save .ah-btn--primary').trigger('click');
        await flushPromises();
        expect(posts(env.AUTOMATIONS_V2)).toHaveLength(1);
        expect(posts(env.AUTOMATIONS_V2)[0][2]).toMatchObject({ trigger: { event: 'task.priority_changed' }, steps: DRAFTED_RULE.steps });
    });

    it('keeps the backtest available on the drafted rule', async () => {
        wrapper = await open();
        await typeSentence(wrapper, UNPARSED);
        await wrapper.find('[data-test="ai-draft"]').trigger('click');
        await flushPromises();
        const backtest = wrapper.findAll('.au__save button').find((b) => b.text() === 'Parity.test_30_days');
        expect(backtest).toBeDefined();
        await backtest.trigger('click');
        await flushPromises();
        expect(posts(env.AUTOMATIONS_BACKTEST)[0][2].rule).toMatchObject({ trigger: { event: 'task.priority_changed' } });
    });

    it('says which part could not be mapped and why', async () => {
        draftAnswer = () => ({ data: { status: true, data: { drafted: true, rule: null, sentence: UNPARSED, unmapped: [{ text: 'when a customer emails', reason: 'there is no email trigger yet' }], rejected: [] } } });
        wrapper = await open();
        await typeSentence(wrapper, UNPARSED);
        await wrapper.find('[data-test="ai-draft"]').trigger('click');
        await flushPromises();
        const unmapped = wrapper.findAll('[data-test="ai-unmapped"]');
        expect(unmapped).toHaveLength(1);
        expect(unmapped[0].text()).toContain('Automations.ai_unmapped');
        expect(wrapper.find('[data-test="ai-draft-banner"]').exists()).toBe(false);
    });

    it('shows why a draft was rejected and leaves the builder alone', async () => {
        draftAnswer = () => ({ data: { status: true, data: { drafted: true, rule: null, sentence: UNPARSED, unmapped: [], rejected: ['The draft used an action this workspace does not have: "send_email".'] } } });
        wrapper = await open();
        await typeSentence(wrapper, UNPARSED);
        await wrapper.find('[data-test="ai-draft"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="ai-rejected"]').text()).toContain('send_email');
        expect(wrapper.find('[data-test="ai-draft-banner"]').exists()).toBe(false);
        expect(wrapper.findAll('.au__compiled select')[0].element.value).toBe('task.created');
    });

    it('clears the banner when a later sentence compiles on its own', async () => {
        wrapper = await open();
        await typeSentence(wrapper, UNPARSED);
        await wrapper.find('[data-test="ai-draft"]').trigger('click');
        await flushPromises();
        await typeSentence(wrapper, PARSED);
        expect(wrapper.find('[data-test="ai-draft-banner"]').exists()).toBe(false);
    });

    it('offers no AI draft while AI is off, and says so instead', async () => {
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        wrapper = await open();
        await typeSentence(wrapper, UNPARSED);
        expect(wrapper.find('[data-test="ai-draft"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="ai-draft-off"]').exists()).toBe(true);
        expect(posts(env.AUTOMATIONS_AI_DRAFT)).toHaveLength(0);
    });

    it('shows a clear message when the server answers that AI is off', async () => {
        draftAnswer = () => Promise.reject(Object.assign(new Error('403'), { response: { status: 403, data: { status: false, code: 'ai_off', aiState: 'off_workspace', statusText: 'AI is turned off for this workspace.' } } }));
        wrapper = await open();
        await typeSentence(wrapper, UNPARSED);
        await wrapper.find('[data-test="ai-draft"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="ai-draft-off"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="ai-draft-banner"]').exists()).toBe(false);
    });
});
