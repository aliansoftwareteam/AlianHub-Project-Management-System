import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const COMPANY_ID = '6f0000000000000000000c01';
const INVITE_ID = '6f00000000000000000a0001';
const USER_ID = '6f0000000000000000000009';
const TOKEN = 'a'.repeat(64);
const INVITED = 'ines.invited@example.test';
const ACCEPT_URL = '/api/v2/auth/invitation-accept';
const INVITATION_PATH = `/invitation?companyId=${COMPANY_ID}-${INVITE_ID}&token=${TOKEN}`;

const mocks = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    apiRequestWithoutSecure: vi.fn(),
    getAuth: vi.fn(),
    logOut: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
}));

vi.mock('@/services', () => ({
    apiRequest: mocks.apiRequest,
    apiRequestWithoutCompnay: mocks.apiRequestWithoutCompnay,
    apiRequestWithoutSecure: mocks.apiRequestWithoutSecure,
    getAuth: mocks.getAuth,
    useAuth: () => ({ logOut: mocks.logOut }),
}));
vi.mock('vue-router', () => ({
    useRoute: () => ({ query: { companyId: `${COMPANY_ID}-${INVITE_ID}`, token: TOKEN }, fullPath: INVITATION_PATH }),
    useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/config/publicConfig', () => ({ enabledProviders: () => [] }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ debouncerWithPromise: () => Promise.resolve() }) }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', async () => {
    const { h } = await import('vue');
    return { default: { name: 'AuthShell', setup: (props, { slots }) => () => h('div', slots.default && slots.default()) } };
});

import * as env from '@/config/env';
import Invitation from '@/views/Authentication/Invitation/Invitation.vue';

const previewSays = (fields) => ({
    post: vi.fn(async () => ({ data: { status: true, data: { status: 1, email: INVITED, workspaceName: 'Acme', ...fields } } })),
});

const signedInAs = (email) => {
    localStorage.setItem('userId', USER_ID);
    mocks.apiRequestWithoutCompnay.mockImplementation(async (type, url) => {
        if (type === 'get' && url === `${env.USER_UPATE}/${USER_ID}`) return { status: 200, data: { _id: USER_ID, Employee_Email: email } };
        if (type === 'post' && url === ACCEPT_URL) return { status: 200, data: { status: true, companyId: COMPANY_ID } };
        throw new Error(`unexpected ${type} ${url}`);
    });
};

const mountPage = async ($axios) => {
    const wrapper = mount(Invitation, {
        global: {
            provide: { $axios, addSubscription: vi.fn() },
            stubs: { 'router-link': { template: '<a><slot /></a>' } },
        },
    });
    await flushPromises();
    return wrapper;
};

const buttonNamed = (wrapper, key) => wrapper.findAll('button').find((button) => button.text().includes(key));
const acceptCalls = () => mocks.apiRequestWithoutCompnay.mock.calls.filter((call) => call[1] === ACCEPT_URL);

describe('Invitation page for an address that already has an account', () => {
    let reload;

    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        localStorage.clear();
        mocks.apiRequestWithoutCompnay.mockImplementation(async (type, url) => { throw new Error(`unexpected ${type} ${url}`); });
        mocks.getAuth.mockResolvedValue({ status: true });
        mocks.replace.mockResolvedValue(undefined);
        reload = vi.fn();
        vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('asks a signed-out invitee to sign in to accept, not to sign up', async () => {
        const wrapper = await mountPage(previewSays({ hasAccount: true }));

        expect(wrapper.find('#inv-name').exists()).toBe(false);
        expect(wrapper.find('#inv-password').exists()).toBe(false);
        expect(wrapper.text()).toContain('Auth.invite_have_account_title');
        expect(wrapper.text()).toContain(INVITED);

        await buttonNamed(wrapper, 'Auth.invite_sign_in_to_accept').trigger('click');

        expect(mocks.push).toHaveBeenCalledWith({ name: 'Log-in', query: { redirect_url: INVITATION_PATH } });
        expect(acceptCalls()).toHaveLength(0);
    });

    it('still offers sign-up to a signed-out invitee whose address has no account', async () => {
        const wrapper = await mountPage(previewSays({ hasAccount: false }));

        expect(wrapper.find('#inv-name').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Auth.invite_have_account_title');
    });

    it('lets the invited account, once signed in, accept with one button and opens the workspace', async () => {
        signedInAs(' Ines.Invited@Example.TEST ');
        const wrapper = await mountPage(previewSays({ hasAccount: true }));

        expect(wrapper.find('#inv-name').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Auth.invite_have_account_title');

        await buttonNamed(wrapper, 'Auth.invite_accept').trigger('click');
        await flushPromises();

        expect(acceptCalls()).toEqual([['post', ACCEPT_URL, { companyId: COMPANY_ID, memberId: INVITE_ID, linkId: TOKEN }]]);
        expect(JSON.stringify(acceptCalls()[0][2])).not.toContain(USER_ID);
        expect(mocks.getAuth).toHaveBeenCalledWith(USER_ID);
        expect(localStorage.getItem('selectedCompany')).toBe(COMPANY_ID);
        expect(mocks.replace).toHaveBeenCalledWith(`/${COMPANY_ID}`);
        expect(reload).toHaveBeenCalled();
    });

    it('says plainly when signed in as another account, offers to switch, and never accepts', async () => {
        signedInAs('someone.else@example.test');
        const wrapper = await mountPage(previewSays({ hasAccount: true }));

        expect(wrapper.text()).toContain('Auth.invite_wrong_account_title');
        expect(wrapper.find('#inv-name').exists()).toBe(false);
        expect(buttonNamed(wrapper, 'Auth.invite_accept')).toBeUndefined();

        await buttonNamed(wrapper, 'Auth.invite_switch_account').trigger('click');
        await flushPromises();

        expect(mocks.logOut).toHaveBeenCalledWith({ islogOut: true });
        expect(acceptCalls()).toHaveLength(0);
    });

    it('does not offer sign-up to a signed-in account when the invited address has none yet', async () => {
        signedInAs('someone.else@example.test');
        const wrapper = await mountPage(previewSays({ hasAccount: false }));

        expect(wrapper.text()).toContain('Auth.invite_wrong_account_title');
        expect(wrapper.find('#inv-name').exists()).toBe(false);
    });

    it('stays on the page with a plain message when the invitation cannot be accepted', async () => {
        signedInAs(INVITED);
        mocks.apiRequestWithoutCompnay.mockImplementation(async (type) => {
            if (type === 'get') return { status: 200, data: { _id: USER_ID, Employee_Email: INVITED } };
            throw Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { status: false } } });
        });
        const wrapper = await mountPage(previewSays({ hasAccount: true }));

        await buttonNamed(wrapper, 'Auth.invite_accept').trigger('click');
        await flushPromises();

        expect(wrapper.find('.auth__banner').text()).toBe('Auth.invite_accept_failed');
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(localStorage.getItem('selectedCompany')).toBeNull();
    });
});
