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
import { followClockPrefs } from '@/utils/clockText';

const NOW = new Date(2026, 9, 2, 18, 0);
const TODAY = new Date(2026, 9, 2, 14, 57, 30).toISOString();
const THIS_WEEK = new Date(2026, 8, 29, 8, 4).toISOString();
const LAST_MONTH = new Date(2026, 8, 12, 12, 19, 37).toISOString();

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const item = (sourceId, createdAt) => ({
    sourceType: 'notification', sourceId, key: 'task_status', kind: 'update', message: 'row', unread: true, createdAt, duplicateIds: [],
});
const ITEMS = [item('64a000000000000000000001', TODAY), item('64a000000000000000000002', THIS_WEEK), item('64a000000000000000000003', LAST_MONTH)];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    route.query = {};
    window.localStorage.clear();
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url.endsWith('/counts')) return ok({ primary: 3, other: 0, later: 0 });
        return ok({ items: ITEMS, approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
    });
});

let wrapper;
afterEach(() => {
    if (wrapper) wrapper.unmount();
    wrapper = null;
    vi.useRealTimers();
});

const whenCells = async () => {
    wrapper = mount(Inbox, { attachTo: document.body, global: { stubs: { UserProfile: true, ShellIcon: true } } });
    await flushPromises();
    return wrapper.findAll('time.ibx__when');
};

describe('the time on an Inbox row', () => {
    it('is the time for a row of today and the day for an older one, for a person on 12-hour time', async () => {
        followClockPrefs({ timeFormat: '12', dateFormat: 'DD/MM/YYYY' });
        const cells = await whenCells();

        expect(cells.map((cell) => cell.text())).toEqual(['2:57 PM', '3d', '12 Sep']);
    });

    it('is the same row in 24-hour time for a person who chose that', async () => {
        followClockPrefs({ timeFormat: '24', dateFormat: 'DD/MM/YYYY' });
        const cells = await whenCells();

        expect(cells.map((cell) => cell.text())).toEqual(['14:57', '3d', '12 Sep']);
    });
});

describe('the tooltip of that time', () => {
    it('is the full date and time as the person reads them elsewhere, not the stored text', async () => {
        followClockPrefs({ timeFormat: '12', dateFormat: 'DD/MM/YYYY' });
        const cells = await whenCells();

        expect(cells.map((cell) => cell.attributes('title'))).toEqual(['02/10/2026, 2:57 PM', '29/09/2026, 8:04 AM', '12/09/2026, 12:19 PM']);
        expect(cells.map((cell) => cell.attributes('datetime'))).toEqual([TODAY, THIS_WEEK, LAST_MONTH]);
    });

    it('follows 24-hour time and the workspace date format', async () => {
        followClockPrefs({ timeFormat: '24', dateFormat: 'MM/DD/YYYY' });
        const cells = await whenCells();

        expect(cells.map((cell) => cell.attributes('title'))).toEqual(['10/02/2026, 14:57', '09/29/2026, 08:04', '09/12/2026, 12:19']);
    });
});
