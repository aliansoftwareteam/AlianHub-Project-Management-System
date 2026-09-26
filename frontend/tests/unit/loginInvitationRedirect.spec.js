import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const USER_ID = '6f0000000000000000000009';
const HOME_COMPANY = '6f0000000000000000000c02';
const OTHER_COMPANY = '6f0000000000000000000c03';
const INVITATION_PATH = '/invitation?companyId=6f0000000000000000000c01-6f00000000000000000a0001&token=abc';

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

const signInWith = async (redirectUrl) => {
    mocks.route.query = { redirect_url: redirectUrl };
    const wrapper = mount(Login, {
        global: {
            provide: { $axios: { post: vi.fn() } },
            stubs: { 'router-link': { template: '<a><slot /></a>' }, 'i18n-t': { template: '<p><slot /></p>' } },
        },
    });
    await wrapper.find('#email').setValue('ines.invited@example.test');
    await wrapper.find('#password').setValue('Password1!');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    return wrapper;
};

describe('signing in on the way to an invitation', () => {
    let reload;

    beforeEach(() => {
        Object.values(mocks).forEach((mock) => typeof mock === 'function' && mock.mockReset());
        localStorage.clear();
        mocks.apiRequestWithoutSecure.mockResolvedValue({ status: 200, data: { uid: USER_ID } });
        mocks.apiRequestWithoutCompnay.mockImplementation(async (type, url) => {
            if (url === env.USER_AND_COMAPNY_CHECK) {
                return {
                    data: {
                        status: true,
                        data: {
                            userData: { _id: USER_ID, isEmailVerified: true, AssignCompany: [HOME_COMPANY, OTHER_COMPANY] },
                            companyId: HOME_COMPANY,
                            isCompanyFind: true,
                            companies: [{ _id: HOME_COMPANY, Cst_CompanyName: 'Home' }, { _id: OTHER_COMPANY, Cst_CompanyName: 'Other' }],
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

    it('goes back to the invitation after signing in, without asking for a workspace first', async () => {
        const wrapper = await signInWith(INVITATION_PATH);

        expect(wrapper.text()).not.toContain('Auth.choose_workspace');
        expect(mocks.replace).toHaveBeenCalledWith(INVITATION_PATH);
        expect(reload).toHaveBeenCalled();
    });

    it('still sends any other redirect outside the account\'s workspaces home', async () => {
        localStorage.setItem('selectedCompany', HOME_COMPANY);
        await signInWith('/6f0000000000000000000c09/project');

        expect(mocks.replace).toHaveBeenCalledWith(`/${HOME_COMPANY}`);
    });
});
