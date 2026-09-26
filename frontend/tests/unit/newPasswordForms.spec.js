import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import passwords from '../../../tests/fixtures/passwordSamples.json';

const COMPANY_ID = '6f0000000000000000000c01';
const INVITE_ID = '6f00000000000000000a0001';
const USER_ID = '6f0000000000000000000009';
const RULE_KEY = 'Auth.new_password_rule_range';
const LONGEST = `Aa1!${'x'.repeat(252)}`;
const TOO_LONG = `${LONGEST}x`;

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
    useRoute: () => ({ query: { companyId: `${COMPANY_ID}-${INVITE_ID}`, token: 'link' }, params: { token: 'reset-token' } }),
    useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/config/publicConfig', () => ({ enabledProviders: () => [] }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ debouncerWithPromise: () => Promise.resolve() }) }));
vi.mock('@/router/setupStatus', () => ({
    readSetupStatus: vi.fn(async () => ({ installed: false, dbOk: true, version: '1.0.0' })),
    markInstalled: vi.fn(),
}));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => ({ default: { name: 'SpinnerComp', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', async () => {
    const { h } = await import('vue');
    return { default: { name: 'AuthShell', setup: (props, { slots }) => () => h('div', slots.default && slots.default()) } };
});

import * as env from '@/config/env';
import SetupWizard from '@/views/Setup/SetupWizard.vue';
import Invitation from '@/views/Authentication/Invitation/Invitation.vue';
import NewPasswordCard from '@/views/Authentication/ResetPassword/NewPasswordCard.vue';
import ChangePassword from '@/views/Settings/ChangePassword/ChangePassword.vue';

window.EventSource = class { close() {} };

const callsTo = (mock, url) => mock.mock.calls.filter((call) => String(call[1]).startsWith(url));

const openSetup = async () => {
    const wrapper = mount(SetupWizard);
    await flushPromises();
    return wrapper;
};

const submitSetup = async (password) => {
    mocks.apiRequestWithoutSecure.mockResolvedValue({ data: { status: false } });
    const wrapper = await openSetup();
    await wrapper.find('#firstName').setValue('Olivia');
    await wrapper.find('#lastName').setValue('Owner');
    await wrapper.find('#email').setValue('owner@example.test');
    await wrapper.find('#password').setValue(password);
    await wrapper.find('#companyName').setValue('Acme');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    return wrapper;
};

const openInvitation = async () => {
    const $axios = { post: vi.fn(async () => ({ data: { status: true, data: { status: 1, email: 'invitee@example.test', workspaceName: 'Acme' } } })) };
    const wrapper = mount(Invitation, { global: { provide: { $axios, addSubscription: vi.fn() } } });
    await flushPromises();
    return wrapper;
};

const submitInvitation = async (password) => {
    mocks.apiRequestWithoutCompnay.mockResolvedValue({ data: { status: false } });
    const wrapper = await openInvitation();
    await wrapper.find('#inv-name').setValue('Ivy Invitee');
    await wrapper.find('#inv-password').setValue(password);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    return wrapper;
};

const openReset = async () => {
    mocks.apiRequestWithoutSecure.mockImplementation(async (type, url) => {
        if (url === env.TOKEN_VERIFY_FORGOTPASSWORD) return { data: { data: { _id: USER_ID } } };
        return { data: { status: true } };
    });
    const wrapper = mount(NewPasswordCard, { props: { title: 'Auth.new_password_title', submitLabel: 'Auth.save_password', successToast: 'Toast.done' } });
    await flushPromises();
    return wrapper;
};

const submitReset = async (password) => {
    const wrapper = await openReset();
    await wrapper.find('#np-password').setValue(password);
    await wrapper.find('#np-confirm').setValue(password);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    return wrapper;
};

const submitChange = async (oldPassword, newPassword) => {
    mocks.apiRequest.mockResolvedValue({ status: 200 });
    const wrapper = mount(ChangePassword);
    await flushPromises();
    await wrapper.find('#current_password').setValue(oldPassword);
    await wrapper.find('#new_password').setValue(newPassword);
    await wrapper.find('#confirm_password').setValue(newPassword);
    await wrapper.find('.mysetting_save_btn').trigger('click');
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe('setup, invitation and reset show one password rule', () => {
    it('setup names all four requirements under the password', async () => {
        const wrapper = await openSetup();
        expect(wrapper.find('#password').element.closest('.ah-field').textContent).toContain(RULE_KEY);
    });

    it('an invitation names all four requirements under the password', async () => {
        const wrapper = await openInvitation();
        expect(wrapper.find('.ah-field__hint').text()).toBe(RULE_KEY);
    });

    it('a reset names all four requirements above the password', async () => {
        const wrapper = await openReset();
        expect(wrapper.find('.auth__p').text()).toBe(RULE_KEY);
    });
});

describe('setup refuses a weak owner password before submitting', () => {
    it.each(passwords.weak)('refuses %j', async (password) => {
        const wrapper = await submitSetup(password);
        expect(callsTo(mocks.apiRequestWithoutSecure, env.SETUP_COMPLETE)).toEqual([]);
        expect(wrapper.find('.ah-field__error').text()).toContain(RULE_KEY);
    });

    it.each(passwords.strong)('submits %j', async (password) => {
        await submitSetup(password);
        expect(callsTo(mocks.apiRequestWithoutSecure, env.SETUP_COMPLETE)).toHaveLength(1);
    });
});

describe('an invitation refuses a weak password before submitting', () => {
    it.each(passwords.weak)('refuses %j', async (password) => {
        const wrapper = await submitInvitation(password);
        expect(callsTo(mocks.apiRequestWithoutCompnay, env.CREATE_USER_V2)).toEqual([]);
        expect(wrapper.find('.ah-field__error').text()).toContain(RULE_KEY);
    });

    it.each(passwords.strong)('submits %j', async (password) => {
        await submitInvitation(password);
        expect(callsTo(mocks.apiRequestWithoutCompnay, env.CREATE_USER_V2)).toHaveLength(1);
    });
});

describe('a reset refuses a weak password before submitting', () => {
    it.each(passwords.weak)('refuses %j', async (password) => {
        const wrapper = await submitReset(password);
        expect(callsTo(mocks.apiRequestWithoutSecure, env.RESETPASSWORD)).toEqual([]);
        expect(wrapper.find('.ah-field__error').text()).toContain(RULE_KEY);
    });

    it.each(passwords.strong)('submits %j', async (password) => {
        await submitReset(password);
        expect(callsTo(mocks.apiRequestWithoutSecure, env.RESETPASSWORD)).toHaveLength(1);
    });
});

describe('every form takes a password of up to 256 characters', () => {
    it.each([
        ['setup', async () => (await openSetup()).find('#password')],
        ['an invitation', async () => (await openInvitation()).find('#inv-password')],
        ['a reset', async () => (await openReset()).find('#np-password')],
        ['a reset confirmation', async () => (await openReset()).find('#np-confirm')],
    ])('%s does not cut a long password short', async (_label, field) => {
        expect(Number((await field()).attributes('maxlength') ?? Infinity)).toBeGreaterThanOrEqual(LONGEST.length);
    });

    it.each([
        ['setup', submitSetup, () => callsTo(mocks.apiRequestWithoutSecure, env.SETUP_COMPLETE)],
        ['an invitation', submitInvitation, () => callsTo(mocks.apiRequestWithoutCompnay, env.CREATE_USER_V2)],
        ['a reset', submitReset, () => callsTo(mocks.apiRequestWithoutSecure, env.RESETPASSWORD)],
    ])('%s refuses a 257-character password with the rule and submits a 256-character one', async (_label, submit, sent) => {
        const refused = await submit(TOO_LONG);
        expect(sent()).toEqual([]);
        expect(refused.find('.ah-field__error').text()).toContain(RULE_KEY);
        await submit(LONGEST);
        expect(sent()).toHaveLength(1);
    });

    it('change password refuses a 257-character new password', async () => {
        await submitChange('Abcdefg1!', TOO_LONG);
        expect(callsTo(mocks.apiRequest, `${env.AUTH}/user-1/change-password`)).toEqual([]);
    });
});

describe('change password checks only the new password against the rule', () => {
    const changeUrl = `${env.AUTH}/user-1/change-password`;

    it.each(passwords.weak)('refuses the new password %j', async (password) => {
        await submitChange('Abcdefg1!', password);
        expect(callsTo(mocks.apiRequest, changeUrl)).toEqual([]);
    });

    it.each(passwords.strong)('lets an account whose password predates the rule change it to %j', async (password) => {
        await submitChange('abcdefgh', password);
        expect(callsTo(mocks.apiRequest, changeUrl)).toEqual([['patch', changeUrl, { oldPassword: 'abcdefgh', newPassword: password }]]);
    });
});
