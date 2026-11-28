import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const USER_ID = '6f0000000000000000000009';
const HOME_COMPANY = '6f0000000000000000000c02';
const OTHER_COMPANY = '6f0000000000000000000c03';
const TRACKER_PATH = `/oauth2?code_challenge=${'c'.repeat(43)}&state=${'s'.repeat(32)}&scheme=alianhub-tracker`;

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
import Login from '@/views/Authentication/Login/Login.vue';
import { returnsInto } from '@/utils/loginReturn';

const signInWith = async (redirectUrl) => {
    mocks.route.query = { redirect_url: redirectUrl };
    const wrapper = mount(Login, {
        global: {
            provide: { $axios: { post: vi.fn() } },
            stubs: { 'router-link': { template: '<a><slot /></a>' }, 'i18n-t': { template: '<p><slot /></p>' } },
        },
    });
    await wrapper.find('#email').setValue('tia.tracker@example.test');
    await wrapper.find('#password').setValue('Password1!');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    return wrapper;
};

describe('where a sign-in may return to', () => {
    it('is the tracker page or a workspace of the account, with or without a query', () => {
        ['/oauth2', TRACKER_PATH, `/${HOME_COMPANY}`, `/${HOME_COMPANY}/project`, `/${HOME_COMPANY}?tab=list`].forEach((path) => {
            expect(returnsInto(path, [HOME_COMPANY])).toBe(true);
        });
    });

    it('is nowhere else', () => {
        ['', '/', undefined, '//oauth2', '/oauth2x?state=1', '/login?next=/oauth2', 'https://evil.example/oauth2', `/${OTHER_COMPANY}?x=/${HOME_COMPANY}`].forEach((path) => {
            expect(returnsInto(path, [HOME_COMPANY])).toBe(false);
        });
        expect(returnsInto(`/${HOME_COMPANY}`, undefined)).toBe(false);
    });
});

describe('signing in on the way to the desktop tracker', () => {
    let reload;
    let companies;

    beforeEach(() => {
        Object.values(mocks).forEach((mock) => typeof mock === 'function' && mock.mockReset());
        localStorage.clear();
        companies = [{ _id: HOME_COMPANY, Cst_CompanyName: 'Home' }];
        mocks.apiRequestWithoutSecure.mockResolvedValue({ status: 200, data: { uid: USER_ID } });
        mocks.apiRequestWithoutCompnay.mockImplementation(async (type, url) => (url === env.USER_AND_COMAPNY_CHECK
            ? { data: { status: true, data: { userData: { _id: USER_ID, isEmailVerified: true, AssignCompany: companies.map((c) => c._id) }, companyId: HOME_COMPANY, isCompanyFind: true, companies } } }
            : { status: 200, data: {} }));
        mocks.getAuth.mockResolvedValue({ status: true });
        mocks.replace.mockResolvedValue(undefined);
        reload = vi.fn();
        vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('goes on to the tracker page with the challenge and state it was opened with', async () => {
        await signInWith(TRACKER_PATH);

        expect(mocks.replace).toHaveBeenCalledWith(TRACKER_PATH);
        expect(reload).toHaveBeenCalled();
    });

    it('goes on after choosing between several workspaces', async () => {
        companies = [...companies, { _id: OTHER_COMPANY, Cst_CompanyName: 'Other' }];
        const wrapper = await signInWith(TRACKER_PATH);
        expect(mocks.replace).not.toHaveBeenCalled();

        await wrapper.findAll('button').find((button) => button.text().includes('Other')).trigger('click');
        await flushPromises();

        expect(mocks.replace).toHaveBeenCalledWith(TRACKER_PATH);
        expect(localStorage.getItem('selectedCompany')).toBe(OTHER_COMPANY);
    });

    it('does not follow a path that only starts like the tracker page', async () => {
        await signInWith('/oauth2x?state=1');

        expect(mocks.replace).toHaveBeenCalledWith(`/${HOME_COMPANY}`);
    });
});
