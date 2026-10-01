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
import { canGrantTasks, grantsOf } from '@/views/Ai/tokenPolicy';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const GRANT = 'tasks:manage';
const policyOf = ({ strict = false, grants } = {}) => ({ strict, graceDays: 30, strictSince: null, minExpiryDays: 1, maxExpiryDays: 365, ...(grants ? { grants } : {}) });
const token = (over) => ({ _id: over.name, prefix: 'ahp_1234abcd', scopes: ['read', 'write'], active: true, createdAt: new Date().toISOString(), lastUsedAt: null, expiresAt: null, projectIds: [], grants: [], ...over });

const serve = ({ policy, tokens = [] }) => {
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url === '/api/v2/api-tokens') return Promise.resolve({ data: { status: true, data: tokens, policy } });
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

const openForm = async (setup) => {
    serve(setup);
    const wrapper = mount(AiAccounts, { global: { plugins: [store()], mocks: { $t: t } } });
    await flushPromises();
    await wrapper.findAll('.ah-tab').find((tab) => tab.text() === t('Accounts.tab_link')).trigger('click');
    await wrapper.findAll('button').find((b) => b.text() === t('Accounts.new_token')).trigger('click');
    await wrapper.find('#tok-name').setValue('Laptop');
    return wrapper;
};

const create = async (wrapper) => {
    await wrapper.findAll('button').find((b) => b.text() === t('Accounts.create_token')).trigger('click');
    await flushPromises();
};

const mintBodies = () => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && url === '/api/v2/api-tokens/mcp').map(([, , body]) => body);

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
});

describe('letting a new agent token manage tasks', () => {
    it('does not offer the choice while the server does not name the grant, and sends what it sent before', async () => {
        const wrapper = await openForm({ policy: policyOf() });
        expect(wrapper.find('[data-test="token-grant-tasks"]').exists()).toBe(false);
        await create(wrapper);
        expect(mintBodies()).toEqual([{ name: 'Laptop', mode: 'personal', provider: 'claude-code', projectIds: [] }]);
    });

    it('offers it unticked, and sends the grant only when it is ticked', async () => {
        const wrapper = await openForm({ policy: policyOf({ grants: [GRANT] }) });
        const box = wrapper.find('[data-test="token-grant-tasks"]');
        expect(box.exists()).toBe(true);
        expect(box.element.checked).toBe(false);
        expect(wrapper.text()).toContain(t('Accounts.token_grant_tasks'));
        expect(wrapper.text()).toContain(t('Accounts.token_grant_tasks_effect'));
        await box.setValue(true);
        await create(wrapper);
        expect(mintBodies()[0].grants).toEqual([GRANT]);
    });

    it('leaves the grant out when the box stays unticked', async () => {
        const wrapper = await openForm({ policy: policyOf({ grants: [GRANT] }) });
        await create(wrapper);
        expect(mintBodies()[0]).not.toHaveProperty('grants');
    });

    it('says which listed tokens manage tasks', async () => {
        const wrapper = await openForm({ policy: policyOf({ grants: [GRANT] }), tokens: [token({ name: 'With', grants: [GRANT] }), token({ name: 'Without' })] });
        const meta = wrapper.findAll('.acct-token').map((row) => row.text());
        expect(meta.find((text) => text.startsWith('With')).includes(t('Accounts.token_grant_tasks_short'))).toBe(true);
        expect(meta.find((text) => text.startsWith('Without')).includes(t('Accounts.token_grant_tasks_short'))).toBe(false);
    });

    it('needs the write scope where scopes are chosen', () => {
        const strict = policyOf({ strict: true, grants: [GRANT] });
        expect(canGrantTasks({ scopes: ['read'] }, strict)).toBe(false);
        expect(canGrantTasks({ scopes: ['read', 'write'] }, strict)).toBe(true);
        expect(grantsOf({ manageTasks: true, scopes: ['read'] }, strict)).toEqual([]);
        expect(grantsOf({ manageTasks: true, scopes: ['write'] }, strict)).toEqual([GRANT]);
        expect(grantsOf({ manageTasks: true }, policyOf())).toEqual([]);
    });
});
