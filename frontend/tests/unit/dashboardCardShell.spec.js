import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { h } from 'vue';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));

import BurndownCard from '@/components/organisms/BurndownCard/BurndownCard.vue';
import VelocityCard from '@/components/organisms/VelocityCard/VelocityCard.vue';
import { forgetAskAnswers } from '@/components/organisms/AskAQuestionCard/askCardCache';
import { BUILT_CARDS } from '@/plugins/dashboard/cardCatalog';
import { cardComponent } from '@/plugins/dashboard/cardRegistry';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { ApexChart, CATALOG_EMPTY_TEXT, clickRefresh, clickRetry, mountInShell, settle } from '../cardInShell';

enableAutoUnmount(afterEach);

const store = () => createStore({
    modules: {
        settings: {
            namespaced: true,
            getters: {
                teams: () => [],
                companyUsers: () => [{ userId: 'user-2', isDelete: false, roleType: 3 }],
            },
        },
    },
});

const ok = (data) => ({ data: { status: true, data } });
const deferred = () => {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
};

const inShell = (body, cardData = {}) => mountInShell(body, { props: { cardData }, global: { plugins: [store()] } });

const sprints = (n) => Array.from({ length: n }, (_, i) => ({ sprintId: `s${i}`, name: `Sprint ${i}`, committed: 10, completed: 8 + i }));
const burndown = () => ok({ sprintName: 'Sprint 4', totalPoints: 12, days: [
    { date: '2026-09-01', remainingPoints: 12, idealPoints: 12 },
    { date: '2026-09-02', remainingPoints: 7, idealPoints: 6 },
] });

