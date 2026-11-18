import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, mount } from '@vue/test-utils';

const routes = vi.hoisted(() => ({ signUp: false }));

vi.mock('@/services', () => ({
    apiRequest: vi.fn(),
    apiRequestWithoutSecure: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    getAuth: vi.fn(),
    useAuth: () => ({ logOut: vi.fn() }),
    SESSION_EXPIRED_KEY: 'ah.sessionExpired'
}));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: (name) => routes.signUp && name === 'Signup' }),
    useRoute: () => ({ query: {} })
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/config/publicConfig', () => ({ publicConfig: { auth: {} }, enabledProviders: () => [] }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ debouncerWithPromise: () => Promise.resolve() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot name="top-right" /><slot /></div>' } }));

import en from '@/locales/en.js';
import Login from '@/views/Authentication/Login/Login.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const mounted = [];
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    routes.signUp = false;
});

const mountLogin = () => {
    const wrapper = mount(Login, { global: { mocks: { $t: t }, provide: { $axios: { post: vi.fn() } }, stubs: { 'router-link': { template: '<a><slot /></a>' } } } });
    mounted.push(wrapper);
    return wrapper;
};

describe('the log-in page on an invitation-only server', () => {
    it('does not greet a first-time visitor as returning', () => {
        const title = mountLogin().find('.auth__title').text();
        expect(title).toBe('Log in');
        expect(title).not.toContain('Welcome back');
    });

    it('tells a person without an account to ask their admin for an invitation', () => {
        expect(mountLogin().find('[data-test="login-lead"]').text()).toBe(en.Auth.no_account_ask_admin);
    });

    it('drops the invitation line when the server offers sign-up', () => {
        routes.signUp = true;
        const wrapper = mountLogin();
        expect(wrapper.find('[data-test="login-lead"]').text()).toBe('Log in to your workspace.');
        expect(wrapper.text()).toContain('Create your account');
    });
});
