import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { h, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));

import DashboardView from '@/views/Dashboards/DashboardView.vue';

enableAutoUnmount(afterEach);

const blank = { render: () => null };
const ApexChart = { name: 'ApexChart', props: ['series', 'options', 'type', 'height'], render: () => h('div', { 'data-test': 'apex' }) };

const ok = (data) => ({ data: { status: true, data } });
const deferred = () => {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
};
const settle = async () => {
    await vi.dynamicImportSettled();
    await flushPromises();
    await flushPromises();
};

const position = { x: 0, y: 0, w: 6, h: 9 };
const DASHBOARDS = {
    d1: { _id: 'd1', title: 'First board', visibility: 'private', canEdit: true, isMine: true, cards: [
        { uid: 'c1', componentId: 'VelocityCard', config: { cardData: { projectId: 'p1' }, position } },
    ] },
    d2: { _id: 'd2', title: 'Second board', visibility: 'workspace', canEdit: true, isMine: true, cards: [
        { uid: 'c2', componentId: 'BurndownCard', config: { cardData: { projectId: 'p2', sprintId: 's2' }, position } },
    ] },
    d3: { _id: 'd3', title: 'Third board', visibility: 'private', canEdit: true, isMine: true, cards: [
        { uid: 'c3', componentId: 'MyTimeCard', config: { cardData: { timerange: 3 }, position } },
    ] },
};
const MY_TIME = '/api/v1/dashboard/my-time';
const VELOCITY = ok({ sprints: [{ sprintId: 's0', name: 'Sprint 0', committed: 10, completed: 8 }, { sprintId: 's1', name: 'Sprint 1', committed: 10, completed: 9 }] });
const BURNDOWN = ok({ sprintName: 'Sprint 2', totalPoints: 5, days: [{ date: '2026-09-01', remainingPoints: 5, idealPoints: 5 }] });

const answerByUrl = (overrides = {}) => (method, url) => {
    if (url in overrides) return overrides[url];
    const dashboard = url.match(/^\/api\/v1\/dashboards\/(\w+)$/);
    if (dashboard) return Promise.resolve(ok(DASHBOARDS[dashboard[1]]));
    if (url.startsWith('/api/v1/agile/velocity')) return Promise.resolve(VELOCITY);
    if (url.startsWith('/api/v1/agile/burndown')) return Promise.resolve(BURNDOWN);
    if (url === MY_TIME) return Promise.resolve(ok({ plannedMinutes: 120, loggedMinutes: 45 }));
    return Promise.resolve(ok({}));
};
const callsTo = (prefix) => apiRequest.mock.calls.filter(([, url]) => url.startsWith(prefix)).map(([, url]) => url);

const open = async (dashboardId, { clientWidth = 600 } = {}) => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/:cid/dashboards', name: 'Dashboards', component: blank },
            { path: '/:cid/dashboards/:dashboardId', name: 'DashboardView', component: blank },
        ],
    });
    await router.push({ name: 'DashboardView', params: { cid: 'company-1', dashboardId } });
    await router.isReady();
    const store = createStore({
        modules: {
            settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }), AllTaskStatus: () => [], teams: () => [], companyUsers: () => [] } },
            projectData: { namespaced: true, getters: { onlyActiveProjects: () => ({ data: [{ _id: 'p1', ProjectName: 'Website' }, { _id: 'p2', ProjectName: 'App' }] }) } },
        },
    });
    const wrapper = mount(DashboardView, {
        global: { plugins: [router, store], provide: { $clientWidth: ref(clientWidth) }, stubs: { ApexChart } },
    });
    await settle();
    const go = async (id) => {
        await router.push({ name: 'DashboardView', params: { cid: 'company-1', dashboardId: id } });
        await settle();
    };
    return { wrapper, router, go };
};

const title = (wrapper) => wrapper.find('.dash__title').text();
const cardTitles = (wrapper) => wrapper.findAll('.dcard__title').map((el) => el.text());

