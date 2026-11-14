/* After a Claude Code token is made, the screen walks the person through the rest and links the guide. */
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
vi.mock('@/views/Ai/ConnectedApps.vue', () => ({ default: { name: 'ConnectedApps', render: () => null } }));

import AiAccounts from '@/views/Ai/AiAccounts.vue';
import { docsUrlFor, GUIDE } from '@/composable/docsLink';
import { mcpAddCommand } from '@/views/Ai/mcpUrl';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const serve = () => {
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url === '/api/v2/api-tokens') return Promise.resolve({ data: { status: true, data: [], policy: { strict: false, graceDays: 30, minExpiryDays: 1, maxExpiryDays: 365, defaultExpiryDays: 30 } } });
        if (method === 'get' && url === '/api/v2/agents/account') return Promise.resolve({ data: { status: true, data: { account: null, policy: { allowedModes: ['workspace', 'personal', 'local'] }, summary: {} } } });
        if (method === 'post' && url === '/api/v2/api-tokens/mcp') return Promise.resolve({ data: { status: true, data: { token: 'fresh-secret' } } });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { protocolVersion: '', tools: [], never: [] } } });
};

const store = (helpLink = '') => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 3 }), rules: () => ({ artificial_intelligence: { ai_external_clients: { roles: [{ key: 3, permission: true }] } } }) } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [] }) } },
        brandSettingTab: { namespaced: true, getters: { brandSettings: () => ({ helpLink }) } }
    }
});

const mintToken = async ({ provider = 'claude-code', helpLink } = {}) => {
    serve();
    const wrapper = mount(AiAccounts, { global: { plugins: [store(helpLink)], mocks: { $t: t } } });
    await flushPromises();
    await wrapper.findAll('.ah-tab').find((tab) => tab.text() === t('Accounts.tab_link')).trigger('click');
    await wrapper.findAll('button').find((b) => b.text() === t('Accounts.new_token')).trigger('click');
    await wrapper.find('#tok-name').setValue('claude-code-priya');
    await wrapper.find('#tok-provider').setValue(provider);
    await wrapper.findAll('button').find((b) => b.text() === t('Accounts.create_token')).trigger('click');
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
});

describe('the docs address', () => {
    it('uses the public docs unless the brand points at its own', () => {
        expect(docsUrlFor(GUIDE.CLAUDE_CODE_DEVELOPER)).toBe('https://docs.alianhub.com/ai/claude-code-developer');
        expect(docsUrlFor(GUIDE.CLAUDE_CODE_DEVELOPER, 'https://help.example.com/')).toBe('https://help.example.com/ai/claude-code-developer');
    });
});

describe('the setup command', () => {
    it('adds AlianHub for every folder, so a second folder does not need it again', () => {
        expect(mcpAddCommand('c1', 'tok')).toContain('--scope user');
    });
});

describe('after a Claude Code token is made', () => {
    it('shows the next steps with the developer instructions and the guide', async () => {
        const wrapper = await mintToken();
        const steps = wrapper.find('[data-test="claude-code-next-steps"]');
        expect(steps.exists()).toBe(true);
        expect(steps.text()).toContain(t('ClaudeCodeSetup.run_sentence'));
        expect(wrapper.find('[data-test="developer-instructions"]').text()).toContain('queue.claim');
        expect(wrapper.find('[data-test="claude-code-guide-link"]').attributes('href')).toBe('https://docs.alianhub.com/ai/claude-code-developer');
    });

    it('copies the developer instructions', async () => {
        const writeText = vi.fn().mockResolvedValue();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const wrapper = await mintToken();
        await wrapper.find('[data-test="copy-instructions"]').trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith(t('ClaudeCodeSetup.instructions'));
    });

    it('follows the brand help link to a self-hoster\'s own docs', async () => {
        const wrapper = await mintToken({ helpLink: 'https://help.example.com' });
        expect(wrapper.find('[data-test="claude-code-guide-link"]').attributes('href')).toBe('https://help.example.com/ai/claude-code-developer');
    });

    it('is not shown for another tool', async () => {
        const wrapper = await mintToken({ provider: 'cursor' });
        expect(wrapper.find('[data-test="claude-code-next-steps"]').exists()).toBe(false);
    });
});
