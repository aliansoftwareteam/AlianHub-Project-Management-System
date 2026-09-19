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

const ROUTE = '/api/v2/api-tokens/step-credentials';
const MINUTE = 60 * 1000;
const issuedAt = new Date(Date.now() - 2 * MINUTE).toISOString();
const expiresAt = new Date(Date.now() + 15 * MINUTE).toISOString();

const row = (over) => ({ _id: over.stepId, kind: 'step_scoped', runId: 'run-1', runName: 'Nightly review', stepId: 'sAgent', stepType: 'agent_run', issuedAt, expiresAt, startedBy: { id: 'u1', name: 'Olivia Owner' }, ...over });

/* The tokens list names the flag in its policy only while it is on, which is what the screen reads before asking for the list. */
const serve = ({ on, rows = [] }) => {
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url === '/api/v2/api-tokens') return Promise.resolve({ data: { status: true, data: [], policy: { strict: false, ...(on ? { stepCredentials: true } : {}) } } });
        if (method === 'get' && url === ROUTE) return Promise.resolve({ data: { status: true, data: rows, policy: { stepCredentials: on } } });
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

describe('step-scoped credentials on the tokens screen', () => {
    it('lists each live credential as its own kind, with its run, step and expiry, and never a credential value', async () => {
        const wrapper = await openTokens({
            on: true,
            rows: [
                row({ stepId: 'sResearch', runName: 'Campaign build', startedBy: { id: 'u2', name: 'Max Member' } }),
                row({ stepId: 'sAgent' })
            ]
        }, 2);
        const section = wrapper.find('[data-test="step-credential-list"]');
        expect(section.exists()).toBe(true);
        expect(section.text()).toContain(t('Accounts.step_scoped_title'));
        expect(section.text()).toContain(t('Accounts.step_scoped_lead'));
        expect(t('Accounts.step_scoped_lead')).toMatch(/never shown/i);

        const rows = section.findAll('[data-test="step-credential-row"]');
        expect(rows).toHaveLength(2);
        rows.forEach((r) => expect(r.find('[data-test="step-credential-kind"]').text()).toBe(t('Accounts.step_scoped')));
        expect(rows[0].find('.acct-token__name').text()).toBe('Campaign build');
        expect(rows[0].text()).toContain('sResearch');
        expect(rows[0].text()).toContain('Max Member');
        expect(rows[0].text()).toContain(t('Accounts.step_scoped_first_issued', { d: new Date(issuedAt).toLocaleString() }));
        expect(rows[0].text()).toContain(t('Accounts.step_scoped_current_expires', { d: new Date(expiresAt).toLocaleString() }));
        expect(t('Accounts.step_scoped_current_expires', { d: 'x' })).toMatch(/renewed/i);
        expect(t('Accounts.step_scoped_lead')).toMatch(/extends the step's lease/i);
        expect(en.Accounts.step_scoped_expires).toBeUndefined();
        expect(en.Accounts.step_scoped_issued).toBeUndefined();
        expect(rows[1].find('.acct-token__name').text()).toBe('Nightly review');
        expect(rows[1].text()).toContain('Olivia Owner');
        expect(section.text()).not.toMatch(/eyJ|credentialId|ahp_/);
        expect(section.find('[data-test="step-credential-empty"]').exists()).toBe(false);
        expect(section.findAll('button')).toHaveLength(0);
    });

    it('shows the empty state when no step is running under a credential', async () => {
        const wrapper = await openTokens({ on: true, rows: [] }, 1);
        expect(wrapper.find('[data-test="step-credential-list"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="step-credential-empty"]').text()).toBe(t('Accounts.step_scoped_empty'));
    });

    it('asks for a member too, since the server keeps the list to the runs they started', async () => {
        const wrapper = await openTokens({ on: true, rows: [row({ stepId: 'sMine', startedBy: { id: 'u3', name: 'Me' } })] }, 3);
        expect(listCalls()).toHaveLength(1);
        expect(wrapper.findAll('[data-test="step-credential-row"]')).toHaveLength(1);
    });

    it('hides the section and never asks for the list while step credentials are off', async () => {
        const wrapper = await openTokens({ on: false, rows: [row({ stepId: 'sAgent' })] }, 2);
        expect(wrapper.find('[data-test="step-credential-list"]').exists()).toBe(false);
        expect(listCalls()).toHaveLength(0);
    });

    it('forgets the rows of an earlier visit once the policy says off', async () => {
        const before = await openTokens({ on: true, rows: [row({ stepId: 'sAgent' })] }, 2);
        expect(before.findAll('[data-test="step-credential-row"]')).toHaveLength(1);
        before.unmount();
        apiRequest.mockReset();
        const after = await openTokens({ on: false }, 2);
        expect(after.find('[data-test="step-credential-list"]').exists()).toBe(false);
        expect(listCalls()).toHaveLength(0);
    });
});
