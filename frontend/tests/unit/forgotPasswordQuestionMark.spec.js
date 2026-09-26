/* Follow-up 132 — the login template appended "?" to a translation that, in Greek and Gujarati, already asked. */
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, mount } from '@vue/test-utils';

vi.mock('@/services', () => ({
    apiRequest: vi.fn(),
    apiRequestWithoutSecure: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    getAuth: vi.fn(),
    useAuth: () => ({ logOut: vi.fn() }),
    SESSION_EXPIRED_KEY: 'ah.sessionExpired'
}));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: () => false }),
    useRoute: () => ({ query: {} })
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/config/publicConfig', () => ({ publicConfig: { auth: {} }, enabledProviders: () => [] }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ debouncerWithPromise: () => Promise.resolve() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import Login from '@/views/Authentication/Login/Login.vue';

const LOCALES_DIR = path.resolve(__dirname, '../../src/locales');
const localeCodes = fs.readdirSync(LOCALES_DIR).filter((file) => /^[a-zA-Z]+\.js$/.test(file) && file !== 'main.js').map((file) => file.replace(/\.js$/, ''));
const loadLocale = async (code) => (await import(`../../src/locales/${code}.js`)).default;

/* "?" everywhere, ";" is the Greek question mark, "？" the full-width one Chinese copy uses. */
const ENDS_WITH_ONE_QUESTION_MARK = /[^?;？؟\s]\s?[?;？؟]$/;

const i18n = config.global.plugins[0];
const stubs = { 'router-link': { template: '<a class="auth__field-link"><slot /></a>' } };
const mounted = [];

afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    i18n.global.locale.value = 'en';
});

const forgotLinkText = (mocks) => {
    const wrapper = mount(Login, { global: { mocks, provide: { $axios: { post: vi.fn() } }, stubs } });
    mounted.push(wrapper);
    return wrapper.find('.auth__field-link').text();
};

describe('the login form\'s "Forgot password" link', () => {
    it('shows the translation as it is, adding nothing', () => {
        expect(forgotLinkText({ $t: (key) => key })).toBe('Auth.Forgot_Password');
    });

    it.each(['en', 'gr', 'gu'])('ends with exactly one question mark in %s', async (code) => {
        i18n.global.setLocaleMessage(code, await loadLocale(code));
        i18n.global.locale.value = code;
        expect(forgotLinkText({ $t: i18n.global.t })).toMatch(ENDS_WITH_ONE_QUESTION_MARK);
    });
});

describe('every locale asks "Forgot password" as a question', () => {
    it.each(localeCodes)('%s ends with exactly one question mark', async (code) => {
        const auth = (await loadLocale(code)).Auth;
        expect(auth.Forgot_Password).toMatch(ENDS_WITH_ONE_QUESTION_MARK);
    });
});