describe('a card body inside the real card shell', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('mounts the body at once, which asks for its data once while the shell shows the skeleton', async () => {
        const answer = deferred();
        apiRequest.mockReturnValue(answer.promise);
        const { wrapper, shown } = inShell(VelocityCard, { projectId: 'p1', sprintCount: 4 });
        await flushPromises();

        expect(wrapper.findComponent(VelocityCard).exists()).toBe(true);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/agile/velocity?projectId=p1&limit=4');
        expect(shown.state).toBe('loading');
        expect(shown.bodyHidden).toBe(true);

        answer.resolve(ok({ sprints: sprints(4), skipped: 0 }));
        await flushPromises();

        expect(shown.state).toBe('ready');
        expect(wrapper.findAll('[data-test="velocity-sprint"]')).toHaveLength(4);
        expect(shown.note).toContain('Reports.last_n_sprints');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('shows the empty state for an empty answer, with the body still mounted under it', async () => {
        apiRequest.mockResolvedValue(ok({ sprints: [] }));
        const { wrapper, shown } = inShell(VelocityCard, { projectId: 'p1' });
        await flushPromises();

        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('Dash.velocity_no_sprints');
        expect(shown.bodyHidden).toBe(true);
        expect(wrapper.findComponent(VelocityCard).exists()).toBe(true);
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('falls back to the catalogue\'s empty text when the body names none', async () => {
        apiRequest.mockResolvedValue(ok({ tasks: [] }));
        const { shown } = inShell(cardComponent('DueSoonCard'));
        await settle();

        expect(shown.emptyText).toBe(CATALOG_EMPTY_TEXT);
    });

    it('shows the error state, and its retry asks once more and recovers', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        const { wrapper, shown } = inShell(VelocityCard, { projectId: 'p1' });
        await flushPromises();

        expect(shown.state).toBe('error');
        expect(shown.error).toBe('Dash.card_error');
        expect(shown.bodyHidden).toBe(true);
        expect(apiRequest).toHaveBeenCalledTimes(1);

        apiRequest.mockResolvedValue(ok({ sprints: sprints(3) }));
        await clickRetry(wrapper);
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(shown.state).toBe('ready');
        expect(wrapper.findAll('[data-test="velocity-sprint"]')).toHaveLength(3);
    });

    it('asks again once for a refresh and once for a settings change', async () => {
        apiRequest.mockResolvedValue(ok({ sprints: sprints(2) }));
        const { wrapper } = inShell(VelocityCard, { projectId: 'p1' });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(1);

        await clickRefresh(wrapper);
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);

        await wrapper.setProps({ cardData: { projectId: 'p2' } });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(3);
        expect(apiRequest).toHaveBeenLastCalledWith('get', '/api/v1/agile/velocity?projectId=p2&limit=6');

        await wrapper.setProps({ cardData: { projectId: 'p2', fieldName: 'Renamed' } });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(3);
    });

    it('keeps the body mounted when the grid forces a state', async () => {
        apiRequest.mockResolvedValue(ok({ sprints: sprints(2) }));
        const { wrapper, shown, setShell } = inShell(VelocityCard, { projectId: 'p1' });
        await flushPromises();
        const body = wrapper.findComponent(VelocityCard).vm;

        setShell({ state: 'loading' });
        await flushPromises();
        expect(shown.state).toBe('loading');
        setShell({ state: 'ready' });
        await flushPromises();

        expect(shown.state).toBe('ready');
        expect(wrapper.findComponent(VelocityCard).vm).toBe(body);
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });
});

describe('a body that never reports', () => {
    const Silent = { name: 'SilentBody', props: ['refreshTrigger'], render: () => h('p', 'silent') };

    beforeEach(() => {
        apiRequest.mockReset();
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('is shown as loading, then as an error with a retry, instead of a skeleton for ever', async () => {
        const { wrapper, shown } = inShell(Silent);
        await flushPromises();
        expect(shown.state).toBe('loading');

        await vi.advanceTimersByTimeAsync(60000);
        expect(shown.state).toBe('error');
        expect(shown.error).toBe('Dash.card_error');

        await clickRetry(wrapper);
        expect(wrapper.findComponent(Silent).props('refreshTrigger')).toBe(1);
        expect(shown.state).toBe('loading');

        await vi.advanceTimersByTimeAsync(60000);
        expect(shown.state).toBe('error');
    });

    it('does not time out a body that said it is loading', async () => {
        apiRequest.mockReturnValue(deferred().promise);
        const { shown } = inShell(VelocityCard, { projectId: 'p1' });
        await flushPromises();

        await vi.advanceTimersByTimeAsync(60000);
        expect(shown.state).toBe('loading');
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });
});

describe('Burndown inside the real card shell', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('asks once for a load, stays mounted through it, and asks nothing more when the state changes', async () => {
        const answer = deferred();
        apiRequest.mockReturnValue(answer.promise);
        const { wrapper, shown, setShell } = inShell(BurndownCard, { projectId: 'p1', sprintId: 's1' });
        await flushPromises();

        const body = wrapper.findComponent(BurndownCard).vm;
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/agile/burndown?sprintId=s1');
        expect(shown.state).toBe('loading');

        answer.resolve(burndown());
        await flushPromises();
        await flushPromises();

        expect(wrapper.findComponent(BurndownCard).vm).toBe(body);
        expect(shown.state).toBe('ready');
        expect(wrapper.find('[data-test="burndown-remaining"]').text()).toBe('7');
        expect(wrapper.findComponent(ApexChart).props('series')[0].data).toEqual([12, 7]);
        expect(apiRequest).toHaveBeenCalledTimes(1);

        for (const state of ['loading', 'ready', 'empty', 'error', '']) {
            setShell({ state });
            await flushPromises();
        }
        expect(wrapper.findComponent(BurndownCard).vm).toBe(body);
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('asks once more for a refresh, and once more for a retry after an error', async () => {
        apiRequest.mockResolvedValue(burndown());
        const { wrapper, shown } = inShell(BurndownCard, { projectId: 'p1', sprintId: 's1' });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(1);

        apiRequest.mockRejectedValue(new Error('down'));
        await clickRefresh(wrapper);
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(shown.state).toBe('error');

        apiRequest.mockResolvedValue(burndown());
        await clickRetry(wrapper);
        await flushPromises();
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(3);
        expect(shown.state).toBe('ready');
        expect(wrapper.find('[data-test="burndown-remaining"]').text()).toBe('7');
    });

    it('asks again for another sprint, and not for a setting it does not read', async () => {
        apiRequest.mockResolvedValue(burndown());
        const { wrapper } = inShell(BurndownCard, { projectId: 'p1', sprintId: 's1' });
        await flushPromises();

        await wrapper.setProps({ cardData: { projectId: 'p1', sprintId: 's1', fieldName: 'Renamed' } });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(1);

        await wrapper.setProps({ cardData: { projectId: 'p1', sprintId: 's2' } });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(apiRequest).toHaveBeenLastCalledWith('get', '/api/v1/agile/burndown?sprintId=s2');
    });
});

describe('every card the catalogue can add', () => {
    const CARD_DATA = {
        BurndownCard: { projectId: 'p1', sprintId: 's1' },
        VelocityCard: { projectId: 'p1' },
        AskAQuestionCard: { question: 'What is late?' },
    };

    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockResolvedValue(ok({}));
        forgetAskAnswers();
        resetAiAvailability();
        applyAiAvailability({ state: AI_STATE.ON, planAllowsAi: true });
    });

    it.each(BUILT_CARDS.map((c) => c.key))('%s reports through the shell, loads once on mount, once more on refresh, and never in a loop', async (key) => {
        const { shown, refresh } = inShell(cardComponent(key), CARD_DATA[key] || {});
        await settle();

        expect(shown.bodyMounted).toBe(true);
        expect(shown.state).not.toBe('loading');
        expect(apiRequest).toHaveBeenCalledTimes(1);

        await settle();
        expect(apiRequest).toHaveBeenCalledTimes(1);

        refresh();
        await settle();
        await settle();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(shown.state).not.toBe('loading');
    });
});
