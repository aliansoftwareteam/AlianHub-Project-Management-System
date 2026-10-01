import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest, sendProposalDecision, route } = vi.hoisted(() => ({ apiRequest: vi.fn(), sendProposalDecision: vi.fn(), route: { query: {} } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace: () => Promise.resolve(), push: () => Promise.resolve(), hasRoute: () => false }) }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import Inbox from '@/views/Inbox/Inbox.vue';

const proposal = (id, over = {}) => ({
    sourceType: 'proposal', sourceId: id, proposalId: id, kind: 'proposal', agentName: 'Reviewer', source: '', requestedBy: '',
    what: `Tidy ${id}`, why: 'Because.', changes: [{ action: 'task.comment', params: { taskId: 't1' }, label: 'Comment on the task', reversible: true }],
    gate: null, locked: false, editable: true, createdAt: '2026-09-28T09:00:00.000Z', unread: true, ...over,
});
const leave = { sourceType: 'approval', sourceId: 'l1', kind: 'approval', approvalType: 'pto', ptoType: 'vacation', startDate: '2026-10-05', endDate: '2026-10-06', reason: 'Family', actorId: 'u2', unread: true, createdAt: '2026-09-28T08:00:00.000Z' };
const notice = { sourceType: 'notification', sourceId: 'n1', kind: 'update', message: 'Status changed', unread: true, createdAt: '2026-09-28T07:00:00.000Z' };

const ok = (data) => Promise.resolve({ data: { status: true, data } });
let server;
const tabOf = (url) => new URLSearchParams(url.split('?')[1] || '').get('tab');
const listCalls = () => apiRequest.mock.calls.filter(([method, url]) => method === 'get' && !url.endsWith('/counts')).map(([, url]) => tabOf(url));
const countCalls = () => apiRequest.mock.calls.filter(([method, url]) => method === 'get' && url.endsWith('/counts')).length;

let wrapper;
const open = async () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    wrapper = mount(Inbox, { attachTo: document.body, global: { plugins: [i18n], stubs: { UserProfile: true, ShellIcon: true } } });
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    route.query = {};
    server = { proposals: [proposal('p1'), proposal('p2'), proposal('p3', { locked: true, gate: 'owner_admin' })], approvals: [leave], items: [notice] };
    sendProposalDecision.mockReset();
    sendProposalDecision.mockImplementation(() => Promise.resolve({ data: { status: true, data: { applied: [{ ok: true }], undoUntil: '2026-09-28T09:15:00.000Z' } } }));
    apiRequest.mockReset();
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url.endsWith('/counts')) return ok({ approval: server.proposals.filter((p) => !p.locked).length + server.approvals.length, primary: server.items.length, other: 0, later: 0 });
        if (method === 'get' && tabOf(url) === 'approval') return ok({ items: [], approvals: server.approvals, proposals: server.proposals, hasMore: false, nextSkip: 0 });
        if (method === 'get') return ok({ items: server.items, approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
        return ok({});
    });
});
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the Needs your approval tab', () => {
    it('is the first tab, and its count is what waits for the person', async () => {
        await open();
        const first = wrapper.findAll('.ibx__nav [role="tab"]')[0];
        expect(first.attributes('data-tab')).toBe('approval');
        expect(first.text()).toContain('Inbox.tab_approval');
        expect(en.Inbox.tab_approval).toBe('Needs your approval');
        expect(first.find('.ibx__navcount').text()).toBe('3');
    });

    it('opens first when something waits, and holds the proposals and the leave requests', async () => {
        await open();
        expect(listCalls()).toEqual(['approval']);
        expect(wrapper.findAll('[data-test="queue-row"]')).toHaveLength(3);
        expect(wrapper.findAll('.ibx__card.is-approval')).toHaveLength(1);
        expect(wrapper.text()).not.toContain('Status changed');
    });

    it('counts the rows the person can decide: the two open proposals and the leave request', async () => {
        await open();
        const decidable = wrapper.findAll('[data-test="queue-approve"]').length + wrapper.findAll('.ibx__card.is-approval').length;
        expect(String(decidable)).toBe(wrapper.find('.ibx__nav [data-tab="approval"] .ibx__navcount').text());
    });

    it('opens Primary when nothing waits, and Primary no longer lists proposals', async () => {
        server.proposals = [];
        server.approvals = [];
        await open();
        expect(listCalls()).toEqual(['primary']);
        expect(wrapper.find('[data-test="queue-row"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Status changed');
    });

    it('keeps the tab the link asked for', async () => {
        route.query = { tab: 'primary' };
        await open();
        expect(listCalls()).toEqual(['primary']);
    });

    it('takes an approved row out, refreshes the count and offers an undo that goes through the same route', async () => {
        await open();
        const counted = countCalls();
        await wrapper.find('[data-test="queue-row"][data-id="p1"] [data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', {});
        expect(wrapper.find('[data-test="queue-row"][data-id="p1"]').exists()).toBe(false);
        expect(countCalls()).toBeGreaterThan(counted);
        await wrapper.find('.ibx__undo-btn').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenLastCalledWith('p1', 'undo', {});
    });

    it('says the queue is clear when nothing waits in it', async () => {
        server.proposals = [];
        server.approvals = [];
        route.query = { tab: 'approval' };
        await open();
        expect(wrapper.find('[data-test="inbox-zero"]').exists()).toBe(true);
    });
});
