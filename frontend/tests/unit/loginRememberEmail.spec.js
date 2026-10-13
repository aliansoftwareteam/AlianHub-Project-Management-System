import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutSecure } = vi.hoisted(() => ({ apiRequestWithoutSecure: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutSecure, apiRequestWithoutCompnay: vi.fn(), getAuth: vi.fn(), SESSION_EXPIRED_KEY: 'ah.sessionExpired' }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: () => false }), useRoute: () => ({ query: {} }) }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import Login from '@/views/Authentication/Login/Login.vue';

const EMAIL = 'guest@example.com';
const PASSWORD = 'Password1!';
const charCodes = (str) => Array.from(str).map((c) => c.charCodeAt(0)).join(', ');

const mountLogin = () => mount(Login, {
    attachTo: document.body,
    global: {
        mocks: { $t: (key) => key },
        provide: { $axios: { post: vi.fn() } },
        stubs: { 'router-link': { template: '<a><slot /></a>' }, 'i18n-t': { template: '<p><slot /></p>' } },
    },
});

const everyStoredValue = () => [localStorage, sessionStorage]
    .flatMap((store) => Object.keys(store).map((key) => store.getItem(key)))
    .concat(document.cookie)
    .join('\n');

const expectNoPasswordStored = () => {
    const stored = everyStoredValue();
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(charCodes(PASSWORD));
};

const signIn = async (wrapper, { keepSignedIn }) => {
    await wrapper.find('#email').setValue(EMAIL);
    await wrapper.find('#password').setValue(PASSWORD);
    await wrapper.find('.auth__remember input[type="checkbox"]').setValue(keepSignedIn);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
};

describe('Login keep me signed in', () => {
    beforeEach(() => {
        apiRequestWithoutSecure.mockReset();
        apiRequestWithoutSecure.mockResolvedValue({ status: 200, data: { twoFactorRequired: true, tempToken: 'tmp' } });
        localStorage.clear();
        sessionStorage.clear();
    });

    it('remembers only the email when ticked, never the password', async () => {
        const wrapper = mountLogin();
        await signIn(wrapper, { keepSignedIn: true });

        expect(JSON.parse(localStorage.getItem('remember'))).toEqual({ email: EMAIL });
        expectNoPasswordStored();
        wrapper.unmount();
    });

    it('still sends the password to the server when ticked', async () => {
        const wrapper = mountLogin();
        await signIn(wrapper, { keepSignedIn: true });

        expect(apiRequestWithoutSecure).toHaveBeenCalledWith('post', expect.any(String), expect.objectContaining({ email: EMAIL, password: PASSWORD }));
        wrapper.unmount();
    });

    it('forgets the email when unticked', async () => {
        localStorage.setItem('remember', JSON.stringify({ email: EMAIL }));
        const wrapper = mountLogin();
        await flushPromises();
        await signIn(wrapper, { keepSignedIn: false });

        expect(localStorage.getItem('remember')).toBeNull();
        expectNoPasswordStored();
        wrapper.unmount();
    });

    it('prefills only the email from a remembered entry', async () => {
        localStorage.setItem('remember', JSON.stringify({ email: EMAIL }));
        const wrapper = mountLogin();
        await flushPromises();

        expect(wrapper.find('#email').element.value).toBe(EMAIL);
        expect(wrapper.find('#password').element.value).toBe('');
        expect(wrapper.find('.auth__remember input[type="checkbox"]').element.checked).toBe(true);
        wrapper.unmount();
    });

    it('scrubs the password from an entry saved by an older version, keeping the email', async () => {
        localStorage.setItem('remember', JSON.stringify({ email: EMAIL, password: charCodes(PASSWORD) }));
        const wrapper = mountLogin();
        await flushPromises();

        expect(JSON.parse(localStorage.getItem('remember'))).toEqual({ email: EMAIL });
        expectNoPasswordStored();
        expect(wrapper.find('#email').element.value).toBe(EMAIL);
        expect(wrapper.find('#password').element.value).toBe('');
        wrapper.unmount();
    });

    it('drops an unreadable or email-less entry entirely', async () => {
        localStorage.setItem('remember', JSON.stringify({ password: charCodes(PASSWORD) }));
        const wrapper = mountLogin();
        await flushPromises();

        expect(localStorage.getItem('remember')).toBeNull();
        expect(wrapper.find('#password').element.value).toBe('');
        wrapper.unmount();

        localStorage.setItem('remember', '{not json');
        const again = mountLogin();
        await flushPromises();
        expect(localStorage.getItem('remember')).toBeNull();
        again.unmount();
    });
});
