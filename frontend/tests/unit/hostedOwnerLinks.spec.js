import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
    apiRequestWithoutSecure: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    replace: vi.fn(),
    query: { token: 'link-token' },
    socket: null,
}));

vi.mock('@/services', () => ({
    apiRequestWithoutSecure: mocks.apiRequestWithoutSecure,
    apiRequestWithoutCompnay: mocks.apiRequestWithoutCompnay,
}));
vi.mock('vue-router', () => ({
    useRoute: () => ({ query: mocks.query, params: {} }),
    useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'settings/getSocketInstance': mocks.socket } }) }));
vi.mock('@/config/publicConfig', () => ({ publicConfig: { hosting: { mode: 'managed', portalUrl: 'https://account.example.test/i/ins_1' } }, isManagedHosting: () => true }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', async () => {
    const { h } = await import('vue');
    return { default: { name: 'AuthShell', setup: (props, { slots }) => () => h('div', slots.default && slots.default()) } };
});

import * as env from '@/config/env';
import Activate from '@/views/Authentication/Activate/Activate.vue';
import PlatformLogin from '@/views/Authentication/PlatformLogin/PlatformLogin.vue';
import HostedBanners from '@/components/organisms/HostedBanners/HostedBanners.vue';
import { notePlatformSignIn } from '@/composable/platformSignIn';

const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.query = { token: 'link-token' };
    mocks.socket = null;
    sessionStorage.clear();
    localStorage.clear();
});

describe('the activation page', () => {
    const open = async () => {
        mocks.apiRequestWithoutSecure.mockImplementation(async (type, url) => {
            if (url === env.ACTIVATION_VERIFY) return { data: { data: { email: 'maya@acme.com', firstName: 'Maya', workspace: 'Acme' } } };
            if (url === env.ACTIVATE) return { data: { status: true, data: { uid: 'u1' } } };
            return { data: {} };
        });
        const wrapper = mount(Activate);
        await flushPromises();
        return wrapper;
    };

    it('checks the token from the link and greets the owner by workspace and address', async () => {
        const wrapper = await open();
        expect(mocks.apiRequestWithoutSecure).toHaveBeenCalledWith('post', env.ACTIVATION_VERIFY, { token: 'link-token' });
        expect(wrapper.text()).toContain('Auth.activate_welcome');
        expect(wrapper.text()).toContain('Auth.activate_for');
    });

    it('sets the password and lands the owner signed in', async () => {
        const wrapper = await open();
        await wrapper.find('#np-password').setValue('Str0ng!pass');
        await wrapper.find('#np-confirm').setValue('Str0ng!pass');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(mocks.apiRequestWithoutSecure).toHaveBeenCalledWith('post', env.ACTIVATE, { token: 'link-token', password: 'Str0ng!pass' });
        expect(mocks.replace).toHaveBeenCalledWith({ name: 'Log-in', query: { magic: 'ok', uid: 'u1' } });
    });

    it('sends a used or expired link to the account portal, not to password reset', async () => {
        mocks.apiRequestWithoutSecure.mockRejectedValue(refusal(400, { key: 'expired' }));
        const wrapper = mount(Activate);
        await flushPromises();
        expect(wrapper.text()).toContain('Auth.activation_expired_body');
        expect(wrapper.find('a[href="https://account.example.test/i/ins_1"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Auth.request_new_link');
    });
});

describe('the platform sign-in page', () => {
    it('exchanges the link and lands the owner signed in, noting where they came from', async () => {
        mocks.apiRequestWithoutSecure.mockResolvedValue({ data: { status: true, data: { uid: 'u1' } } });
        mount(PlatformLogin);
        await flushPromises();
        expect(mocks.apiRequestWithoutSecure).toHaveBeenCalledWith('post', env.PLATFORM_LOGIN, { token: 'link-token' });
        expect(mocks.replace).toHaveBeenCalledWith({ name: 'Log-in', query: { magic: 'ok', uid: 'u1' } });
        expect(sessionStorage.getItem('ah.platformSignIn')).toBe('1');
    });

    it('opens the normal sign-in with the address filled in for two-factor accounts', async () => {
        mocks.apiRequestWithoutSecure.mockRejectedValue(refusal(409, { twoFactorRequired: true, email: 'maya@acme.com' }));
        mount(PlatformLogin);
        await flushPromises();
        expect(localStorage.getItem('ForgotEmail')).toBe('maya@acme.com');
        expect(mocks.replace).toHaveBeenCalledWith({ name: 'Log-in' });
    });

    it('says a link is gone, or that the support session ended', async () => {
        mocks.apiRequestWithoutSecure.mockRejectedValueOnce(refusal(400, { key: 'expired' }));
        const gone = mount(PlatformLogin);
        await flushPromises();
        expect(gone.text()).toContain('Auth.platform_link_gone');
        mocks.apiRequestWithoutSecure.mockRejectedValueOnce(refusal(403, { key: 'ended' }));
        const ended = mount(PlatformLogin);
        await flushPromises();
        expect(ended.text()).toContain('Auth.platform_support_ended');
    });
});

describe('the hosted banners', () => {
    it('show the owner that AlianHub Support has access, with a way to end it', async () => {
        mocks.apiRequestWithoutCompnay.mockResolvedValue({ data: { data: { active: true, expiresAt: new Date(Date.now() + 3600000).toISOString(), portalUrl: 'https://account.example.test/i/ins_1' } } });
        const wrapper = mount(HostedBanners);
        await flushPromises();
        expect(mocks.apiRequestWithoutCompnay).toHaveBeenCalledWith('get', env.INSTANCE_SUPPORT_ACCESS);
        expect(wrapper.find('[data-test="support-banner"]').text()).toContain('Platform.support_end_now');
    });

    it('show nothing to someone who may not read support access', async () => {
        mocks.apiRequestWithoutCompnay.mockRejectedValue(refusal(403, {}));
        const wrapper = mount(HostedBanners);
        await flushPromises();
        expect(wrapper.find('[data-test="support-banner"]').exists()).toBe(false);
    });

    it('say once that the owner signed in from their AlianHub account', async () => {
        mocks.apiRequestWithoutCompnay.mockResolvedValue({ data: { data: { active: false } } });
        notePlatformSignIn();
        const wrapper = mount(HostedBanners);
        await flushPromises();
        expect(wrapper.find('[data-test="platform-signin-banner"]').exists()).toBe(true);
        await wrapper.find('[data-test="platform-signin-banner"] button').trigger('click');
        expect(wrapper.find('[data-test="platform-signin-banner"]').exists()).toBe(false);
        expect(mount(HostedBanners).find('[data-test="platform-signin-banner"]').exists()).toBe(false);
    });

    it('read support access again when the server says it changed', async () => {
        const handlers = {};
        mocks.socket = { on: vi.fn((event, handler) => { handlers[event] = handler; }), off: vi.fn() };
        mocks.apiRequestWithoutCompnay.mockResolvedValue({ data: { data: { active: false } } });
        const wrapper = mount(HostedBanners);
        await flushPromises();
        mocks.apiRequestWithoutCompnay.mockResolvedValue({ data: { data: { active: true, expiresAt: new Date(Date.now() + 3600000).toISOString(), portalUrl: '' } } });
        await handlers.INSTANCE_SUPPORT_ACCESS_CHANGED();
        await flushPromises();
        expect(wrapper.find('[data-test="support-banner"]').exists()).toBe(true);
    });
});
