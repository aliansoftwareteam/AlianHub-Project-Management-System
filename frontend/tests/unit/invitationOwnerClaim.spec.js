import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const COMPANY_ID = '6f0000000000000000000c01';
const INVITE_ID = '6f00000000000000000a0001';
const USER_ID = '6f0000000000000000000009';

const mocks = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    apiRequestWithoutSecure: vi.fn(),
    getAuth: vi.fn(),
    logOut: vi.fn(),
    push: vi.fn(),
}));

vi.mock('@/services', () => ({
    apiRequest: mocks.apiRequest,
    apiRequestWithoutCompnay: mocks.apiRequestWithoutCompnay,
    apiRequestWithoutSecure: mocks.apiRequestWithoutSecure,
    getAuth: mocks.getAuth,
    useAuth: () => ({ logOut: mocks.logOut }),
}));
vi.mock('vue-router', () => ({
    useRoute: () => ({ query: { companyId: `${COMPANY_ID}-${INVITE_ID}` } }),
    useRouter: () => ({ push: mocks.push }),
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

// POST /api/v2/createUser answers with the saved user under statusText and no data (Modules/Auth/controller/createUser.js).
const CREATE_USER_RESPONSE = { data: { status: true, statusText: { _id: USER_ID, Employee_Email: 'new.owner@example.test', AssignCompany: [COMPANY_ID] } } };
const LOGIN_RESPONSE = { status: 200, data: { uid: USER_ID, accessToken: 'token', refreshToken: 'refresh' } };
const acceptedRow = (roleType) => ({ data: { status: true, statusText: 'Invitation accepted.', data: { _id: INVITE_ID, userId: USER_ID, roleType, status: 2 } } });

const submitInvitation = async (roleType) => {
    mocks.apiRequestWithoutSecure.mockResolvedValue(LOGIN_RESPONSE);
    mocks.apiRequestWithoutCompnay.mockImplementation(async (type, url) => {
        if (url === env.CREATE_USER_V2) return CREATE_USER_RESPONSE;
        if (url === env.API_ROOT_MEMBERS) return acceptedRow(roleType);
        if (url === env.COMPANYINVITATION) return { data: { _id: COMPANY_ID } };
        throw new Error(`unexpected ${type} ${url}`);
    });
    const $axios = { post: vi.fn(async () => ({ data: { status: true, data: { status: 1, email: 'new.owner@example.test', workspaceName: 'Acme' } } })) };
    const wrapper = mount(Invitation, { global: { provide: { $axios, addSubscription: vi.fn() } } });
    await flushPromises();
    await wrapper.find('#inv-name').setValue('New Owner');
    await wrapper.find('#inv-password').setValue('E2e-Passw0rd!');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    return wrapper;
};

const callsTo = (url) => mocks.apiRequestWithoutCompnay.mock.calls.filter((call) => call[1] === url);

describe('Invitation page accepting an invitation', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.apiRequest.mockResolvedValue({ data: { status: true } });
        mocks.getAuth.mockResolvedValue(undefined);
    });

    it('records an invited owner on the company with the signed-in user id', async () => {
        const wrapper = await submitInvitation(1);
        expect(callsTo(env.COMPANYINVITATION)).toEqual([
            ['put', env.COMPANYINVITATION, { updateObject: { objId: { userId: USER_ID } }, companyId: COMPANY_ID }],
        ]);
        expect(wrapper.find('.auth__banner').exists()).toBe(false);
        expect(mocks.push).toHaveBeenCalledWith({ name: 'Log-in' });
    });

    it('links the invitation row to the signed-in user', async () => {
        await submitInvitation(1);
        expect(callsTo(env.API_ROOT_MEMBERS)[0][2]).toEqual({ id: INVITE_ID, data: { userId: USER_ID, status: 2 }, companyId: COMPANY_ID });
    });

    it('does not claim the company for an invited admin', async () => {
        const wrapper = await submitInvitation(2);
        expect(callsTo(env.COMPANYINVITATION)).toHaveLength(0);
        expect(wrapper.find('.auth__banner').exists()).toBe(false);
        expect(mocks.push).toHaveBeenCalledWith({ name: 'Log-in' });
    });
});
