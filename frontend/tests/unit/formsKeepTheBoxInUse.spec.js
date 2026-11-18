/* A form puts focus in its first box as it is drawn. A timer that does it a moment later moves a person who has
   already gone on to the next box back to the first, and what they type next lands in the wrong one. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, apiRequestWithoutCompnay, apiRequestWithoutSecure } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    apiRequestWithoutSecure: vi.fn(),
}));

vi.mock('@/services', () => ({
    apiRequest, apiRequestWithoutCompnay, apiRequestWithoutSecure,
    getAuth: vi.fn(), useAuth: () => ({ logOut: vi.fn() }), SESSION_EXPIRED_KEY: 'ah.sessionExpired',
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ makeUniqueId: () => 'abc', debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: () => ({}) }),
}));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(() => Promise.resolve()), hasRoute: () => false }),
    useRoute: () => ({ query: {}, params: { token: 'reset-token' } }),
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'settings/companies': [] }, commit: vi.fn() }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key, te: () => false }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => ({ default: { name: 'SpinnerComp', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot name="top-right" /><slot /></div>' } }));

import NewPasswordCard from '@/views/Authentication/ResetPassword/NewPasswordCard.vue';
import CreateCompany from '@/views/Company/CreateCompany.vue';
import Login from '@/views/Authentication/Login/Login.vue';
import TwoFactorAuth from '@/views/Settings/TwoFactorAuth/TwoFactorAuth.vue';
import { setFocus } from '@/components/molecules/Setting/helper';

const LONGER_THAN_ANY_FOCUS_TIMER = 1000;
const global = {
    mocks: { $t: (key) => key },
    provide: { $userId: ref(''), $companyId: ref('c1'), $axios: { post: vi.fn() } },
    stubs: { 'router-link': { template: '<a><slot /></a>' }, 'i18n-t': { template: '<p><slot /></p>' } },
};

let wrapper;
const box = (selector) => wrapper.find(selector).element;
const focused = () => document.activeElement;
const laterOn = async () => {
    vi.advanceTimersByTime(LONGER_THAN_ANY_FOCUS_TIMER);
    await flushPromises();
};

const openNewPassword = async () => {
    apiRequestWithoutSecure.mockResolvedValue({ data: { data: { _id: 'user-1' } } });
    wrapper = mount(NewPasswordCard, { attachTo: document.body, props: { title: 'a', submitLabel: 'b', successToast: 'c' }, global });
    await flushPromises();
};
const openCreateCompany = async () => {
    localStorage.setItem('userId', 'user-1');
    apiRequestWithoutCompnay.mockResolvedValue({ data: { Employee_Email: 'sia@example.test' } });
    wrapper = mount(CreateCompany, { attachTo: document.body, global });
    await flushPromises();
};
const openSignInCode = async () => {
    apiRequestWithoutSecure.mockResolvedValue({ status: 200, data: { twoFactorRequired: true, tempToken: 'tmp' } });
    wrapper = mount(Login, { attachTo: document.body, global });
    await wrapper.find('#email').setValue('guest@example.com');
    await wrapper.find('#password').setValue('Password1!');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
};
const openTwoStepSetup = async () => {
    apiRequest.mockImplementation((method) => Promise.resolve({ data: { data: method === 'get' ? { enabled: false } : { otpauthUrl: 'otpauth://x', qrDataUrl: '', secret: 'ABCDEFGH' } } }));
    wrapper = mount(TwoFactorAuth, { attachTo: document.body, global });
    await flushPromises();
    await wrapper.find('button.ah-btn--primary').trigger('click');
    await flushPromises();
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    [apiRequest, apiRequestWithoutCompnay, apiRequestWithoutSecure].forEach((mock) => mock.mockReset());
});
afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe.each([
    ['the new password form', openNewPassword, '#np-password', '#np-confirm'],
    ['the new workspace form', openCreateCompany, '#ws-name', 'form button'],
    ['the sign-in code boxes', openSignInCode, '.auth__code input:nth-of-type(1)', '.auth__code input:nth-of-type(2)'],
    ['the two-step setup code boxes', openTwoStepSetup, '.tfa__digit:nth-of-type(1)', '.tfa__digit:nth-of-type(2)'],
])('%s', (_name, open, first, next) => {
    it('has focus in its first box as soon as it is drawn', async () => {
        await open();
        expect(focused()).toBe(box(first));
    });

    it('leaves a person in the box they went on to', async () => {
        await open();
        box(next).focus();
        await laterOn();
        expect(focused()).toBe(box(next));
    });
});

describe('the company address, where choosing a country goes on to the state', () => {
    const INDIA = { name: 'India', isoCode: 'IN' };
    let form;

    beforeEach(() => {
        form = document.createElement('form');
        form.innerHTML = '<input id="refCountry" readonly><input id="refState" readonly><input id="refCity"><input id="zip">';
        document.body.appendChild(form);
    });

    const chooseCountry = () => {
        const address = setFocus();
        address.setfocus('country');
        address.getSubSidebarData(INDIA);
        return address;
    };

    it('goes on to the state when the person is in no other box', async () => {
        form.querySelector('#refCountry').focus();
        chooseCountry();
        await laterOn();
        expect(focused()).toBe(form.querySelector('#refState'));
    });

    it('leaves a person who went on to type in another box where they are', async () => {
        chooseCountry();
        form.querySelector('#zip').focus();
        await laterOn();
        expect(focused()).toBe(form.querySelector('#zip'));
    });

    it('goes on from the state to the city only for a person in no other box', async () => {
        const address = chooseCountry();
        await laterOn();
        address.getSubSidebarData({ name: 'Gujarat', isoCode: 'GJ', countryCode: 'IN' });
        form.querySelector('#zip').focus();
        await laterOn();
        expect(focused()).toBe(form.querySelector('#zip'));
    });
});
