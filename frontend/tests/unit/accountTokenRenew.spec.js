/* Task 047 AI-4d: a new token starts with a default lifetime, and a token is renewed in place. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { routeLocationKey } from 'vue-router';

const { apiRequest, apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/composable/index.js', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/views/Ai/useAgents', () => ({ reasonOf: (error, key) => key }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('@/views/Ai/AccountAttribution.vue', () => ({ default: { name: 'AccountAttribution', render: () => null } }));
vi.mock('@/views/Ai/ConnectedApps.vue', () => ({ default: { name: 'ConnectedApps', template: '<div data-test="connected-apps"></div>' } }));

import AiAccounts from '@/views/Ai/AiAccounts.vue';
import { DEFAULT_TOKEN_POLICY, defaultExpiryFor } from '@/views/Ai/tokenPolicy';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const DAY = 24 * 60 * 60 * 1000;
const RENEWED = ['renewed', 'secret', 'shown', 'once'].join('-');

const token = (over) => ({ _id: over.name, prefix: 'tok_1234abcd', scopes: ['read', 'write'], active: true, createdAt: new Date(Date.now() - 27 * DAY).toISOString(), lastUsedAt: null, expiresAt: new Date(Date.now() + 3 * DAY).toISOString(), projectIds: [], grants: [], ...over });

const policyOf = ({ strict = false, maxExpiryDays = 365, defaultExpiryDays = 30 } = {}) => ({ strict, graceDays: 30, strictSince: null, minExpiryDays: 1, maxExpiryDays, defaultExpiryDays });

const serve = ({ policy = policyOf(), tokens = [], renew } = {}) => {
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url === '/api/v2/api-tokens') return Promise.resolve({ data: { status: true, data: tokens, policy } });
        if (method === 'get' && url === '/api/v2/agents/account') return Promise.resolve({ data: { status: true, data: { account: null, policy: { allowedModes: ['workspace', 'personal', 'local'] }, summary: {} } } });
        if (method === 'post' && url === '/api/v2/api-tokens/mcp') return Promise.resolve({ data: { status: true, data: { token: 'new-secret' } } });
        if (method === 'post' && /\/renew$/.test(url)) return renew ? renew(url) : Promise.resolve({ data: { status: true, data: { token: RENEWED } } });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { protocolVersion: '', tools: [], never: [] } } });
};

const store = () => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 3 }) } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [] }) } }
    }
});

const open = async (setup, { query } = {}) => {
    serve(setup);
    const wrapper = mount(AiAccounts, { global: { plugins: [store()], mocks: { $t: t }, provide: query ? { [routeLocationKey]: { query } } : {} } });
    await flushPromises();
    return wrapper;
};

const openTokens = async (setup) => {
    const wrapper = await open(setup);
    await wrapper.findAll('.ah-tab').find((tab) => tab.text() === t('Accounts.tab_link')).trigger('click');
    return wrapper;
};

const startMinting = async (wrapper, name = 'Laptop') => {
    await wrapper.findAll('button').find((b) => b.text() === t('Accounts.new_token')).trigger('click');
    await wrapper.find('#tok-name').setValue(name);
};

const create = async (wrapper) => {
    await wrapper.findAll('button').find((b) => b.text() === t('Accounts.create_token')).trigger('click');
    await flushPromises();
};

const calls = (pattern) => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && pattern.test(url));
const mintCalls = () => calls(/\/api-tokens\/mcp$/);
const renewCalls = () => calls(/\/renew$/);
const expiryField = (wrapper) => wrapper.find('[data-test="token-expiry"]');

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the default lifetime in the token form', () => {
    it('is 30 days unless the server says otherwise, and never past the maximum', () => {
        expect(DEFAULT_TOKEN_POLICY.defaultExpiryDays).toBe(30);
        expect(defaultExpiryFor({})).toBe(30);
        expect(defaultExpiryFor({ defaultExpiryDays: 30, maxExpiryDays: 7 })).toBe(7);
        expect(defaultExpiryFor({ defaultExpiryDays: 14, maxExpiryDays: 365 })).toBe(14);
    });

    it('is preselected, with no empty choice, and is sent when nothing else is picked', async () => {
        const wrapper = await openTokens();
        await startMinting(wrapper);
        expect(expiryField(wrapper).element.value).toBe('30');
        expect(expiryField(wrapper).findAll('option').map((o) => o.element.value)).toEqual(['7', '30', '90', '180', '365']);
        await create(wrapper);
        expect(mintCalls()[0][2]).toEqual({ name: 'Laptop', mode: 'personal', provider: 'claude-code', projectIds: [], expiresInDays: 30 });
    });

    it('is preselected under the token expiry rule too', async () => {
        const wrapper = await openTokens({ policy: policyOf({ strict: true }) });
        await startMinting(wrapper);
        expect(expiryField(wrapper).element.value).toBe('30');
        await create(wrapper);
        expect(mintCalls()[0][2]).toMatchObject({ expiresInDays: 30, scopes: ['read', 'write'] });
    });

    it('follows a shorter maximum', async () => {
        const wrapper = await openTokens({ policy: policyOf({ strict: true, maxExpiryDays: 7, defaultExpiryDays: 7 }) });
        await startMinting(wrapper);
        expect(expiryField(wrapper).element.value).toBe('7');
    });

    it('still sends another lifetime when one is chosen, and goes back to the default for the next token', async () => {
        const wrapper = await openTokens();
        await startMinting(wrapper);
        await expiryField(wrapper).setValue('90');
        await create(wrapper);
        expect(mintCalls()[0][2]).toMatchObject({ expiresInDays: 90 });
        await startMinting(wrapper, 'Second');
        expect(expiryField(wrapper).element.value).toBe('30');
    });

    it('says the owner is told before it ends', async () => {
        const wrapper = await openTokens();
        await startMinting(wrapper);
        expect(wrapper.find('[data-test="token-expiry-hint"]').text()).toBe(t('Accounts.expiry_hint'));
    });
});

describe('renewing a token from the list', () => {
    const rowOf = (wrapper, name) => wrapper.findAll('.acct-token').find((row) => row.text().includes(name));
    const renewButton = (wrapper, name) => rowOf(wrapper, name).find('[data-test="token-renew"]');

    it('offers Renew on a working token and not on a revoked one', async () => {
        const wrapper = await openTokens({ tokens: [token({ name: 'Laptop' }), token({ name: 'Old', active: false })] });
        expect(renewButton(wrapper, 'Laptop').text()).toBe(t('Accounts.renew'));
        expect(renewButton(wrapper, 'Old').exists()).toBe(false);
    });

    it('asks first, then shows the new secret once, where a new token\'s secret is shown', async () => {
        const wrapper = await openTokens({ tokens: [token({ name: 'Laptop' })] });
        await renewButton(wrapper, 'Laptop').trigger('click');
        await flushPromises();

        expect(window.confirm).toHaveBeenCalledWith(t('Accounts.renew_confirm', { name: 'Laptop' }));
        expect(renewCalls().map(([, url]) => url)).toEqual(['/api/v2/api-tokens/Laptop/renew']);
        expect(wrapper.find('.acct-secret__value').text()).toBe(RENEWED);
        expect(wrapper.find('.acct-secret__once').text()).toBe(t('Accounts.token_once'));

        await wrapper.findAll('button').find((b) => b.text() === t('Accounts.hide_token')).trigger('click');
        expect(wrapper.html()).not.toContain(RENEWED);
    });

    it('reads the list again, so the new end date shows', async () => {
        const wrapper = await openTokens({ tokens: [token({ name: 'Laptop' })] });
        const lists = () => apiRequest.mock.calls.filter(([method, url]) => method === 'get' && url === '/api/v2/api-tokens').length;
        const before = lists();
        await renewButton(wrapper, 'Laptop').trigger('click');
        await flushPromises();
        expect(lists()).toBe(before + 1);
    });

    it('does nothing when the question is answered no', async () => {
        window.confirm.mockReturnValue(false);
        const wrapper = await openTokens({ tokens: [token({ name: 'Laptop' })] });
        await renewButton(wrapper, 'Laptop').trigger('click');
        await flushPromises();
        expect(renewCalls()).toHaveLength(0);
        expect(wrapper.find('.acct-secret__value').exists()).toBe(false);
    });

    it('says why when the server refuses, and shows no secret', async () => {
        const wrapper = await openTokens({ tokens: [token({ name: 'Laptop' })], renew: () => Promise.resolve({ data: { status: false, statusText: 'Token not found.' } }) });
        await renewButton(wrapper, 'Laptop').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('Token not found.');
        expect(wrapper.find('.acct-secret__value').exists()).toBe(false);
    });
});

describe('arriving from the Inbox notice', () => {
    it('opens on the tokens when the notice was about a token', async () => {
        const wrapper = await open({ tokens: [token({ name: 'Laptop' })] }, { query: { tab: 'link' } });
        expect(wrapper.text()).toContain(t('Accounts.tokens_title'));
    });

    it('opens on the connected apps when the notice was about a connection', async () => {
        const wrapper = await open({}, { query: { tab: 'connected' } });
        expect(wrapper.find('[data-test="connected-apps"]').exists()).toBe(true);
    });

    it('ignores a tab it does not have', async () => {
        const wrapper = await open({}, { query: { tab: 'nonsense' } });
        expect(wrapper.text()).toContain(t('Accounts.modes_lead'));
    });
});
