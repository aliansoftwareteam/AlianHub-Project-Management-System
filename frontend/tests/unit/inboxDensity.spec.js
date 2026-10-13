import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { query: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => false },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import Inbox from '@/views/Inbox/Inbox.vue';
import { DENSITY_KEY } from '@/views/Inbox/inboxDensity';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const item = {
    sourceType: 'notification', sourceId: '64a000000000000000000001', key: 'task_status', kind: 'update',
    message: 'row', unread: true, createdAt: '2026-09-24T09:00:00.000Z', duplicateIds: [],
};

beforeEach(() => {
    route.query = {};
    window.localStorage.clear();
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url.endsWith('/counts')) return ok({ primary: 1, other: 0, later: 0 });
        return ok({ items: [item], approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
    });
});

let wrapper;
afterEach(() => { if (wrapper) wrapper.unmount(); wrapper = null; });

const mountInbox = async () => {
    wrapper = mount(Inbox, { attachTo: document.body, global: { stubs: { UserProfile: true, ShellIcon: true } } });
    await flushPromises();
};
const page = () => wrapper.find('.ibx');

describe('Inbox row density', () => {
    it('is comfortable until the reader chooses', async () => {
        await mountInbox();
        expect(page().attributes('data-density')).toBe('comfortable');
        expect(wrapper.find('.ibx__toolbar .vdc__trigger').exists()).toBe(true);
    });

    it('compact is set on the page root, where the compact tokens apply to every row', async () => {
        await mountInbox();
        await wrapper.find('.vdc__trigger').trigger('click');
        await wrapper.find('.vdc__option input[value="compact"]').setValue(true);
        expect(page().attributes('data-density')).toBe('compact');
        expect(page().find('.ibx__card').exists()).toBe(true);
        expect(window.localStorage.getItem(DENSITY_KEY)).toBe('compact');
    });

    it('the choice is still there on the next visit', async () => {
        window.localStorage.setItem(DENSITY_KEY, 'compact');
        await mountInbox();
        expect(page().attributes('data-density')).toBe('compact');
        expect(wrapper.find('.vdc__option input[value="compact"]').exists()).toBe(false);
        await wrapper.find('.vdc__trigger').trigger('click');
        expect(wrapper.find('.vdc__option input[value="compact"]').element.checked).toBe(true);
    });
});
