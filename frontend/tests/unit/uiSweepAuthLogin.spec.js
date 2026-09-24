import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutSecure, route } = vi.hoisted(() => ({
    apiRequestWithoutSecure: vi.fn(),
    route: { query: {} },
}));

vi.mock('@/services', () => ({ apiRequestWithoutSecure, apiRequestWithoutCompnay: vi.fn(), getAuth: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: () => false }), useRoute: () => route }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import Login from '@/views/Authentication/Login/Login.vue';

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
});
