/* Task 047, tenth sweep — a dashboard is deleted only after the person says yes (it cannot be
   restored), and a card that was removed can be put back from the toast. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createStore } from 'vuex';

const { apiRequest, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import DashboardsHub from '@/views/Dashboards/DashboardsHub.vue';
import DashboardView from '@/views/Dashboards/DashboardView.vue';
import { dismissUndoToast, runUndo, undoToast } from '@/composable/useUndoToast';
import en from '@/locales/en.js';

enableAutoUnmount(afterEach);

const blank = { render: () => null };
const ok = (data) => ({ data: { status: true, data } });
const position = { x: 0, y: 0, w: 6, h: 9 };
const BOARD = {
    _id: 'd1', title: 'Team board', visibility: 'private', canEdit: true, isMine: true, ownerName: 'Local PM', cardCount: 2, preview: [],
    cards: [
        { uid: 'c1', componentId: 'MyTimeCard', config: { cardData: { timerange: 3 }, position } },
        { uid: 'c2', componentId: 'DueSoonCard', config: { cardData: {}, position: { ...position, y: 9 } } }
    ]
};

const settle = async () => {
    await vi.dynamicImportSettled();
    await flushPromises();
    await flushPromises();
};
const deletes = () => apiRequest.mock.calls.filter(([method]) => method === 'delete');
const cardSaves = () => apiRequest.mock.calls.filter(([method, url]) => method === 'put' && url.endsWith('/cards')).map(([, , body]) => body.cards.map((card) => card.uid));

const router = () => createRouter({
    history: createMemoryHistory(),
    routes: [
        { path: '/:cid/dashboards', name: 'Dashboards', component: blank },
        { path: '/:cid/dashboards/:dashboardId', name: 'DashboardView', component: blank }
    ]
});

beforeEach(() => {
    dismissUndoToast();
    apiRequest.mockReset();
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url.endsWith('/dashboards')) return Promise.resolve(ok([BOARD]));
        if (method === 'get' && /\/dashboards\/\w+$/.test(url)) return Promise.resolve(ok(BOARD));
        return Promise.resolve(ok({}));
    });
});

describe('Delete in a dashboard tile\'s menu', () => {
    const open = async () => {
        const wrapper = mount(DashboardsHub, {
            attachTo: document.body,
            global: { plugins: [router()], provide: { $companyId: ref('company-1') }, stubs: { ShellIcon: true } }
        });
        await flushPromises();
        await wrapper.get('.dash__tile-menu').trigger('click');
        await wrapper.findAll('.ah-pop__item').find((item) => item.text() === 'Dash.delete').trigger('click');
        return wrapper;
    };
    const dialog = () => document.body.querySelector('[role="dialog"]');
    const pressInDialog = async (label) => {
        [...dialog().querySelectorAll('button')].find((button) => button.textContent.trim() === label).click();
        await flushPromises();
    };

    it('asks first, naming the dashboard and saying it cannot be undone', async () => {
        const wrapper = await open();
        expect(deletes()).toEqual([]);
        expect(dialog().textContent).toContain('Dash.delete_title');
        expect(dialog().textContent).toContain('Dash.delete_text');
        expect(en.Dash.delete_title).toBe('Delete {name}?');
        expect(en.Dash.delete_text).toContain('This cannot be undone.');
        expect(wrapper.findAll('.dash__hub-grid article')).toHaveLength(1);
    });

    it('leaves the dashboard alone on Cancel', async () => {
        const wrapper = await open();
        await pressInDialog('Projects.cancel');
        expect(dialog()).toBeNull();
        expect(deletes()).toEqual([]);
        expect(wrapper.findAll('.dash__hub-grid article')).toHaveLength(1);
    });

    it('deletes it on Delete and says so', async () => {
        const wrapper = await open();
        await pressInDialog('Dash.delete');
        expect(deletes()).toHaveLength(1);
        expect(deletes()[0][1]).toMatch(/\/dashboards\/d1$/);
        expect(wrapper.findAll('.dash__hub-grid article')).toHaveLength(0);
        expect(dialog()).toBeNull();
        expect(toast.success).toHaveBeenCalledTimes(1);
    });
});

describe('Remove card on a dashboard', () => {
    const open = async () => {
        const routes = router();
        await routes.push({ name: 'DashboardView', params: { cid: 'company-1', dashboardId: 'd1' } });
        await routes.isReady();
        const store = createStore({
            modules: {
                settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }), AllTaskStatus: () => [], teams: () => [], companyUsers: () => [] } },
                projectData: { namespaced: true, getters: { onlyActiveProjects: () => ({ data: [] }) } }
            }
        });
        const wrapper = mount(DashboardView, { global: { plugins: [routes, store], provide: { $clientWidth: ref(600), $companyId: ref('company-1') } } });
        await settle();
        return wrapper;
    };
    const titles = (wrapper) => wrapper.findAll('.dcard__title').map((el) => el.text());

    it('takes the card away and offers Undo, which puts it back where it was', async () => {
        const wrapper = await open();
        expect(titles(wrapper)).toEqual(['Dash.card_MyTimeCard_title', 'Dash.card_DueSoonCard_title']);

        await wrapper.findAll('.dcard__tool--danger')[0].trigger('click');
        await settle();
        expect(titles(wrapper)).toEqual(['Dash.card_DueSoonCard_title']);
        expect(cardSaves()).toEqual([['c2']]);
        expect(undoToast.current).toMatchObject({ canUndo: true });
        expect(en.Dash.card_removed).toBe('{card} was removed from this dashboard.');

        await runUndo();
        await settle();
        expect(titles(wrapper)).toEqual(['Dash.card_MyTimeCard_title', 'Dash.card_DueSoonCard_title']);
        expect(cardSaves()).toEqual([['c2'], ['c1', 'c2']]);
    });

    it('asks before the dashboard itself is deleted from its settings', async () => {
        const wrapper = await open();
        await wrapper.findAll('button').find((button) => button.attributes('aria-expanded') !== undefined).trigger('click');
        await wrapper.findAll('.ah-pop__item').find((item) => item.text() === 'Dash.dashboard_settings').trigger('click');
        await wrapper.findAll('.dash__modal .ah-btn--danger').find((button) => button.text() === 'Dash.delete').trigger('click');
        await flushPromises();
        expect(deletes()).toEqual([]);
        expect(document.body.querySelector('[role="dialog"]').textContent).toContain('Dash.delete_text');
    });
});
