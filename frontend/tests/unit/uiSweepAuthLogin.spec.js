import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutSecure, route } = vi.hoisted(() => ({
    apiRequestWithoutSecure: vi.fn(),
    route: { query: {} },
}));

vi.mock('@/services', () => ({ apiRequestWithoutSecure, apiRequestWithoutCompnay: vi.fn(), getAuth: vi.fn(), SESSION_EXPIRED_KEY: 'ah.sessionExpired' }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: () => false }), useRoute: () => route }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import Login from '@/views/Authentication/Login/Login.vue';
import { publicConfig } from '@/config/publicConfig';

const mountLogin = () => mount(Login, {
    attachTo: document.body,
    global: {
        mocks: { $t: (key) => key },
        provide: { $axios: { post: vi.fn() } },
        stubs: { 'router-link': { template: '<a><slot /></a>' }, 'i18n-t': { template: '<p><slot name="email" /></p>' } },
    },
});

const signIn = async (wrapper) => {
    await wrapper.find('#email').setValue('guest@example.com');
    await wrapper.find('#password').setValue('Password1!');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
};

describe('Login', () => {
    beforeEach(() => {
        apiRequestWithoutSecure.mockReset();
        route.query = {};
        localStorage.clear();
        sessionStorage.clear();
    });

    it('clears the six code boxes after a wrong two-factor code, ready for the next try', async () => {
        apiRequestWithoutSecure.mockResolvedValueOnce({ status: 200, data: { twoFactorRequired: true, tempToken: 'tmp' } });
        const wrapper = mountLogin();
        await signIn(wrapper);

        apiRequestWithoutSecure.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Invalid code.' } } });
        const boxes = wrapper.findAll('.auth__code input');
        expect(boxes).toHaveLength(6);
        for (const [i, box] of boxes.entries()) await box.setValue(String(i + 1));
        await flushPromises();

        expect(wrapper.text()).toContain('Auth.two_factor_invalid_code');
        expect(wrapper.findAll('.auth__code input').map((box) => box.element.value)).toEqual(['', '', '', '', '', '']);
        expect(document.activeElement).toBe(wrapper.findAll('.auth__code input')[0].element);
        wrapper.unmount();
    });

    it('says sign-in is paused for maintenance rather than blaming the server', async () => {
        apiRequestWithoutSecure.mockRejectedValueOnce({ response: { status: 503, data: { status: false, maintenance: true } } });
        const wrapper = mountLogin();
        await signIn(wrapper);

        expect(wrapper.find('.auth__banner').text()).toBe('Auth.maintenance_login');
        expect(wrapper.text()).not.toContain('Auth.server_error');
        wrapper.unmount();
    });

    it('explains why the person is back on the login page after their session ran out', async () => {
        sessionStorage.setItem('ah.sessionExpired', '1');
        const wrapper = mountLogin();
        await flushPromises();
        expect(wrapper.find('.auth__banner').text()).toBe('Auth.session_expired');
        expect(sessionStorage.getItem('ah.sessionExpired')).toBeNull();
        wrapper.unmount();
    });

    it('offers the email login link only when the server has login links switched on', async () => {
        const off = mountLogin();
        expect(off.text()).not.toContain('Auth.email_me_link');
        off.unmount();

        publicConfig.auth.magicLink = true;
        const on = mountLogin();
        expect(on.text()).toContain('Auth.email_me_link');
        on.unmount();
        publicConfig.auth.magicLink = false;
    });

    it('shows no session notice on an ordinary visit', async () => {
        const wrapper = mountLogin();
        await flushPromises();
        expect(wrapper.find('.auth__banner').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('automatic sign-outs', () => {
    const services = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/services/index.js'), 'utf8');

    it('mark the session as expired so the login page can say so', () => {
        expect(services).not.toMatch(/\blogOut\(\)/);
        expect(services.match(/logOut\(\{ expired: true \}\)/g)).toHaveLength(4);
        expect(services).toMatch(/if \(data\?\.expired\)[\s\S]{0,120}sessionStorage\.setItem\(SESSION_EXPIRED_KEY/);
    });
});
