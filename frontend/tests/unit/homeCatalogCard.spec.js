import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createStore } from 'vuex';

const { apiRequest, openTask } = vi.hoisted(() => ({ apiRequest: vi.fn(), openTask: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask }));

import HomeCatalogCard from '@/components/molecules/Home/HomeCatalogCard.vue';

enableAutoUnmount(afterEach);

const blank = { render: () => null };
const DUE_SOON = '/api/v1/dashboard/my-due-soon';

const ok = (data) => ({ data: { status: true, data } });
const task = (id, daysUntil) => ({ taskId: id, taskKey: `K-${id}`, taskName: `Task ${id}`, projectId: 'p1', projectName: 'Website', daysUntil });
const deferred = () => {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
};
const settle = async () => {
    await vi.dynamicImportSettled();
    await flushPromises();
};

const mountHomeCard = async (cardKey = 'DueSoonCard') => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:cid', name: 'Home', component: blank }] });
    await router.push({ name: 'Home', params: { cid: 'company-1' } });
    await router.isReady();
    const store = createStore({
        modules: {
            settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 3 }), AllTaskStatus: () => [], teams: () => [], companyUsers: () => [] } },
            projectData: { namespaced: true, getters: { onlyActiveProjects: () => ({ data: [] }) } },
        },
    });
    const wrapper = mount(HomeCatalogCard, { props: { cardKey }, global: { plugins: [router, store] } });
    await settle();
    return wrapper;
};

const dueSoonCalls = () => apiRequest.mock.calls.filter(([, url]) => url === DUE_SOON);
const skeleton = (wrapper) => wrapper.find('[data-test="dcard-skeleton"]');
const contentHidden = (wrapper) => wrapper.find('[data-test="dcard-content"]').attributes('aria-hidden') === 'true';

describe('a catalogue card on Home ("My work")', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('mounts its body, asks once, shows the skeleton while it waits and the tasks after', async () => {
        const answer = deferred();
        apiRequest.mockReturnValue(answer.promise);
        const wrapper = await mountHomeCard();

        expect(wrapper.find('.dcard__title').text()).toBe('Dash.card_DueSoonCard_title');
        expect(wrapper.find('.ds').exists()).toBe(true);
        expect(dueSoonCalls()).toHaveLength(1);
        expect(skeleton(wrapper).exists()).toBe(true);
        expect(contentHidden(wrapper)).toBe(true);

        answer.resolve(ok({ tasks: [task('a', -2), task('b', 0)] }));
        await settle();

        expect(skeleton(wrapper).exists()).toBe(false);
        expect(contentHidden(wrapper)).toBe(false);
        expect(wrapper.findAll('.ds .dc-item').map((row) => row.find('.dc-item__text').text())).toEqual(['K-aTask a', 'K-bTask b']);
        await settle();
        expect(dueSoonCalls()).toHaveLength(1);
    });

    it('shows the catalogue\'s empty text when nothing is due', async () => {
        apiRequest.mockResolvedValue(ok({ tasks: [] }));
        const wrapper = await mountHomeCard();

        expect(wrapper.find('[data-test="dcard-empty"]').text()).toContain('Dash.empty_due_soon');
        expect(contentHidden(wrapper)).toBe(true);
        expect(dueSoonCalls()).toHaveLength(1);
    });

    it('shows the error state, and its retry asks once more', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        const wrapper = await mountHomeCard();

        expect(wrapper.find('[data-test="dcard-error"]').text()).toContain('Dash.card_error');
        expect(dueSoonCalls()).toHaveLength(1);

        apiRequest.mockResolvedValue(ok({ tasks: [task('a', 1)] }));
        await wrapper.find('[data-test="dcard-retry"]').trigger('click');
        await settle();

        expect(dueSoonCalls()).toHaveLength(2);
        expect(wrapper.findAll('.ds .dc-item')).toHaveLength(1);
    });

    it('asks exactly once more when refreshed', async () => {
        apiRequest.mockResolvedValue(ok({ tasks: [task('a', 1)] }));
        const wrapper = await mountHomeCard();
        expect(dueSoonCalls()).toHaveLength(1);

        await wrapper.find('.dcard__tool').trigger('click');
        await settle();
        await settle();

        expect(dueSoonCalls()).toHaveLength(2);
        expect(wrapper.findAll('.ds .dc-item')).toHaveLength(1);
    });

    it('opens a task from its row', async () => {
        apiRequest.mockResolvedValue(ok({ tasks: [task('a', 1)] }));
        const wrapper = await mountHomeCard();

        await wrapper.find('.ds .dc-item').trigger('click');
        expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'a', projectId: 'p1' }));
    });
});
