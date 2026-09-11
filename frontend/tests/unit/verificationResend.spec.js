import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';

const { apiRequestWithoutSecure, route, stub } = vi.hoisted(() => ({
    apiRequestWithoutSecure: vi.fn(),
    route: { params: {}, query: {} },
    stub: (name) => ({ default: { name, render: () => null } })
}));

vi.mock('@/services', () => ({ apiRequestWithoutSecure, apiRequestWithoutCompnay: vi.fn(), getAuth: vi.fn() }));
vi.mock('vue-router', () => ({
    useRoute: () => route,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: () => false })
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/config/publicConfig', () => ({ publicConfig: { auth: { sso: false } }, enabledProviders: () => [] }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({
    default: { name: 'AuthShell', render() { return h('div', this.$slots.default && this.$slots.default()); } }
}));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => stub('ProviderButton'));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));

import Login from '@/views/Authentication/Login/Login.vue';
import VerifyEmail from '@/views/Authentication/VerifyEmail/VerifyEmail.vue';
import * as env from '@/config/env';

const UID = '6f0000000000000000000b01';
const RESEND_URL = env.API_URI + env.SEND_VARIFICATION_EMAIL;

const open = (component, post) => mount(component, {
    global: { provide: { $axios: { post } }, stubs: { 'router-link': true, RouterLink: true } }
});

const button = (wrapper, label) => wrapper.findAll('button').find((b) => b.text().includes(label));

describe('resending the verification email', () => {
    beforeEach(() => {
        apiRequestWithoutSecure.mockReset();
        route.params = {};
        route.query = {};
    });

    it('sends only the account id from an unverified login on the login screen', async () => {
        apiRequestWithoutSecure.mockRejectedValue({
            response: {
                status: 400,
                data: {
                    status: false,
                    isLogout: true,
                    isEmailVerified: false,
                    userData: { _id: UID, Employee_Email: 'stored.address@example.test', isEmailVerified: false },
                    message: 'Email is not verified.'
                }
            }
        });
        const post = vi.fn().mockResolvedValue({ data: { status: true } });
        const wrapper = open(Login, post);

        await wrapper.find('#email').setValue('typed.address@example.test');
        await wrapper.find('#password').setValue('Str0ng!pass');
        await wrapper.find('form').trigger('submit');
        await flushPromises();

        const resend = button(wrapper, 'Auth.resend_email');
        expect(resend).toBeTruthy();
        await resend.trigger('click');
        await flushPromises();

        expect(post).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledWith(RESEND_URL, { uid: UID });
        wrapper.unmount();
    });

    it('sends only the account id from the link on the verify-email screen', async () => {
        route.params = { id: UID, token: 'a'.repeat(64) };
        const post = vi.fn()
            .mockResolvedValueOnce({ data: { status: false, email: 'stored.address@example.test', statusText: 'This link is expired', showResendVerification: true } })
            .mockResolvedValueOnce({ data: { status: true } });
        const wrapper = open(VerifyEmail, post);
        await flushPromises();

        const resend = button(wrapper, 'Auth.resend_email');
        expect(resend).toBeTruthy();
        await resend.trigger('click');
        await flushPromises();

        expect(post).toHaveBeenNthCalledWith(1, env.API_URI + env.VERIFY_EMAIL, { uid: UID, token: route.params.token });
        expect(post).toHaveBeenNthCalledWith(2, RESEND_URL, { uid: UID });
        expect(wrapper.text()).toContain('Auth.magic_sent_title');
    });
});
