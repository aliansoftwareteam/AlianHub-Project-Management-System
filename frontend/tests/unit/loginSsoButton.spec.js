import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/services', () => ({ apiRequestWithoutSecure: vi.fn(), apiRequestWithoutCompnay: vi.fn(), getAuth: vi.fn(), SESSION_EXPIRED_KEY: 'ah.sessionExpired' }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: () => false }), useRoute: () => ({ query: {} }) }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import Login from '@/views/Authentication/Login/Login.vue';
import { publicConfig, applyPublicConfig } from '@/config/publicConfig';

const buildDefaults = { loaded: publicConfig.loaded, auth: { ...publicConfig.auth } };

const mountLogin = () => mount(Login, {
    global: {
        mocks: { $t: (key) => key },
        provide: { $axios: { post: vi.fn() } },
        stubs: { 'router-link': { template: '<a><slot /></a>' }, 'i18n-t': { template: '<p><slot name="email" /></p>' } },
    },
});

const ssoButton = (wrapper) => wrapper.findAll('button').find((b) => b.text() === 'Auth.continue_with_sso');

describe('the SSO button on the login page', () => {
    beforeEach(() => {
        publicConfig.loaded = buildDefaults.loaded;
        Object.assign(publicConfig.auth, buildDefaults.auth);
    });
    afterEach(() => {
        publicConfig.loaded = buildDefaults.loaded;
        Object.assign(publicConfig.auth, buildDefaults.auth);
    });

    it('is hidden when public-config says no workspace has SSO', () => {
        applyPublicConfig({ auth: { sso: false } });
        const wrapper = mountLogin();
        expect(ssoButton(wrapper)).toBeUndefined();
        expect(wrapper.find('.auth__or').exists()).toBe(false);
    });

    it('is hidden until public-config has answered, since only the server knows whether a connection exists', () => {
        const wrapper = mountLogin();
        expect(ssoButton(wrapper)).toBeUndefined();
    });

    it('appears once public-config says a connection exists', async () => {
        const wrapper = mountLogin();
        applyPublicConfig({ auth: { sso: true } });
        await wrapper.vm.$nextTick();
        expect(ssoButton(wrapper)).toBeDefined();
        expect(wrapper.find('.auth__or').exists()).toBe(true);
    });
});
