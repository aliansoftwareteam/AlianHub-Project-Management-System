import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutSecure } = vi.hoisted(() => ({ apiRequestWithoutSecure: vi.fn() }));

vi.mock('@/services', () => ({
    apiRequest: vi.fn(),
    apiRequestWithoutSecure,
    apiRequestWithoutCompnay: vi.fn(),
    getAuth: vi.fn(),
    useAuth: () => ({ logOut: vi.fn() }),
    SESSION_EXPIRED_KEY: 'ah.sessionExpired'
}));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: () => false }),
    useRoute: () => ({ query: { companyId: '6f0000000000000000000c01-6f00000000000000000a0001' } })
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/config/publicConfig', () => ({ publicConfig: { auth: {} }, enabledProviders: () => [] }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ debouncerWithPromise: () => Promise.resolve() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import en from '@/locales/en.js';
import Login from '@/views/Authentication/Login/Login.vue';
import Invitation from '@/views/Authentication/Invitation/Invitation.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const stubs = { 'router-link': { template: '<a><slot /></a>' } };
const mounted = [];
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    apiRequestWithoutSecure.mockReset();
});

const mountLogin = () => {
    const wrapper = mount(Login, { global: { mocks: { $t: t }, provide: { $axios: { post: vi.fn() } }, stubs } });
    mounted.push(wrapper);
    return wrapper;
};

const mountInvitation = async (workspaceName) => {
    const $axios = { post: vi.fn(async () => ({ data: { status: true, data: { status: 1, email: 'new.member@example.test', workspaceName } } })) };
    const wrapper = mount(Invitation, { global: { mocks: { $t: t }, provide: { $axios, addSubscription: vi.fn() }, stubs } });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

describe('auth copy is in sentence case (U5-35)', () => {
    it('the login form offers "Forgot password?"', () => {
        expect(mountLogin().find('.auth__field-link').text()).toBe('Forgot password?');
    });

    it('the verify-your-email step offers "Back to login", as every other auth screen does', async () => {
        apiRequestWithoutSecure.mockRejectedValue({ response: { data: { isEmailVerified: false } } });
        const wrapper = mountLogin();
        await wrapper.find('#email').setValue('guest@example.com');
        await wrapper.find('#password').setValue('Password1!');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        const back = wrapper.findAll('.auth__links button').find((b) => /back to/i.test(b.text()));
        expect(back.text()).toBe('Back to login');
        expect(t('Auth.backlogin')).toBe(t('Auth.back_to_login'));
    });
});

describe('invitation sign-up lead (U5-35)', () => {
    it('tells the invitee which workspace they are joining, without the self-hosting pitch', async () => {
        const wrapper = await mountInvitation('Acme');
        expect(wrapper.find('.auth__p').text()).toBe("You're joining Acme.");
        expect(wrapper.text()).not.toMatch(/free forever|no card/i);
    });

    it('shows no pricing line when the workspace name is unknown', async () => {
        const wrapper = await mountInvitation('');
        expect(wrapper.find('#inv-name').exists()).toBe(true);
        expect(wrapper.text()).not.toMatch(/free forever|no card/i);
    });
});
