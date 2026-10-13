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
const soon = new Date(Date.now() + 40 * DAY).toISOString();
const passed = new Date(Date.now() - 2 * DAY).toISOString();
const farOff = new Date(Date.now() + 900 * DAY).toISOString();
const OVER_MAX = 'API_TOKEN_EXPIRY_OVER_MAX';

const token = (over) => ({ _id: over.name, prefix: 'ahp_1234abcd', scopes: ['read'], active: true, createdAt: new Date(Date.now() - 40 * DAY).toISOString(), lastUsedAt: null, expiresAt: farOff, graceState: null, graceEndsAt: null, projectIds: [], ...over });
const row = (over) => ({ _id: over.name, kind: 'personal', owner: { id: 'u1', name: 'Olivia Owner' }, createdAt: new Date(Date.now() - 40 * DAY).toISOString(), lastUsedAt: null, deadline: soon, stopped: false, reason: 'no-expiry', ...over });

const policyOf = (strict, maxExpiryDays) => ({ strict, graceDays: 30, strictSince: strict ? new Date(Date.now() - 18 * DAY).toISOString() : null, minExpiryDays: 1, maxExpiryDays });

const serve = ({ strict = true, maxExpiryDays = 365, tokens = [], needing = [], mint }) => {
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url === '/api/v2/api-tokens') return Promise.resolve({ data: { status: true, data: tokens, policy: policyOf(strict, maxExpiryDays) } });
        if (method === 'get' && url === '/api/v2/api-tokens/needing-expiry') return Promise.resolve({ data: { status: true, data: needing, policy: policyOf(strict, maxExpiryDays) } });
        if (method === 'get' && url === '/api/v2/agents/account') return Promise.resolve({ data: { status: true, data: { account: null, policy: { allowedModes: ['workspace', 'personal', 'local'] }, summary: {} } } });
        if (method === 'post' && url === '/api/v2/api-tokens/mcp') return Promise.resolve({ data: mint || { status: true, data: { token: 'ahp_new' } } });
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
    await wrapper.findAll('.ah-tab').find((tab) => tab.text() === t('Accounts.tab_link')).trigger('click');
    return wrapper;
};

const startMinting = async (wrapper) => {
    await wrapper.findAll('button').find((b) => b.text() === t('Accounts.new_token')).trigger('click');
    await wrapper.find('#tok-name').setValue('Laptop');
};

const expiryChoices = (wrapper) => wrapper.find('[data-test="token-expiry"]').findAll('option').map((o) => o.element.value).filter(Boolean).map(Number);

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
});

describe('the expiry choice stops at the maximum lifetime', () => {
    it('offers every choice up to 365 days by default', async () => {
        const wrapper = await openTokens({ maxExpiryDays: 365 });
        await startMinting(wrapper);
        expect(expiryChoices(wrapper)).toEqual([7, 30, 90, 180, 365]);
    });

    it('stops at a lowered maximum and offers the maximum itself', async () => {
        const wrapper = await openTokens({ maxExpiryDays: 120 });
        await startMinting(wrapper);
        expect(expiryChoices(wrapper)).toEqual([7, 30, 90, 120]);
    });

    it('translates the server\'s refusal code into the screen\'s own sentence', async () => {
        const wrapper = await openTokens({ maxExpiryDays: 120, mint: { status: false, statusText: 'server words', code: OVER_MAX, maxExpiryDays: 60 } });
        await startMinting(wrapper);
        await wrapper.find('[data-test="token-expiry"]').setValue('90');
        await wrapper.findAll('button').find((b) => b.text() === t('Accounts.create_token')).trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain(t('Accounts.token_expiry_over_max', { n: 60 }));
        expect(wrapper.text()).not.toContain('server words');
    });
});

describe('tokens that outlive the maximum lifetime', () => {
    it('marks the owner\'s token with the day it stops, then that it stopped', async () => {
        const wrapper = await openTokens({
            tokens: [
                token({ name: 'Capped', lifetimeState: 'capped', lifetimeEndsAt: soon }),
                token({ name: 'Ended', lifetimeState: 'stopped', lifetimeEndsAt: passed }),
                token({ name: 'Fine', expiresAt: soon })
            ]
        });
        const [capped, ended, fine] = wrapper.findAll('.acct-token');
        expect(capped.find('[data-test="token-over-max"]').text()).toBe(t('Accounts.lifetime_capped_until', { d: day(soon) }));
        expect(ended.find('[data-test="token-over-max"]').text()).toBe(t('Accounts.lifetime_stopped_on', { d: day(passed) }));
        expect(fine.find('[data-test="token-over-max"]').exists()).toBe(false);
        expect(t('Accounts.lifetime_capped_until', { d: 'X' })).toMatch(/exceeds the maximum lifetime/);
    });

    it('lists them in the workspace list as exceeding the maximum lifetime, beside tokens without an expiry', async () => {
        const wrapper = await openTokens({
            needing: [
                row({ name: 'Nightly export', reason: 'over-max-lifetime', expiresAt: farOff, deadline: soon }),
                row({ name: 'Old CI', reason: 'over-max-lifetime', expiresAt: farOff, deadline: passed, stopped: true }),
                row({ name: 'Legacy' })
            ]
        });
        const rows = wrapper.find('[data-test="expiry-list"]').findAll('[data-test="expiry-row"]');
        expect(rows[0].find('[data-test="expiry-over-max"]').text()).toBe(t('Accounts.lifetime_capped_until', { d: day(soon) }));
        expect(rows[1].find('[data-test="expiry-over-max"]').text()).toBe(t('Accounts.lifetime_stopped_on', { d: day(passed) }));
        expect(rows[2].find('[data-test="expiry-over-max"]').exists()).toBe(false);
        expect(rows[2].find('[data-test="expiry-grace"]').text()).toBe(t('Accounts.grace_works_until', { d: day(soon) }));
        expect(wrapper.find('[data-test="expiry-list"]').text()).toContain(t('Accounts.expiry_list_over_max_lead', { n: 365 }));
    });

    it('shows no lifetime marks when strict mode is off', async () => {
        const wrapper = await openTokens({ strict: false, tokens: [token({ name: 'Capped', lifetimeState: 'capped', lifetimeEndsAt: soon })] });
        expect(wrapper.find('[data-test="token-over-max"]').exists()).toBe(false);
    });
});
