import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const USER_ID = '6f0000000000000000000009';
const COMPANY = '6f0000000000000000000c02';
const TRACKER_PATH = `/oauth2?code_challenge=${'c'.repeat(43)}&state=${'s'.repeat(32)}&scheme=alianhub-tracker`;
const EMAIL = 'tia.tracker@example.test';

const mocks = vi.hoisted(() => ({ secure: vi.fn(), company: vi.fn(), replace: vi.fn(), route: { query: {} } }));

vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: mocks.replace }), useRoute: () => mocks.route }));
vi.mock('@/services', () => ({ apiRequestWithoutSecure: mocks.secure, apiRequestWithoutCompnay: mocks.company, getAuth: vi.fn().mockResolvedValue({ status: true }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import * as env from '@/config/env';
import ProviderButton from '@/plugins/oauth/ProviderButton.vue';

const mountButton = (provider) => mount(ProviderButton, { props: { provider, mode: 'login' }, global: { mocks: { $t: (key) => key } } });

const originalLocation = window.location;
const pretendLocation = (search = '') => {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { href: `${originalLocation.origin}/${search}`, origin: originalLocation.origin, search, reload: vi.fn() },
    });
};

const PROFILES = {
    github: (url) => (url.endsWith('/user/emails') ? [{ email: EMAIL, primary: true, verified: true }] : { id: 42, name: 'Tia Tracker' }),
    gitlab: () => ({ id: 43, name: 'Tia Tracker', email: EMAIL }),
};

const googleIdToken = () => `header.${btoa(JSON.stringify({ sub: '44', email: EMAIL, given_name: 'Tia', family_name: 'Tracker' }))}.signature`;

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.route.query = { redirect_url: TRACKER_PATH };
    mocks.replace.mockReset().mockResolvedValue(undefined);
    mocks.secure.mockReset().mockImplementation(async (method, url) => {
        if (url.endsWith('/access-token')) return { data: { accessToken: 'provider-token', id_token: googleIdToken() } };
        if (url === env.LOGIN) return { status: 200, data: { uid: USER_ID } };
        return { data: { status: true } };
    });
    mocks.company.mockReset().mockImplementation(async (method, url) => (url === env.USER_AND_COMAPNY_CHECK
        ? { data: { status: true, data: { userData: { _id: USER_ID, isEmailVerified: true, AssignCompany: [COMPANY] }, companyId: COMPANY, isCompanyFind: true } } }
        : { status: 200, data: {} }));
});

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.unstubAllGlobals();
    delete window.google;
});

describe.each(Object.keys(PROFILES))('%s sign-in on the way to the desktop tracker', (provider) => {
    const signInThrough = async () => {
        pretendLocation();
        await mountButton(provider).find('button').trigger('click');
        mocks.route.query = { redirect_url: '/' };
        vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => PROFILES[provider](url) })));
        pretendLocation('?code=provider-code');
        mountButton(provider);
        await flushPromises();
    };

    it('goes on to the tracker page after the provider sends the browser back to the origin', async () => {
        await signInThrough();
        expect(mocks.replace).toHaveBeenCalledWith(TRACKER_PATH);
    });

    it('does not keep the path for a later sign-in in the same tab', async () => {
        await signInThrough();
        mocks.replace.mockClear();
        await signInThrough();
        expect(mocks.replace.mock.calls).toEqual([[`/${COMPANY}`]]);
    });
});

describe('google sign-in on the way to the desktop tracker', () => {
    it('goes on to the tracker page', async () => {
        pretendLocation();
        let codeClient;
        window.google = { accounts: { oauth2: { initCodeClient: vi.fn((config) => { codeClient = config; return { requestCode: vi.fn() }; }) } } };
        await mountButton('google').find('button').trigger('click');
        codeClient.callback({ code: 'google-code' });
        await flushPromises();
        expect(mocks.replace).toHaveBeenCalledWith(TRACKER_PATH);
    });
});