describe('a dashboard\'s cards in the real view', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockImplementation(answerByUrl());
    });

    it.each([['stacked on a phone', 600], ['in the grid on a desktop', 1280]])('load their content %s, asking once each', async (_, clientWidth) => {
        const { wrapper } = await open('d1', { clientWidth });

        expect(title(wrapper)).toBe('First board');
        expect(cardTitles(wrapper)).toEqual(['Dash.card_VelocityCard_title']);
        expect(wrapper.find('[data-test="dcard-skeleton"]').exists()).toBe(false);
        expect(wrapper.findAll('[data-test="velocity-sprint"]')).toHaveLength(2);
        expect(wrapper.find('.dcard__scope').text()).toBe('Website');
        expect(callsTo('/api/v1/agile/velocity')).toHaveLength(1);

        await settle();
        expect(callsTo('/api/v1/agile/velocity')).toHaveLength(1);
    });

    it('ask once more for the card\'s refresh, and once more when its settings are saved', async () => {
        const { wrapper } = await open('d1');

        await wrapper.find('.dcard__tool[title="Dash.refresh"]').trigger('click');
        await settle();
        expect(callsTo('/api/v1/agile/velocity')).toHaveLength(2);

        await wrapper.find('.dcard__tool[title="Dash.card_settings"]').trigger('click');
        await wrapper.find('[data-test="csf-projectId"]').setValue('p2');
        await wrapper.find('.dash__modal form').trigger('submit');
        await settle();

        expect(callsTo('/api/v1/agile/velocity')).toEqual([
            '/api/v1/agile/velocity?projectId=p1&limit=6',
            '/api/v1/agile/velocity?projectId=p1&limit=6',
            '/api/v1/agile/velocity?projectId=p2&limit=6',
        ]);
        expect(wrapper.find('.dcard__scope').text()).toBe('App');
        expect(wrapper.findAll('[data-test="velocity-sprint"]')).toHaveLength(2);
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v1/dashboards/d1/cards', expect.anything());
    });

    it('ask once more when the card\'s period changes', async () => {
        const { wrapper } = await open('d3');
        expect(callsTo(MY_TIME)).toHaveLength(1);
        expect(wrapper.find('[data-test="dcard-skeleton"]').exists()).toBe(false);

        await wrapper.find('.dcard__period').setValue('6');
        await settle();

        expect(callsTo(MY_TIME)).toHaveLength(2);
        const ranges = apiRequest.mock.calls.filter(([, url]) => url === MY_TIME).map(([, , body]) => body.dateFrom);
        expect(ranges[1]).not.toBe(ranges[0]);
    });
});

describe('changing the dashboard in the address', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockImplementation(answerByUrl());
    });

    it('loads the other dashboard and its cards, and drops the first one\'s', async () => {
        const { wrapper, go } = await open('d1');
        expect(title(wrapper)).toBe('First board');

        await go('d2');

        expect(callsTo('/api/v1/dashboards/')).toEqual(['/api/v1/dashboards/d1', '/api/v1/dashboards/d2']);
        expect(title(wrapper)).toBe('Second board');
        expect(wrapper.find('.ah-chip--mono').text()).toBe('Dash.vis_workspace');
        expect(cardTitles(wrapper)).toEqual(['Dash.card_BurndownCard_title']);
        expect(wrapper.find('[data-test="velocity-sprint"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="burndown-remaining"]').text()).toBe('5');
        expect(callsTo('/api/v1/agile/burndown')).toEqual(['/api/v1/agile/burndown?sprintId=s2']);
        expect(callsTo('/api/v1/agile/velocity')).toHaveLength(1);
    });

    it('goes back to the first dashboard when the address does', async () => {
        const { wrapper, go } = await open('d1');
        await go('d2');
        await go('d1');

        expect(title(wrapper)).toBe('First board');
        expect(cardTitles(wrapper)).toEqual(['Dash.card_VelocityCard_title']);
        expect(wrapper.findAll('[data-test="velocity-sprint"]')).toHaveLength(2);
    });

    it('clears a dashboard that could not be opened when the next one can', async () => {
        apiRequest.mockImplementation(answerByUrl({ '/api/v1/dashboards/d1': Promise.reject(Object.assign(new Error('no'), { response: { status: 403 } })) }));
        const { wrapper, go } = await open('d1');
        expect(wrapper.find('.ah-empty').text()).toBe('Dash.no_access');

        await go('d2');

        expect(wrapper.find('.ah-empty').exists()).toBe(false);
        expect(title(wrapper)).toBe('Second board');
        expect(cardTitles(wrapper)).toEqual(['Dash.card_BurndownCard_title']);
    });

    it('keeps the dashboard in the address when an earlier one answers late', async () => {
        const slow = deferred();
        apiRequest.mockImplementation(answerByUrl({ '/api/v1/dashboards/d1': slow.promise }));
        const { wrapper, go } = await open('d1');
        await go('d2');
        expect(title(wrapper)).toBe('Second board');

        slow.resolve(ok(DASHBOARDS.d1));
        await settle();

        expect(title(wrapper)).toBe('Second board');
        expect(cardTitles(wrapper)).toEqual(['Dash.card_BurndownCard_title']);
    });

    it('closes an open card settings dialog, which belonged to the dashboard left behind', async () => {
        const { wrapper, go } = await open('d1');
        await wrapper.find('.dcard__tool[title="Dash.card_settings"]').trigger('click');
        expect(wrapper.find('.dash__modal').exists()).toBe(true);

        await go('d2');

        expect(wrapper.find('.dash__modal').exists()).toBe(false);
    });
});
