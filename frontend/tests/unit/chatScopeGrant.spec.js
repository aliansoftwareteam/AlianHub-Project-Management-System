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
import AgentClientScopes from '@/views/Settings/AgentClients/AgentClientScopes.vue';
import en from '@/locales/en.js';
import { canGrantChat, grantsOf } from '@/views/Ai/tokenPolicy';
import { CHAT_SCOPE, OPT_IN_SCOPES, PLAIN_SCOPES, SCOPES, isOptInScope, scopeNameKey, scopeSentenceKey } from '@/views/OAuth/oauthShared';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const CHAT = 'chat:read';
const TASKS = 'tasks:manage';
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

describe('letting a new agent token read chat', () => {
    it('does not offer the choice while the server does not name the grant', async () => {
        const wrapper = await openForm({ policy: policyOf({ grants: [TASKS] }) });
        expect(wrapper.find('[data-test="token-grant-chat"]').exists()).toBe(false);
        await wrapper.find('[data-test="token-grant-tasks"]').setValue(true);
        await create(wrapper);
        expect(mintBodies()[0].grants).toEqual([TASKS]);
    });

    it('offers it unticked with its own plain line, and sends the grant only when it is ticked', async () => {
        const wrapper = await openForm({ policy: policyOf({ grants: [CHAT] }) });
        const box = wrapper.find('[data-test="token-grant-chat"]');
        expect(box.element.checked).toBe(false);
        expect(wrapper.text()).toContain(t('Accounts.token_grant_chat'));
        expect(wrapper.text()).toContain(t('Accounts.token_grant_chat_effect'));
        await create(wrapper);
        expect(mintBodies()[0]).not.toHaveProperty('grants');

        const second = await openForm({ policy: policyOf({ grants: [CHAT] }) });
        await second.find('[data-test="token-grant-chat"]').setValue(true);
        await create(second);
        expect(mintBodies()[1].grants).toEqual([CHAT]);
    });

    it('is not ticked by ticking another grant', async () => {
        const wrapper = await openForm({ policy: policyOf({ grants: [TASKS, CHAT] }) });
        await wrapper.find('[data-test="token-grant-tasks"]').setValue(true);
        expect(wrapper.find('[data-test="token-grant-chat"]').element.checked).toBe(false);
        await create(wrapper);
        expect(mintBodies()[0].grants).toEqual([TASKS]);
    });

    it('needs the read scope where scopes are chosen, not the write scope', () => {
        const strict = policyOf({ strict: true, grants: [CHAT] });
        expect(canGrantChat({ scopes: ['read'] }, strict)).toBe(true);
        expect(canGrantChat({ scopes: ['write'] }, strict)).toBe(false);
        expect(grantsOf({ readChat: true, scopes: ['write'] }, strict)).toEqual([]);
        expect(grantsOf({ readChat: true, scopes: ['read'] }, strict)).toEqual([CHAT]);
        expect(grantsOf({ readChat: true }, policyOf())).toEqual([]);
    });

    it('says which listed tokens read chat', async () => {
        const wrapper = await openForm({ policy: policyOf({ grants: [CHAT] }), tokens: [token({ name: 'With', grants: [CHAT] }), token({ name: 'Without' })] });
        const meta = wrapper.findAll('.acct-token').map((row) => row.text());
        expect(meta.find((text) => text.startsWith('With')).includes(t('Accounts.token_grant_chat_short'))).toBe(true);
        expect(meta.find((text) => text.startsWith('Without')).includes(t('Accounts.token_grant_chat_short'))).toBe(false);
    });
});

describe('the chat scope on the consent and approval screens', () => {
    it('is a scope given only by a tick, never one of the plain scopes', () => {
        expect(CHAT_SCOPE).toBe(CHAT);
        expect(SCOPES).toContain(CHAT);
        expect(PLAIN_SCOPES).not.toContain(CHAT);
        expect(OPT_IN_SCOPES).toContain(CHAT);
        expect(isOptInScope(CHAT)).toBe(true);
        expect(isOptInScope('tasks:read')).toBe(false);
    });

    it('has its own plain line and short name', () => {
        expect(t(scopeSentenceKey(CHAT))).toBe('Read messages in channels you are in');
        expect(t(scopeNameKey(CHAT))).toBe('Read chat');
    });

    it('is offered to an owner or admin unticked, apart from the plain scopes, and marked when the app asked for it', async () => {
        const wrapper = mount(AgentClientScopes, { props: { scopes: ['tasks:read'], privateSprints: false, asked: [CHAT] }, global: { mocks: { $t: t } } });
        const box = wrapper.find(`[data-test="scope-${CHAT}"]`);
        expect(box.exists()).toBe(true);
        expect(box.element.checked).toBe(false);
        expect(wrapper.find('[data-test="manage-scopes"]').text()).toContain(t(scopeSentenceKey(CHAT)));
        expect(wrapper.find(`[data-test="asked-${CHAT}"]`).exists()).toBe(true);
        await box.setValue(true);
        expect(wrapper.emitted('update:scopes').at(-1)[0]).toEqual(['tasks:read', CHAT]);
    });
});
