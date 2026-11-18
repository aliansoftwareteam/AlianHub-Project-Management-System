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

const ROUTE = '/api/v2/api-tokens/needing-expiry';
const DAY = 24 * 60 * 60 * 1000;
const soon = new Date(Date.now() + 12 * DAY).toISOString();
const passed = new Date(Date.now() - 2 * DAY).toISOString();
const usedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

const row = (over) => ({ _id: over.name, kind: 'personal', owner: { id: 'u1', name: 'Olivia Owner' }, createdAt: new Date(Date.now() - 400 * DAY).toISOString(), lastUsedAt: null, deadline: soon, stopped: false, ...over });

const policyOf = (strict) => ({ strict, graceDays: 30, strictSince: strict ? new Date(Date.now() - 18 * DAY).toISOString() : null, minExpiryDays: 1, maxExpiryDays: 365 });

const serve = ({ strict, needing = [] }) => {
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url === '/api/v2/api-tokens') return Promise.resolve({ data: { status: true, data: [], policy: policyOf(strict) } });
        if (method === 'get' && url === ROUTE) return Promise.resolve({ data: { status: true, data: needing, policy: policyOf(strict) } });
        if (method === 'get' && url === '/api/v2/agents/account') return Promise.resolve({ data: { status: true, data: { account: null, policy: { allowedModes: ['workspace', 'personal', 'local'] }, summary: {} } } });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { protocolVersion: '', tools: [], never: [] } } });
};

const store = (roleType) => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [] }) } }
    }
});

const openTokens = async (setup, roleType = 2) => {
    serve(setup);
    const wrapper = mount(AiAccounts, { global: { plugins: [store(roleType)], mocks: { $t: t } } });
    await flushPromises();
    await wrapper.findAll('.ah-tab').find((tab) => tab.text() === t('Accounts.tab_link')).trigger('click');
    return wrapper;
};

const listCalls = () => apiRequest.mock.calls.filter(([method, url]) => method === 'get' && url === ROUTE);

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
});

describe('the workspace list of tokens that still need an expiry', () => {
    it('shows an admin every token, its owner, its deadline and its last use, in the order served', async () => {
        const wrapper = await openTokens({
            strict: true,
            needing: [
                row({ name: 'Nightly export', owner: { id: 'u2', name: 'Max Member' }, deadline: passed, stopped: true, lastUsedAt: usedAt }),
                row({ name: 'Laptop', deadline: soon })
            ]
        }, 2);
        const section = wrapper.find('[data-test="expiry-list"]');
        expect(section.exists()).toBe(true);
        expect(section.text()).toContain(t('Accounts.expiry_list_title'));
        expect(section.text()).toContain(t('Accounts.expiry_list_lead'));
        expect(t('Accounts.expiry_list_lead')).toMatch(/only the owner of a token can replace it/i);

        const rows = section.findAll('[data-test="expiry-row"]');
        expect(rows.map((r) => r.find('.acct-token__name').text())).toEqual(['Nightly export', 'Laptop']);
        expect(rows[0].text()).toContain('Max Member');
        expect(rows[0].text()).toContain(t('Accounts.used_on', { d: new Date(usedAt).toLocaleString() }));
        expect(rows[0].find('[data-test="expiry-stopped"]').text()).toBe(t('Accounts.grace_stopped_on', { d: day(passed) }));
        expect(rows[0].find('[data-test="expiry-grace"]').exists()).toBe(false);
        expect(rows[1].text()).toContain('Olivia Owner');
        expect(rows[1].text()).toContain(t('Accounts.never_used'));
        expect(rows[1].find('[data-test="expiry-grace"]').text()).toBe(t('Accounts.grace_works_until', { d: day(soon) }));
        expect(wrapper.find('[data-test="expiry-empty"]').exists()).toBe(false);
    });

    it('shows an owner the empty state when every token has an expiry', async () => {
        const wrapper = await openTokens({ strict: true, needing: [] }, 1);
        expect(wrapper.find('[data-test="expiry-list"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="expiry-empty"]').text()).toBe(t('Accounts.expiry_list_empty'));
    });

    it('hides the section and never asks when strict mode is off', async () => {
        const wrapper = await openTokens({ strict: false, needing: [row({ name: 'Legacy' })] }, 2);
        expect(wrapper.find('[data-test="expiry-list"]').exists()).toBe(false);
        expect(listCalls()).toHaveLength(0);
    });

    it('hides the section and never asks for a member', async () => {
        const wrapper = await openTokens({ strict: true, needing: [row({ name: 'Legacy' })] }, 3);
        expect(wrapper.find('[data-test="expiry-list"]').exists()).toBe(false);
        expect(listCalls()).toHaveLength(0);
    });
});
