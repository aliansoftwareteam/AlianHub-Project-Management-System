import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { flushPromises, mount } from '@vue/test-utils';

const USER_ID = '6f0000000000000000000009';
const SSO_COMPANY = '6f0000000000000000000c02';
const OTHER_COMPANY = '6f0000000000000000000c03';
const STRANGER_COMPANY = '6f0000000000000000000c09';

const mocks = vi.hoisted(() => ({
    apiRequestWithoutSecure: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    getAuth: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    route: { query: {} },
}));

vi.mock('@/services', () => ({
    apiRequestWithoutSecure: mocks.apiRequestWithoutSecure,
    apiRequestWithoutCompnay: mocks.apiRequestWithoutCompnay,
    getAuth: mocks.getAuth,
    SESSION_EXPIRED_KEY: 'ah.sessionExpired',
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace, hasRoute: () => false }), useRoute: () => mocks.route }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import * as env from '@/config/env';
import { isSignInLanding } from '@/router/sessionCheck';
import Login from '@/views/Authentication/Login/Login.vue';

const landFromSso = async (query) => {
    mocks.route.query = query;
    const wrapper = mount(Login, {
        global: {
            provide: { $axios: { post: vi.fn() } },
            stubs: { 'router-link': { template: '<a><slot /></a>' }, 'i18n-t': { template: '<p><slot /></p>' } },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('landing on the sign-in page after single sign-on', () => {
    let reload;

    beforeEach(() => {
        Object.values(mocks).forEach((mock) => typeof mock === 'function' && mock.mockReset());
        localStorage.clear();
        mocks.apiRequestWithoutCompnay.mockImplementation(async (type, url) => {
            if (url === env.USER_AND_COMAPNY_CHECK) {
                return {
                    data: {
                        status: true,
                        data: {
                            userData: { _id: USER_ID, isEmailVerified: true, AssignCompany: [OTHER_COMPANY, SSO_COMPANY] },
                            companyId: OTHER_COMPANY,
                            isCompanyFind: true,
                            companies: [{ _id: OTHER_COMPANY, Cst_CompanyName: 'Other' }, { _id: SSO_COMPANY, Cst_CompanyName: 'Acme' }],
                        },
                    },
                };
            }
            return { status: 200, data: {} };
        });
        mocks.getAuth.mockResolvedValue({ status: true });
        mocks.replace.mockResolvedValue(undefined);
        reload = vi.fn();
        vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('signs the person in and opens the workspace whose identity provider they used, without asking for one', async () => {
        const wrapper = await landFromSso({ sso: 'ok', uid: USER_ID, workspace: SSO_COMPANY });

        expect(localStorage.getItem('userId')).toBe(USER_ID);
        expect(localStorage.getItem('selectedCompany')).toBe(SSO_COMPANY);
        expect(wrapper.text()).not.toContain('Auth.choose_workspace');
        expect(mocks.replace).toHaveBeenCalledWith(`/${SSO_COMPANY}`);
        expect(reload).toHaveBeenCalled();
    });

    it('opens that workspace even when another one was open last time', async () => {
        localStorage.setItem('selectedCompany', OTHER_COMPANY);

        await landFromSso({ sso: 'ok', uid: USER_ID, workspace: SSO_COMPANY });

        expect(localStorage.getItem('selectedCompany')).toBe(SSO_COMPANY);
        expect(mocks.replace).toHaveBeenCalledWith(`/${SSO_COMPANY}`);
    });

    it('opens the page the person was on their way to', async () => {
        const deepLink = `/${SSO_COMPANY}/project/p1/list`;

        await landFromSso({ sso: 'ok', uid: USER_ID, workspace: SSO_COMPANY, redirect_url: deepLink });

        expect(localStorage.getItem('selectedCompany')).toBe(SSO_COMPANY);
        expect(mocks.replace).toHaveBeenCalledWith(deepLink);
        expect(reload).toHaveBeenCalled();
    });

    it('opens the workspace instead of a page in a workspace the account is not in', async () => {
        await landFromSso({ sso: 'ok', uid: USER_ID, workspace: SSO_COMPANY, redirect_url: `/${STRANGER_COMPANY}/project/p1/list` });

        expect(mocks.replace).toHaveBeenCalledWith(`/${SSO_COMPANY}`);
    });

    it('asks which workspace to open when the account does not belong to the one named', async () => {
        const wrapper = await landFromSso({ sso: 'ok', uid: USER_ID, workspace: STRANGER_COMPANY });

        expect(wrapper.text()).toContain('Auth.choose_workspace');
        expect(localStorage.getItem('selectedCompany')).toBeNull();
        expect(reload).not.toHaveBeenCalled();
    });

    it('says single sign-on failed when the session cannot be read', async () => {
        mocks.apiRequestWithoutCompnay.mockRejectedValue(new Error('forbidden'));

        const wrapper = await landFromSso({ sso: 'ok', uid: USER_ID, workspace: SSO_COMPANY });

        expect(wrapper.text()).toContain('Auth.sso_failed');
        expect(reload).not.toHaveBeenCalled();
    });

    it.each([
        ['not_allowed', 'Auth.sso_not_allowed'],
        ['seat_limit', 'Plan.refused.seat_limit'],
        ['config', 'Auth.sso_not_configured'],
        ['state', 'Auth.sso_failed'],
    ])('says why single sign-on stopped when it comes back with %s', async (reason, message) => {
        const wrapper = await landFromSso({ ssoError: reason });

        expect(wrapper.text()).toContain(message);
        expect(mocks.apiRequestWithoutCompnay).not.toHaveBeenCalled();
    });
});

describe('the router on a sign-in landing', () => {
    it.each([
        [{ sso: 'ok', uid: USER_ID, workspace: SSO_COMPANY }, true],
        [{ magic: 'ok', uid: USER_ID }, true],
        [{ sso: 'ok' }, false],
        [{ ssoError: 'not_allowed' }, false],
        [{}, false],
    ])('treats the login page with %o as a landing: %s', (query, landing) => {
        expect(isSignInLanding({ name: 'Log-in', query })).toBe(landing);
    });

    it('treats no other page as a landing', () => {
        expect(isSignInLanding({ name: 'Home', query: { sso: 'ok', uid: USER_ID } })).toBe(false);
    });

    it('lets a landing reach the sign-in page before it asks who this browser last signed in as', () => {
        const guard = fs.readFileSync(path.resolve(__dirname, '../../src/router/index.js'), 'utf8');
        const landing = guard.indexOf('if (isSignInLanding(to))');

        expect(landing).toBeGreaterThan(-1);
        expect(landing).toBeLessThan(guard.indexOf('readSessionUser(localUserId'));
    });
});
