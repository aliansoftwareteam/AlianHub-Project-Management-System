import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
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

const previewSays = (fields = {}) => ({
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
            stubs: { 'router-link': { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } },
        },
    });
    await flushPromises();
    return wrapper;
};

const buttonNamed = (wrapper, key) => wrapper.findAll('button').find((button) => button.text().includes(key));
const linkNamed = (wrapper, key) => wrapper.findAll('a').find((link) => link.text().includes(key));
const acceptCalls = () => mocks.apiRequestWithoutCompnay.mock.calls.filter((call) => call[1] === ACCEPT_URL);

describe('Invitation page for an invitee who may already have an account', () => {
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

    /* The page cannot know whether the address has an account: the preview never says, so an admin holding the link learns nothing. */
    it.each([
        ['says nothing about accounts', {}],
        ['carries a stray hasAccount: true', { hasAccount: true }],
        ['carries a stray hasAccount: false', { hasAccount: false }],
    ])('shows a signed-out visitor the sign-up form and a sign-in-to-accept line when the preview %s', async (_label, fields) => {
        const wrapper = await mountPage(previewSays(fields));

        expect(wrapper.find('#inv-name').exists()).toBe(true);
        expect(wrapper.find('#inv-email').text()).toBe(INVITED);
        const signIn = linkNamed(wrapper, 'Auth.invite_sign_in_to_accept');
        expect(signIn).toBeDefined();
        expect(JSON.parse(signIn.attributes('data-to'))).toEqual({ name: 'Log-in', query: { redirect_url: INVITATION_PATH } });
        expect(buttonNamed(wrapper, 'Auth.invite_accept')).toBeUndefined();
        expect(acceptCalls()).toHaveLength(0);
    });

    it('lets the invited account, once signed in, accept with one button and opens the workspace', async () => {
        signedInAs(' Ines.Invited@Example.TEST ');
        const wrapper = await mountPage(previewSays());

        expect(wrapper.find('#inv-name').exists()).toBe(false);

        await buttonNamed(wrapper, 'Auth.invite_accept').trigger('click');
        await flushPromises();

        expect(acceptCalls()).toEqual([['post', ACCEPT_URL, { companyId: COMPANY_ID, memberId: INVITE_ID, linkId: TOKEN }]]);
        expect(JSON.stringify(acceptCalls()[0][2])).not.toContain(USER_ID);
        expect(mocks.getAuth).toHaveBeenCalledWith(USER_ID);
        expect(localStorage.getItem('selectedCompany')).toBe(COMPANY_ID);
        expect(mocks.replace).toHaveBeenCalledWith(`/${COMPANY_ID}/welcome/connect-ai`);
        expect(reload).toHaveBeenCalled();
    });

    it('tells the app which workspace is open before it goes there, so a person with no workspace is not sent to name one', async () => {
        signedInAs(INVITED);
        const openCompany = ref('');
        let openWhenLeaving;
        mocks.replace.mockImplementation(async () => { openWhenLeaving = openCompany.value; });
        const wrapper = mount(Invitation, {
            global: {
                provide: { $axios: previewSays(), addSubscription: vi.fn(), $companyId: openCompany },
                stubs: { 'router-link': { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } },
            },
        });
        await flushPromises();

        await buttonNamed(wrapper, 'Auth.invite_accept').trigger('click');
        await flushPromises();

        expect(openWhenLeaving).toBe(COMPANY_ID);
    });

    it('leaves the app on the workspace it has open when the person already has one: the app changes workspace itself', async () => {
        signedInAs(INVITED);
        const openCompany = ref('own-company');
        const wrapper = mount(Invitation, {
            global: {
                provide: { $axios: previewSays(), addSubscription: vi.fn(), $companyId: openCompany },
                stubs: { 'router-link': { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } },
            },
        });
        await flushPromises();

        await buttonNamed(wrapper, 'Auth.invite_accept').trigger('click');
        await flushPromises();

        expect(openCompany.value).toBe('own-company');
        expect(mocks.replace).toHaveBeenCalledWith(`/${COMPANY_ID}/welcome/connect-ai`);
    });

    it('says plainly when signed in as another account, offers to switch, and never accepts', async () => {
        signedInAs('someone.else@example.test');
        const wrapper = await mountPage(previewSays());

        expect(wrapper.text()).toContain('Auth.invite_wrong_account_title');
        expect(wrapper.find('#inv-name').exists()).toBe(false);
        expect(buttonNamed(wrapper, 'Auth.invite_accept')).toBeUndefined();

        await buttonNamed(wrapper, 'Auth.invite_switch_account').trigger('click');
        await flushPromises();

        expect(mocks.logOut).toHaveBeenCalledWith({ islogOut: true });
        expect(acceptCalls()).toHaveLength(0);
    });

    it('stays on the page with a plain message when the invitation cannot be accepted', async () => {
        signedInAs(INVITED);
        mocks.apiRequestWithoutCompnay.mockImplementation(async (type) => {
            if (type === 'get') return { status: 200, data: { _id: USER_ID, Employee_Email: INVITED } };
            throw Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { status: false } } });
        });
        const wrapper = await mountPage(previewSays());

        await buttonNamed(wrapper, 'Auth.invite_accept').trigger('click');
        await flushPromises();

        expect(wrapper.find('.auth__banner').text()).toBe('Auth.invite_accept_failed');
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(localStorage.getItem('selectedCompany')).toBeNull();
    });

    it('says to try again, not to ask for a new link, when the server could not save the acceptance', async () => {
        signedInAs(INVITED);
        mocks.apiRequestWithoutCompnay.mockImplementation(async (type) => {
            if (type === 'get') return { status: 200, data: { _id: USER_ID, Employee_Email: INVITED } };
            throw Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: { status: false } } });
        });
        const wrapper = await mountPage(previewSays());

        await buttonNamed(wrapper, 'Auth.invite_accept').trigger('click');
        await flushPromises();

        expect(wrapper.find('.auth__banner').text()).toBe('Auth.server_error');
        expect(buttonNamed(wrapper, 'Auth.invite_accept').attributes('disabled')).toBeUndefined();
        expect(mocks.replace).not.toHaveBeenCalled();
    });
});

describe('the sign-up form on the invitation page', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        localStorage.clear();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => vi.useRealTimers());

    it('starts in the name box as it is drawn, and leaves the person in the box they moved to', async () => {
        const wrapper = mount(Invitation, {
            attachTo: document.body,
            global: { provide: { $axios: previewSays(), addSubscription: vi.fn() }, stubs: { 'router-link': true } },
        });
        await flushPromises();
        expect(document.activeElement).toBe(wrapper.find('#inv-name').element);

        wrapper.find('#inv-password').element.focus();
        await vi.advanceTimersByTimeAsync(1000);
        expect(document.activeElement).toBe(wrapper.find('#inv-password').element);
        wrapper.unmount();
    });
});
