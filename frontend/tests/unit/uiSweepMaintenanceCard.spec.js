import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const { services, stub } = vi.hoisted(() => ({
    services: { apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), apiRequestWithoutSecure: vi.fn() },
    stub: (name) => ({ default: { name, render: () => null } })
}));

vi.mock('@/services', () => services);
vi.mock('vuex', () => ({
    useStore: () => ({
        getters: new Proxy({ 'settings/companies': [], 'settings/rules': {}, 'settings/companyUserDetail': {} }, { get: (target, key) => (key in target ? target[key] : undefined) }),
        dispatch: vi.fn(() => Promise.resolve()),
        commit: vi.fn()
    })
}));
vi.mock('@/composable/index', () => ({ languageTranslateHelper: () => ({ selectedLanguageCode: { value: 'en' }, changeLanguage: vi.fn(() => Promise.resolve({})) }) }));
vi.mock('@/composable/commonFunction', () => ({ fcmToken: vi.fn() }));
vi.mock('@/composable/socketHelper', () => ({ socketHelper: () => ({ connectServer: vi.fn() }) }));
vi.mock('@/utils/tabSyncs.js', () => ({ tabSyncHelper: () => ({ tabSync: vi.fn() }) }));
vi.mock('@/offline', () => ({ initOffline: vi.fn() }));
vi.mock('@/components/offline/OfflineBanner.vue', () => stub('OfflineBanner'));
vi.mock('@/components/organisms/Tour/TourComponet.vue', () => stub('TourCom'));
vi.mock('@/components/organisms/Header/Header.vue', () => stub('HeaderComponent'));
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

const unavailable = { response: { status: 503, data: { status: false, maintenance: true } } };
const Page = { name: 'Page', render: () => null };

/* The real guard reads the signed-in user before every navigation; during maintenance that
 * read answers 503, so this one does the same. */
function signedInRouter({ guardFails }) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/', name: 'Home', component: Page, meta: { requiresAuth: true } }]
    });
    router.beforeEach(async () => {
        if (guardFails) await services.apiRequestWithoutCompnay('get', '/api/v1/user/user-1');
    });
    return router;
}

async function mountApp({ maintenance, guardFails = true }) {
    services.apiRequestWithoutSecure.mockImplementation(() => Promise.resolve({ data: { status: true, maintenance } }));
    const router = signedInRouter({ guardFails });
    const wrapper = mount(App, { global: { plugins: [router], stubs: { DemoBanner: true, ReviewPromptModal: true, UpgradeProcessModel: true } } });
    await flushPromises();
    await flushPromises();
    return wrapper;
}

describe('App during maintenance', () => {
    let errorSpy;
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        services.apiRequestWithoutCompnay.mockImplementation(() => Promise.reject(unavailable));
        services.apiRequest.mockImplementation(() => Promise.reject(unavailable));
    });
    afterEach(() => {
        vi.useRealTimers();
        errorSpy.mockRestore();
    });

    it('shows the maintenance card, not an empty page, when the boot calls answer 503', async () => {
        const wrapper = await mountApp({ maintenance: true });
        expect(wrapper.find('.mt-banner').exists()).toBe(true);

        const card = wrapper.find('[data-test="maintenance-card"]');
        expect(card.exists()).toBe(true);
        expect(card.find('h1').text()).toBe('Instance.maintenance_card_title');
        expect(card.text()).toContain('Instance.maintenance_card_body');
        wrapper.unmount();
    });

    it('shows the card instead of an endless spinner when the page resolved but the shell cannot load', async () => {
        const wrapper = await mountApp({ maintenance: true, guardFails: false });

        expect(wrapper.find('[data-test="maintenance-card"]').exists()).toBe(true);
        expect(wrapper.find('.spinner').exists()).toBe(false);
        wrapper.unmount();
    });

    it('shows no card when maintenance is off', async () => {
        const wrapper = await mountApp({ maintenance: false });

        expect(wrapper.find('[data-test="maintenance-card"]').exists()).toBe(false);
        wrapper.unmount();
    });

    it('drops the image screen nothing ever switched on', () => {
        const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/App.vue'), 'utf8');
        expect(source.includes('underMaintainance'), 'App.vue still carries the dead underMaintainance screen').toBe(false);
    });
});
