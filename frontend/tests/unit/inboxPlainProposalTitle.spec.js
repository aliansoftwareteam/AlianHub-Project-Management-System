import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: () => Promise.resolve(), push: () => Promise.resolve(), hasRoute: () => false }) }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import Inbox from '@/views/Inbox/Inbox.vue';

const proposal = {
    sourceType: 'proposal', sourceId: 'p1', proposalId: 'p1', kind: 'proposal', agentName: 'Reviewer', agentId: 'a1',
    what: 'pr.summary: 1 change(s) on AR-1', why: 'Because.', changes: [{ action: 'task.comment', params: {}, label: 'Comment', reversible: true }],
    locked: false, editable: true, createdAt: '2026-09-28T09:00:00.000Z', unread: true,
};

const ok = (data) => Promise.resolve({ data: { status: true, data } });

let wrapper;
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the Inbox names an agent proposal in plain words', () => {
    it('shows the skill in words and a pluralised count, not the engine title', async () => {
        apiRequest.mockImplementation((method, url) => {
            if (method === 'get' && url.endsWith('/counts')) return ok({ approval: 1, primary: 0, other: 0, later: 0 });
            if (method === 'get') return ok({ items: [], approvals: [], proposals: [proposal], hasMore: false, nextSkip: 0 });
            return ok({});
        });
        const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
        wrapper = mount(Inbox, { attachTo: document.body, global: { plugins: [i18n], stubs: { UserProfile: true, ShellIcon: true } } });
        await flushPromises();
        const what = wrapper.find('[data-test="queue-row"]');
        expect(what.text()).toContain('Summarise a pull request · 1 change on AR-1');
        expect(wrapper.text()).not.toContain('change(s)');
        expect(wrapper.text()).not.toContain('pr.summary');
    });
});
