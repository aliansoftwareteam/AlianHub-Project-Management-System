import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/composable/index.js', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/views/Ai/useAgents', () => ({ reasonOf: (error, key) => key }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('@/views/Ai/AccountAttribution.vue', () => ({ default: { name: 'AccountAttribution', render: () => null } }));

import AiAccounts from '@/views/Ai/AiAccounts.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;
const day = (iso) => new Date(iso).toLocaleDateString();

const DAY = 24 * 60 * 60 * 1000;
const graceEndsAt = new Date(Date.now() + 12 * DAY).toISOString();
const stoppedAt = new Date(Date.now() - 2 * DAY).toISOString();
const usedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

const token = (over) => ({ _id: over.name, prefix: 'ahp_1234abcd', scopes: ['read', 'write'], active: true, createdAt: new Date(Date.now() - 400 * DAY).toISOString(), lastUsedAt: null, expiresAt: null, graceState: null, graceEndsAt: null, projectIds: [], ...over });

const policyOf = (strict) => ({ strict, graceDays: 30, graceEndsAt: strict ? graceEndsAt : null, minExpiryDays: 1, maxExpiryDays: 365 });

const serve = ({ strict, tokens = [] }) => {
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url === '/api/v2/api-tokens') return Promise.resolve({ data: { status: true, data: tokens, policy: policyOf(strict) } });
        if (method === 'get' && url === '/api/v2/agents/account') return Promise.resolve({ data: { status: true, data: { account: null, policy: { allowedModes: ['workspace', 'personal', 'local'] }, summary: {} } } });
        if (method === 'post' && url === '/api/v2/api-tokens/mcp') return Promise.resolve({ data: { status: true, data: { token: 'ahp_new' } } });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { protocolVersion: '', tools: [], never: [] } } });
};

const store = () => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [] }) } }
    }
});

const openTokens = async (setup) => {
    serve(setup);
    const wrapper = mount(AiAccounts, { global: { plugins: [store()], mocks: { $t: t } } });
    await flushPromises();
    const linkTab = wrapper.findAll('.ah-tab').find((tab) => tab.text() === t('Accounts.tab_link'));
    await linkTab.trigger('click');
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

const mintCalls = () => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && url === '/api/v2/api-tokens/mcp');

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
});

describe('the token form under strict mode', () => {
    it('asks for no expiry or scopes when strict mode is off, and sends what it sent before', async () => {
        const wrapper = await openTokens({ strict: false });
        await startMinting(wrapper);
        expect(wrapper.find('[data-test="token-expiry"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="token-scope-read"]').exists()).toBe(false);
        await create(wrapper);
        expect(mintCalls()).toHaveLength(1);
        expect(mintCalls()[0][2]).toEqual({ name: 'Laptop', mode: 'personal', provider: 'claude-code', projectIds: [] });
    });

    it('refuses to send a token without an expiry', async () => {
        const wrapper = await openTokens({ strict: true });
        await startMinting(wrapper);
        await create(wrapper);
        expect(mintCalls()).toHaveLength(0);
        expect(wrapper.text()).toContain(t('Accounts.token_expiry_required'));
    });

    it('refuses to send a token with no scope ticked', async () => {
        const wrapper = await openTokens({ strict: true });
        await startMinting(wrapper);
        await wrapper.find('[data-test="token-expiry"]').setValue('30');
        await wrapper.find('[data-test="token-scope-read"]').setValue(false);
        await wrapper.find('[data-test="token-scope-write"]').setValue(false);
        await create(wrapper);
        expect(mintCalls()).toHaveLength(0);
        expect(wrapper.text()).toContain(t('Accounts.token_scope_required'));
    });

    it('sends the expiry and the ticked scopes once both are given', async () => {
        const wrapper = await openTokens({ strict: true });
        await startMinting(wrapper);
        await wrapper.find('[data-test="token-expiry"]').setValue('90');
        await wrapper.find('[data-test="token-scope-write"]').setValue(false);
        await create(wrapper);
        expect(mintCalls()).toHaveLength(1);
        expect(mintCalls()[0][2]).toMatchObject({ name: 'Laptop', expiresInDays: 90, scopes: ['read'] });
    });
});

describe('the token list under strict mode', () => {
    it('shows when each token was last used', async () => {
        const wrapper = await openTokens({ strict: true, tokens: [token({ name: 'Used', lastUsedAt: usedAt, expiresAt: graceEndsAt }), token({ name: 'Idle', expiresAt: graceEndsAt })] });
        const rows = wrapper.findAll('.acct-token');
        expect(rows[0].text()).toContain(t('Accounts.used_on', { d: new Date(usedAt).toLocaleString() }));
        expect(rows[1].text()).toContain(t('Accounts.never_used'));
    });

    it('marks a token in its grace with the day it must be replaced by, and a stopped one with the day it stopped', async () => {
        const wrapper = await openTokens({
            strict: true,
            tokens: [
                token({ name: 'Grace', graceState: 'grace', graceEndsAt }),
                token({ name: 'Stopped', graceState: 'stopped', graceEndsAt: stoppedAt }),
                token({ name: 'Fine', expiresAt: graceEndsAt })
            ]
        });
        const [grace, stopped, fine] = wrapper.findAll('.acct-token');
        expect(grace.find('[data-test="token-grace"]').text()).toBe(t('Accounts.replace_by', { d: day(graceEndsAt) }));
        expect(stopped.find('[data-test="token-stopped"]').text()).toBe(t('Accounts.stopped_on', { d: day(stoppedAt) }));
        expect(fine.find('[data-test="token-grace"]').exists()).toBe(false);
        expect(fine.find('[data-test="token-stopped"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="token-strict-note"]').text()).toContain(day(graceEndsAt));
    });

    it('shows no grace marks when strict mode is off', async () => {
        const wrapper = await openTokens({ strict: false, tokens: [token({ name: 'Legacy', graceState: 'grace', graceEndsAt })] });
        expect(wrapper.find('[data-test="token-grace"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="token-strict-note"]').exists()).toBe(false);
    });
});
