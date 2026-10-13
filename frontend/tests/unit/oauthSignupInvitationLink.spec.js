import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const COMPANY_ID = '6f0000000000000000000c01';
const INVITE_ID = '6f00000000000000000a0001';
const TOKEN = 'f00d'.repeat(16);
const EMAIL = 'invitee@example.test';

const { apiRequestWithoutSecure } = vi.hoisted(() => ({ apiRequestWithoutSecure: vi.fn() }));

vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useRoute: () => ({ query: {} }) }));
vi.mock('@/services', () => ({ apiRequestWithoutSecure, apiRequestWithoutCompnay: vi.fn(), getAuth: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import * as env from '@/config/env';
import ProviderButton from '@/plugins/oauth/ProviderButton.vue';

const INVITATION = { companyID: COMPANY_ID, companyUserDocID: INVITE_ID, linkId: TOKEN };
const mountButton = (props) => mount(ProviderButton, { props, global: { mocks: { $t: (key) => key } } });

const signupCalls = (url) => apiRequestWithoutSecure.mock.calls.filter(([, called]) => called === url).map(([, , payload]) => payload);

const originalLocation = window.location;
const pretendLocation = (search = '') => {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { href: `${originalLocation.origin}/${search}`, origin: originalLocation.origin, search },
    });
};

const PROVIDER_APIS = {
    github: {
        exchange: env.API_OAUTH_GITHUB,
        signup: env.API_SIGNUP_WITH_GITHUB,
        profile: (url) => (url.endsWith('/user/emails') ? [{ email: EMAIL, primary: true, verified: true }] : { id: 42, name: 'Ivy Invitee' }),
    },
    gitlab: {
        exchange: env.API_OAUTH_GITLAB,
        signup: env.API_SIGNUP_WITH_GITLAB,
        profile: () => ({ id: 43, name: 'Ivy Invitee', email: EMAIL }),
    },
};

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiRequestWithoutSecure.mockReset();
    apiRequestWithoutSecure.mockImplementation(async (method, url) => {
        if (url.endsWith('/access-token')) return { data: { accessToken: 'provider-token', id_token: googleIdToken() } };
        if (url === env.LOGIN) return new Promise(() => {});
        return { data: { status: true } };
    });
});

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.unstubAllGlobals();
    delete window.google;
});

describe.each(Object.keys(PROVIDER_APIS))('%s sign-up started from an invitation', (provider) => {
    const apis = PROVIDER_APIS[provider];

    const finishOnReturn = async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => apis.profile(url) })));
        pretendLocation('?code=provider-code');
        mountButton({ provider, mode: 'login' });
        await flushPromises();
    };

    it('carries the invitation link through the provider redirect into the signup', async () => {
        localStorage.setItem('companyId', COMPANY_ID);
        localStorage.setItem('companyUserDocID', INVITE_ID);
        pretendLocation();
        await mountButton({ provider, mode: 'register', ...INVITATION }).find('button').trigger('click');

        await finishOnReturn();

        expect(signupCalls(apis.signup)).toEqual([expect.objectContaining({
            assignCompany: COMPANY_ID, companyUserDocID: INVITE_ID, linkId: TOKEN,
        })]);
    });

    it('does not keep the link for a later sign-up in the same tab', async () => {
        pretendLocation();
        await mountButton({ provider, mode: 'register', ...INVITATION }).find('button').trigger('click');
        await finishOnReturn();
        apiRequestWithoutSecure.mockClear();

        pretendLocation();
        await mountButton({ provider, mode: 'register' }).find('button').trigger('click');
        await finishOnReturn();

        expect(signupCalls(apis.signup)).toHaveLength(1);
        expect(signupCalls(apis.signup)[0].linkId || '').toBe('');
    });
});

function googleIdToken() {
    const claims = { sub: '44', email: EMAIL, given_name: 'Ivy', family_name: 'Invitee' };
    return `header.${btoa(JSON.stringify(claims))}.signature`;
}

describe('google sign-up started from an invitation', () => {
    it('sends the invitation link with the signup', async () => {
        let codeClient;
        window.google = { accounts: { oauth2: { initCodeClient: vi.fn((config) => { codeClient = config; return { requestCode: vi.fn() }; }) } } };

        await mountButton({ provider: 'google', mode: 'register', ...INVITATION }).find('button').trigger('click');
        codeClient.callback({ code: 'google-code' });
        await flushPromises();

        expect(signupCalls(env.API_SIGNUP_WITH_GOOGLE)).toEqual([expect.objectContaining({
            assignCompany: COMPANY_ID, companyUserDocID: INVITE_ID, linkId: TOKEN,
        })]);
    });
});
