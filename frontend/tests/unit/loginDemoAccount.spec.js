import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

const BRAND = 'brandSettingTab/brandSettings';
const DEMO = { demoMode: true, demoEmail: 'demo@alianhub.test', demoPassword: 'Demo-Passw0rd!' };

const mocks = vi.hoisted(() => ({
    apiRequestWithoutSecure: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    getAuth: vi.fn(),
    store: { getters: {} },
}));

vi.mock('@/services', () => ({
    apiRequestWithoutSecure: mocks.apiRequestWithoutSecure,
    apiRequestWithoutCompnay: mocks.apiRequestWithoutCompnay,
    getAuth: mocks.getAuth,
    SESSION_EXPIRED_KEY: 'ah.sessionExpired',
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: () => false }), useRoute: () => ({ query: {} }) }));
vi.mock('vuex', () => ({ useStore: () => mocks.store }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import * as env from '@/config/env';
import Login from '@/views/Authentication/Login/Login.vue';

const openLogin = (brand) => {
    mocks.store.getters = reactive({ [BRAND]: brand });
    return mount(Login, {
        global: {
            provide: { $axios: { post: vi.fn() } },
            stubs: { 'router-link': { template: '<a><slot /></a>' }, 'i18n-t': { template: '<p><slot /></p>' } },
        },
    });
};
const brandArrives = async (brand) => {
    mocks.store.getters[BRAND] = brand;
    await nextTick();
};
const fields = (wrapper) => ({ email: wrapper.find('#email').element.value, password: wrapper.find('#password').element.value });
const demoButton = (wrapper) => wrapper.find('[data-test="try-demo"]');
const loginCalls = () => mocks.apiRequestWithoutSecure.mock.calls.filter(([, url]) => url === env.LOGIN).map(([, , body]) => body);

describe('the login page on a demo instance', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => typeof mock === 'function' && mock.mockReset());
        localStorage.clear();
        mocks.apiRequestWithoutSecure.mockReturnValue(new Promise(() => {}));
    });

    describe('filling in the form', () => {
        it('fills in the demo account when brand settings arrive after the page opens', async () => {
            const wrapper = openLogin({});
            expect(fields(wrapper)).toEqual({ email: '', password: '' });

            await brandArrives(DEMO);

            expect(fields(wrapper)).toEqual({ email: 'demo@alianhub.test', password: 'Demo-Passw0rd!' });
            expect(wrapper.find('#password').attributes('type')).toBe('password');
        });

        it('fills in the demo account when brand settings are already loaded', async () => {
            const wrapper = openLogin(DEMO);
            await nextTick();

            expect(fields(wrapper)).toEqual({ email: 'demo@alianhub.test', password: 'Demo-Passw0rd!' });
        });

        it('fills in only the email when no demo password is set', async () => {
            const wrapper = openLogin({ ...DEMO, demoPassword: '' });
            await nextTick();

            expect(fields(wrapper)).toEqual({ email: 'demo@alianhub.test', password: '' });
        });

        it('leaves the form empty when demo mode is off', async () => {
            const wrapper = openLogin({});
            await brandArrives({ demoMode: false });

            expect(fields(wrapper)).toEqual({ email: '', password: '' });
        });

        it('keeps a remembered email that is not the demo one, without the demo password', async () => {
            localStorage.setItem('remember', JSON.stringify({ email: 'me@example.test' }));
            const wrapper = openLogin({});
            await brandArrives(DEMO);

            expect(fields(wrapper)).toEqual({ email: 'me@example.test', password: '' });
            expect(wrapper.find('.auth__remember input').element.checked).toBe(true);
        });

        it('gives a remembered demo email its password, whatever the case of DEMO_EMAIL', async () => {
            localStorage.setItem('remember', JSON.stringify({ email: 'demo@alianhub.test' }));
            const wrapper = openLogin({});
            await brandArrives({ ...DEMO, demoEmail: 'Demo@AlianHub.test' });

            expect(fields(wrapper)).toEqual({ email: 'demo@alianhub.test', password: 'Demo-Passw0rd!' });
        });

        it('never overwrites what the visitor typed before brand settings arrived', async () => {
            const wrapper = openLogin({});
            await wrapper.find('#email').setValue('typed@example.test');
            await brandArrives(DEMO);

            expect(fields(wrapper)).toEqual({ email: 'typed@example.test', password: '' });
        });

        it('fills in only once, so later brand updates leave edited fields alone', async () => {
            const wrapper = openLogin(DEMO);
            await nextTick();
            await wrapper.find('#email').setValue('');
            await wrapper.find('#password').setValue('');
            await brandArrives({ ...DEMO });

            expect(fields(wrapper)).toEqual({ email: '', password: '' });
        });
    });

    describe('the Try the demo button', () => {
        it('is shown when demo mode has both an email and a password', async () => {
            const wrapper = openLogin({});
            expect(demoButton(wrapper).exists()).toBe(false);

            await brandArrives(DEMO);

            expect(demoButton(wrapper).exists()).toBe(true);
            expect(demoButton(wrapper).text()).toBe('Demo.try_demo');
            expect(demoButton(wrapper).attributes('type')).toBe('button');
        });

        it.each([
            ['demo mode is off', { ...DEMO, demoMode: false }],
            ['the demo email is empty', { ...DEMO, demoEmail: '' }],
            ['the demo password is empty', { ...DEMO, demoPassword: '' }],
        ])('is hidden when %s', async (_, brand) => {
            const wrapper = openLogin(brand);
            await nextTick();

            expect(demoButton(wrapper).exists()).toBe(false);
        });

        it('signs into the demo account in one click, even after the fields were changed', async () => {
            const wrapper = openLogin(DEMO);
            await nextTick();
            await wrapper.find('#email').setValue('someone@example.test');
            await wrapper.find('#password').setValue('');

            await demoButton(wrapper).trigger('click');
            await flushPromises();

            expect(loginCalls()).toEqual([{ email: 'demo@alianhub.test', password: 'Demo-Passw0rd!', isLoginType: 'frontend' }]);
            expect(fields(wrapper)).toEqual({ email: 'demo@alianhub.test', password: 'Demo-Passw0rd!' });
        });

        it('is disabled while the sign-in is running', async () => {
            const wrapper = openLogin(DEMO);
            await nextTick();

            await demoButton(wrapper).trigger('click');
            await flushPromises();

            expect(demoButton(wrapper).attributes('disabled')).toBeDefined();
        });

        it('leaves submitting the form to Sign in, with what is in the fields', async () => {
            const wrapper = openLogin(DEMO);
            await nextTick();
            await wrapper.find('#email').setValue('someone@example.test');
            await wrapper.find('#password').setValue('Own-Passw0rd!');

            await wrapper.find('form').trigger('submit');
            await flushPromises();

            expect(loginCalls()).toEqual([{ email: 'someone@example.test', password: 'Own-Passw0rd!', isLoginType: 'frontend' }]);
        });
    });
});
