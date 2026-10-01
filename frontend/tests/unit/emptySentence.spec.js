import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));

import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { aiConnection, resetAiConnection } from '@/composable/aiConnection';
import * as env from '@/config/env';
import en from '@/locales/en';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(HERE, '../../src', rel), 'utf8');

const SENTENCE = 'Add five starter tasks to this project.';
const blank = { render: () => null };
const store = () => createStore({ modules: { brandSettingTab: { namespaced: true, getters: { brandSettings: () => ({}) } } } });

const open = async ({ sentence = SENTENCE, ask = true } = {}) => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:cid', name: 'Home', component: blank }, ...(ask ? [{ path: '/:cid/ai/ask', name: 'AiAsk', component: blank }] : [])]
    });
    await router.push({ name: 'Home', params: { cid: 'company-1' } });
    await router.isReady();
    const wrapper = mount(EmptyState, { props: { title: 'No tasks yet', sentence }, global: { plugins: [store(), router] } });
    await flushPromises();
    return { wrapper, router };
};

const say = (wrapper) => wrapper.find('[data-test="empty-say"]');
const connected = () => Object.assign(aiConnection, { loaded: true, companyId: 'company-1', connected: true });
const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ data: { status: true, data: { connected: false } } });
    resetAiAvailability();
    resetAiConnection();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => { resetAiAvailability(); resetAiConnection(); });

describe('the sentence an empty screen offers', () => {
    it('is not shown, and nothing is asked, where the screen names none', async () => {
        applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: true });
        const { wrapper } = await open({ sentence: '' });
        expect(say(wrapper).exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('is not shown while AI is off, and nothing is asked', async () => {
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE, loaded: true });
        connected();
        const { wrapper } = await open();
        expect(say(wrapper).exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('is not shown to a person with no AI to say it to', async () => {
        applyAiAvailability({ state: AI_STATE.UNCONFIGURED, loaded: true });
        const { wrapper } = await open();
        expect(apiRequest).toHaveBeenCalledWith('get', env.AI_CONNECTION);
        expect(say(wrapper).exists()).toBe(false);
    });

    it('with a connected AI it can be copied, to say there', async () => {
        applyAiAvailability({ state: AI_STATE.UNCONFIGURED, loaded: true });
        connected();
        const { wrapper } = await open();
        expect(say(wrapper).find('[data-test="empty-say-sentence"]').text()).toBe(SENTENCE);
        expect(say(wrapper).find('[data-test="empty-say-ask"]').exists()).toBe(false);
        const copy = say(wrapper).find('[data-test="empty-say-copy"]');
        expect(copy.element.tagName).toBe('BUTTON');
        await copy.trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith(SENTENCE);
        expect(copy.text()).toBe('EmptyState.say_copied');
    });

    it('with a server key it opens Ask with the sentence written, for the person to send', async () => {
        applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: true });
        const { wrapper, router } = await open();
        expect(say(wrapper).find('[data-test="empty-say-copy"]').exists()).toBe(false);
        await say(wrapper).find('[data-test="empty-say-ask"]').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('AiAsk');
        expect(router.currentRoute.value.query.q).toBe(SENTENCE);
        expect(apiRequest.mock.calls.every(([type]) => type === 'get')).toBe(true);
    });

    it('a plan without AI gets no Ask button', async () => {
        applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: false });
        connected();
        const { wrapper } = await open();
        expect(say(wrapper).find('[data-test="empty-say-ask"]').exists()).toBe(false);
        expect(say(wrapper).find('[data-test="empty-say-copy"]').exists()).toBe(true);
    });
});

describe('the ten empty screens that offer one', () => {
    const SCREENS = [
        ['components/molecules/Home/MyWorkCard.vue', 'say_today'],
        ['components/molecules/Home/GoalsCard.vue', 'say_goal'],
        ['views/Projects/ListView/ListView.vue', 'emptySentenceKey'],
        ['views/Projects/TableView/TableView.vue', 'emptySentenceKey'],
        ['views/Projects/Kanban/BoardView.vue', 'emptySentenceKey'],
        ['plugins/tasklistDashboard/views/DashBoardList/DashBoardList.vue', 'say_tasks'],
        ['views/Projects/components/FolderEmptyState.vue', 'say_list'],
        ['views/Everything/Everything.vue', 'say_project'],
        ['views/Timesheet/UserTimeSheet/UserTimesheet.vue', 'say_time'],
        ['views/Automations/AutomationsPage.vue', 'say_automation']
    ];

    it.each(SCREENS)('%s', (file, key) => {
        const sentenceProps = read(file).match(/:sentence="[^"]*"/g) || [];
        expect(sentenceProps.some((prop) => prop.includes(key))).toBe(true);
    });

    it('every sentence is in the locale file, and ends as a sentence does', () => {
        const keys = ['say_today', 'say_goal', 'say_tasks', 'say_list', 'say_project', 'say_time', 'say_automation'];
        for (const key of keys) expect(en.EmptyState[key]).toMatch(/\.$/);
    });

    it('a task view offers its sentence only where no task was ever made', async () => {
        const { taskEmptySentenceKey } = await import('@/views/Projects/composables/useTaskEmptyState');
        expect(taskEmptySentenceKey('no_tasks')).toBe('EmptyState.say_tasks');
        for (const kind of ['no_archived', 'no_match', 'no_visible_tasks']) expect(taskEmptySentenceKey(kind)).toBe('');
    });
});
