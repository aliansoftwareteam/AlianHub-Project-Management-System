import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const { services, store, stub } = vi.hoisted(() => ({
    services: { apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), apiRequestWithoutSecure: vi.fn() },
    store: { companies: [] },
    stub: (name) => ({ default: { name, render: () => null } })
}));

vi.mock('@/services', () => services);
vi.mock('vuex', () => ({
    useStore: () => ({
        getters: new Proxy({ 'settings/rules': {}, 'settings/companyUserDetail': {} }, {
            get: (target, key) => (key === 'settings/companies' ? store.companies : target[key])
        }),
        dispatch: vi.fn(() => Promise.resolve()),
        commit: vi.fn()
    })
}));
vi.mock('@/composable/index', () => ({ languageTranslateHelper: () => ({ selectedLanguageCode: { value: 'en' }, changeLanguage: vi.fn(() => Promise.resolve({})) }) }));
vi.mock('@/composable/commonFunction', () => ({ fcmToken: vi.fn() }));
vi.mock('@/composable/socketHelper', () => ({ socketHelper: () => ({ connectServer: vi.fn() }) }));
vi.mock('@/utils/tabSyncs.js', () => ({ tabSyncHelper: () => ({ tabSync: vi.fn() }) }));
vi.mock('@/offline', async () => {
    const { ref } = await import('vue');
    return { initOffline: vi.fn(), away: ref(false), pageUnavailable: ref(false) };
});
vi.mock('@/config/warmChunks', () => ({ warmWorkspaceChunks: vi.fn() }));
vi.mock('@/components/offline/OfflineBanner.vue', () => stub('OfflineBanner'));
vi.mock('@/components/organisms/Tour/TourComponet.vue', () => stub('TourCom'));
vi.mock('@/components/organisms/Shell/GlobalRail.vue', () => stub('GlobalRail'));
vi.mock('@/components/organisms/Shell/MobileTabBar.vue', () => stub('MobileTabBar'));
vi.mock('@/components/organisms/Shell/ShellPanels.vue', () => stub('ShellPanels'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskDetailOverlay.vue', () => stub('TaskDetailOverlay'));
vi.mock('@/views/Ai/AgentLiveStrip.vue', () => stub('AgentLiveStrip'));
vi.mock('@/components/organisms/CallOverlay/CallOverlay.vue', () => stub('CallOverlay'));
vi.mock('@/components/atom/Modal/Modal.vue', () => stub('Modal'));
vi.mock('@/components/molecules/AdvanceSearch/CommandPalette.vue', () => stub('CommandPalette'));
vi.mock('@/components/organisms/QuickCreateTask/QuickCreateTask.vue', () => stub('QuickCreateTask'));
vi.mock('@/components/molecules/AiUnavailable/AiUnavailable.vue', () => stub('AiUnavailable'));

import App from '@/App.vue';

const USER = 'user-1';
const CURRENT = 'company-1';
const OTHER = 'company-2';
const Page = { name: 'Page', render: () => null };

const companyWrites = () => services.apiRequestWithoutCompnay.mock.calls
    .filter(([method, , body]) => method === 'put' && body?.updateObject?.$set && 'lastSelectedCompany' in body.updateObject.$set)
    .map(([, , body]) => body.updateObject.$set.lastSelectedCompany);

async function openAt(path) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'Root', component: Page },
            { path: '/:cid', name: 'Home', component: Page, meta: { requiresAuth: true } }
        ]
    });
    const wrapper = mount(App, { global: { plugins: [router], stubs: { DemoBanner: true, ReviewPromptModal: true, UpgradeProcessModel: true } } });
    await flushPromises();
    await router.push(path);
    await flushPromises();
    await flushPromises();
    return { router, wrapper };
}

const originalLocation = window.location;

describe('App when the address names a company', () => {
    let consoleSpies;
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        consoleSpies = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
        Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload: vi.fn() } });
        localStorage.setItem('userId', USER);
        localStorage.setItem('selectedCompany', CURRENT);
        store.companies = [{ _id: CURRENT, isDisable: false }, { _id: OTHER, isDisable: false }];
        const user = { status: 200, data: { _id: USER, AssignCompany: [CURRENT, OTHER] } };
        services.apiRequest.mockReset().mockImplementation(() => Promise.resolve(user));
        services.apiRequestWithoutCompnay.mockReset().mockImplementation(() => Promise.resolve(user));
        services.apiRequestWithoutSecure.mockReset().mockImplementation(() => Promise.resolve({ data: { status: true, maintenance: false } }));
    });
    afterEach(() => {
        vi.useRealTimers();
        consoleSpies.forEach((spy) => spy.mockRestore());
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
        localStorage.clear();
    });

    it('keeps the current company when the first word of the address is not one of the person\'s companies', async () => {
        const { router, wrapper } = await openAt('/projects');

        expect(companyWrites()).toEqual([]);
        expect(router.currentRoute.value.name).toBe('Home');
        expect(router.currentRoute.value.params.cid).toBe(CURRENT);
        expect(localStorage.getItem('selectedCompany')).toBe(CURRENT);
        wrapper.unmount();
    });

    it('switches to a company the person holds and remembers it', async () => {
        const { router, wrapper } = await openAt(`/${OTHER}`);

        expect(companyWrites()).toEqual([OTHER]);
        expect(services.apiRequestWithoutCompnay).toHaveBeenCalledWith('put', '/api/v1/user', {
            userId: USER,
            updateObject: { $set: { lastSelectedCompany: OTHER } }
        });
        expect(router.currentRoute.value.params.cid).toBe(OTHER);
        expect(localStorage.getItem('selectedCompany')).toBe(OTHER);
        wrapper.unmount();
    });
});
