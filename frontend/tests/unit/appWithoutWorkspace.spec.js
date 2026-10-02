import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

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
vi.mock('@/composable/index', () => ({
    languageTranslateHelper: () => ({ selectedLanguageCode: { value: 'en' }, changeLanguage: vi.fn(() => Promise.resolve({})) }),
    useCustomComposable: () => ({ setTitle: vi.fn() })
}));
vi.mock('@/composable/commonFunction', () => ({ fcmToken: vi.fn() }));
vi.mock('@/composable/socketHelper', () => ({ socketHelper: () => ({ connectServer: vi.fn() }) }));
vi.mock('@/utils/tabSyncs.js', () => ({ tabSyncHelper: () => ({ tabSync: vi.fn() }) }));
vi.mock('@/offline', () => ({ initOffline: vi.fn() }));
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
vi.mock('@/views/Authentication/Invitation/Invitation.vue', () => stub('InvitationPage'));
vi.mock('@/views/Authentication/VerifyInvitation/VerifyInvitation.vue', () => stub('VerifyInvitationPage'));
vi.mock('@/views/Authentication/VerifyEmail/VerifyEmail.vue', () => stub('VerifyEmailPage'));
vi.mock('@/views/Authentication/ResetPassword/ResetPassword.vue', () => stub('ResetPasswordPage'));
vi.mock('@/views/Authentication/ResetPassword/SetNewPassword.vue', () => stub('SetNewPasswordPage'));
vi.mock('@/views/Authentication/Login/Login.vue', () => stub('LoginPage'));
vi.mock('@/views/Company/CreateCompany.vue', () => stub('CreateCompanyPage'));
vi.mock('@/views/NotFound', () => stub('NotFoundPage'));

import App from '@/App.vue';
import * as env from '@/config/env';

const { default: router } = await import('@/router');
const { opensWithoutWorkspace } = await import('@/router/withoutWorkspace');

const USER = 'user-1';
const originalLocation = window.location;

const signedIn = ({ companies }) => {
    localStorage.setItem('userId', USER);
    const user = { status: 200, data: { _id: USER, Employee_Email: 'pat@example.test', AssignCompany: companies } };
    services.apiRequest.mockReset().mockImplementation(() => Promise.resolve(user));
    services.apiRequestWithoutCompnay.mockReset().mockImplementation(() => Promise.resolve(user));
};

async function openAppAt(path) {
    await router.push(path);
    const wrapper = mount(App, { global: { plugins: [router], stubs: { DemoBanner: true, ReviewPromptModal: true, UpgradeProcessModel: true } } });
    for (let turn = 0; turn < 6; turn += 1) await flushPromises();
    return wrapper;
}

const PAGES_THAT_NEED_NO_WORKSPACE = [
    ['the invitation page', '/invitation?companyId=c1-m1&token=t1', 'Invitation'],
    ['the mailed invitation link', '/verify-invitation?id=abc', 'Verify_Invitation'],
    ['the verify e-mail link', '/verify-email/u2/token-1', 'Verify_Email'],
    ['the reset password link', '/reset-password/token-1', 'Reset_Password'],
    ['the set a new password link', '/set-new-password/token-1', 'Set_New_Password'],
];

describe('a signed-in person', () => {
    let consoleSpies;
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        consoleSpies = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
        Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload: vi.fn() } });
        services.apiRequestWithoutSecure.mockReset().mockImplementation((method, url) => Promise.resolve(url === env.SETUP_STATUS
            ? { data: { data: { installed: true, dbOk: true } } }
            : { data: { status: true, maintenance: false } }));
    });
    afterEach(() => {
        vi.useRealTimers();
        consoleSpies.forEach((spy) => spy.mockRestore());
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
        localStorage.clear();
    });

    describe('with no workspace', () => {
        beforeEach(() => signedIn({ companies: [] }));

        it.each(PAGES_THAT_NEED_NO_WORKSPACE)('stays on %s instead of being sent to name a workspace', async (label, path, name) => {
            const wrapper = await openAppAt(path);

            expect(router.currentRoute.value.name).toBe(name);
            wrapper.unmount();
        });

        it.each([
            ['the sign-in page', '/login'],
            ['an address that leads nowhere', '/nowhere'],
        ])('is still sent to name a workspace from %s', async (label, path) => {
            const wrapper = await openAppAt(path);

            expect(router.currentRoute.value.name).toBe('Create_Company');
            wrapper.unmount();
        });
    });

    describe('with a workspace', () => {
        beforeEach(() => {
            signedIn({ companies: ['c1'] });
            localStorage.setItem('selectedCompany', 'c1');
        });

        it.each(PAGES_THAT_NEED_NO_WORKSPACE)('opens %s, not their own workspace', async (label, path, name) => {
            await router.push(path);

            expect(router.currentRoute.value.name).toBe(name);
        });
    });
});

describe('the pages that open without a workspace', () => {
    it('are named once, in the route table', () => {
        const named = router.getRoutes().filter((record) => opensWithoutWorkspace(record)).map((record) => record.name).sort();

        expect(named).toEqual(PAGES_THAT_NEED_NO_WORKSPACE.map(([, , name]) => name).sort());
    });

    it('never include a page drawn inside the workspace', () => {
        expect(router.getRoutes().filter((record) => opensWithoutWorkspace(record) && record.meta.requiresAuth === true)).toEqual([]);
    });
});
