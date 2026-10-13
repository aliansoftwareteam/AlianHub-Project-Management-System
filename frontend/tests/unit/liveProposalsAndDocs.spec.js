import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, socket } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    socket: { handlers: {}, on(name, handler) { this.handlers[name] = handler; }, off(name) { delete this.handlers[name]; } },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({
    useRoute: () => ({ params: { cid: 'c1' }, query: {} }),
    useRouter: () => ({ replace: () => Promise.resolve(), push: () => Promise.resolve(), hasRoute: () => false }),
}));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({
        getters: { 'settings/getSocketInstance': socket, 'projectData/allProjects': { data: [{ _id: 'p1', ProjectName: 'Launch' }] } },
        commit: vi.fn(),
        dispatch: vi.fn(() => Promise.resolve()),
    }),
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text, checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn(), shellState: {} }));

import Inbox from '@/views/Inbox/Inbox.vue';
import PagesSpace from '@/views/Pages/PagesSpace.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const tabOf = (url) => new URLSearchParams(url.split('?')[1] || '').get('tab');
const past = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const proposal = (id) => ({
    sourceType: 'proposal', sourceId: id, proposalId: id, kind: 'proposal', agentName: 'Claude Code', source: 'mcp', requestedBy: '',
    what: `Archive ${id}`, why: 'Done with it.', changes: [{ action: 'task.archive', label: 'Archive the task', reversible: true }],
    gate: null, locked: false, editable: false, createdAt: '2026-10-08T09:00:00.000Z', unread: true,
});

let wrapper;
beforeEach(() => {
    socket.handlers = {};
    apiRequest.mockReset();
});
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the Inbox while a connected agent files proposals', () => {
    let server;
    beforeEach(() => {
        server = { proposals: [proposal('p1'), proposal('p2')] };
        apiRequest.mockImplementation((method, url) => {
            if (method === 'get' && url.endsWith('/counts')) return ok({ approval: server.proposals.length, primary: 0, other: 0, later: 0 });
            if (method === 'get' && tabOf(url) === 'approval') return ok({ items: [], approvals: [], proposals: server.proposals, hasMore: false, nextSkip: 0 });
            if (method === 'get') return ok({ items: [], approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
            return ok({});
        });
    });
    const open = async () => {
        wrapper = mount(Inbox, { attachTo: document.body, global: { stubs: { UserProfile: true, ShellIcon: true } } });
        await flushPromises();
    };
    const count = () => wrapper.find('.ibx__nav [data-tab="approval"] .ibx__navcount').text();

    it('shows a new proposal and its count without a reload', async () => {
        await open();
        expect(count()).toBe('2');
        server.proposals = [proposal('p3'), ...server.proposals];
        socket.handlers.agentsChanged({ kind: 'proposal' });
        await past(450);
        await flushPromises();
        expect(count()).toBe('3');
        expect(wrapper.findAll('[data-test="queue-row"]')).toHaveLength(3);
    });

    it('reads nothing again for a signal that is not about a proposal, and stops listening once closed', async () => {
        await open();
        const reads = apiRequest.mock.calls.length;
        socket.handlers.agentsChanged({ kind: 'run' });
        await past(450);
        expect(apiRequest.mock.calls.length).toBe(reads);
        wrapper.unmount();
        wrapper = null;
        expect(socket.handlers.agentsChanged).toBeUndefined();
    });
});

describe('the Docs list while an agent makes a doc', () => {
    it('reads the list again when a doc the person can open is made, and stops listening once closed', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
        wrapper = mount(PagesSpace, { global: { stubs: { ShellIcon: true } } });
        await flushPromises();
        expect(wrapper.text()).not.toContain('Agent notes');

        apiRequest.mockResolvedValue({ data: { status: true, data: [{ _id: 'd1', title: 'Agent notes', ProjectID: 'p1', updatedAt: '2026-10-08T09:00:00.000Z' }] } });
        socket.handlers.docsChanged({ type: 'insert' });
        await flushPromises();
        expect(wrapper.text()).toContain('Agent notes');

        wrapper.unmount();
        wrapper = null;
        expect(socket.handlers.docsChanged).toBeUndefined();
    });
});
