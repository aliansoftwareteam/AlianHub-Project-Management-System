/* The Inbox reads its list again whenever something arrives. The rows on screen stay there while it does: the
   "Loading…" state is for the first read of a tab, and a person keeps their place, their row and their half-made
   decision. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, getters } = vi.hoisted(() => ({ apiRequest: vi.fn(), getters: { current: null } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({
    useRoute: () => ({ query: { tab: 'primary' }, params: {} }),
    useRouter: () => ({ replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => false }),
}));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: getters.current }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn(), shellState: { agentsRunning: 0 } }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import { reactive } from 'vue';
import Inbox from '@/views/Inbox/Inbox.vue';
import AiInbox from '@/views/Ai/AiInbox.vue';
import { MAX_REFRESH_ROWS, refreshLimit, stitchRows } from '@/views/Inbox/refreshInPlace';

const LIVE_SETTLE_MS = 400;
const ROW_HEIGHT = 100;
const id = (n) => `64a0000000000000000000${String(n).padStart(2, '0')}`;
const row = (n) => ({
    sourceType: 'notification', sourceId: id(n), key: 'task_status', kind: 'update', message: `row ${n}`,
    unread: true, createdAt: '2026-09-24T09:00:00.000Z', duplicateIds: [],
});
const page = (rows, more = {}) => ({ items: rows, approvals: [], proposals: [], applied: [], hasMore: false, nextSkip: rows.length, ...more });
const ok = (data) => ({ data: { status: true, data } });

let wrapper;
let listReads;
let answerList;

const somethingArrives = async () => {
    getters.current['users/myCounts'].data.notification_counts += 1;
    await flushPromises();
    vi.advanceTimersByTime(LIVE_SETTLE_MS);
    await flushPromises();
};
/* The read that is on its way: nothing is drawn from it until the test lets it land. */
const holdTheNextRead = () => {
    let land;
    answerList = () => new Promise((resolve) => { land = (data) => resolve(ok(data)); });
    return async (data) => { land(data); await flushPromises(); };
};

const cards = () => wrapper.findAll('.ibx__card');
const shown = () => cards().map((card) => card.text().match(/row \d+/)?.[0]);
const openInbox = async (first) => {
    answerList = () => Promise.resolve(ok(first));
    wrapper = mount(Inbox, { attachTo: document.body, global: { stubs: { UserProfile: true, ShellIcon: true } } });
    await flushPromises();
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.localStorage.clear();
    getters.current = reactive({ 'users/myCounts': { data: { notification_counts: 1, mention_counts: 0 } } });
    listReads = [];
    apiRequest.mockReset();
    apiRequest.mockImplementation((method, url) => {
        if (url.endsWith('/counts')) return Promise.resolve(ok({ primary: 2, other: 0, later: 0, approval: 0 }));
        if (method !== 'get') return Promise.resolve(ok({}));
        listReads.push(url);
        return answerList(url);
    });
});
afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe('the Inbox while a live refresh is on its way', () => {
    it('keeps its rows on screen and shows no loading state', async () => {
        await openInbox(page([row(1), row(2)]));
        const land = holdTheNextRead();

        await somethingArrives();

        expect(listReads).toHaveLength(2);
        expect(wrapper.find('.ibx__state').exists()).toBe(false);
        expect(shown()).toEqual(['row 1', 'row 2']);

        await land(page([row(3), row(1), row(2)]));
        expect(shown()).toEqual(['row 3', 'row 1', 'row 2']);
    });

    it('keeps the row a person is on: the same element, still focused, still the cursor', async () => {
        await openInbox(page([row(1), row(2)]));
        const second = cards()[1].element;
        second.focus();
        await flushPromises();
        const land = holdTheNextRead();

        await somethingArrives();
        await land(page([row(3), row(1), row(2)]));

        expect(cards()[2].element).toBe(second);
        expect(document.activeElement).toBe(second);
        expect(cards().map((card) => card.classes('is-cursor'))).toEqual([false, false, true]);
    });

    it('moves focus to the row that took its place when the row a person was on is gone', async () => {
        await openInbox(page([row(1), row(2), row(3)]));
        cards()[1].element.focus();
        await flushPromises();
        const land = holdTheNextRead();

        await somethingArrives();
        await land(page([row(1), row(3)]));

        expect(document.activeElement).toBe(cards()[1].element);
        expect(shown()).toEqual(['row 1', 'row 3']);
    });

    it('keeps the rows a person scrolled to where they were when a row arrives above them', async () => {
        const top = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
        const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
        Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get() { return [...(this.parentElement?.querySelectorAll('.ibx__card') || [])].indexOf(this) * ROW_HEIGHT; } });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return ROW_HEIGHT; } });
        try {
            await openInbox(page([row(1), row(2), row(3)]));
            const list = wrapper.find('.ibx__list').element;
            list.scrollTop = ROW_HEIGHT + 30;
            const land = holdTheNextRead();

            await somethingArrives();
            await land(page([row(4), row(1), row(2), row(3)]));

            expect(list.scrollTop).toBe(2 * ROW_HEIGHT + 30);
        } finally {
            Object.defineProperty(HTMLElement.prototype, 'offsetTop', top);
            Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
        }
    });

    it('leaves an empty Inbox as it is drawn: the empty state is not taken away and drawn again', async () => {
        await openInbox(page([]));
        const empty = wrapper.find('[data-test="inbox-zero"]').element;
        const land = holdTheNextRead();

        await somethingArrives();
        expect(wrapper.find('.ibx__state').exists()).toBe(false);
        expect(wrapper.find('[data-test="inbox-zero"]').element).toBe(empty);

        await land(page([]));
        expect(wrapper.find('[data-test="inbox-zero"]').element).toBe(empty);
    });

    it('reads again every row a person loaded, so the rows past the first page stay', async () => {
        const first = Array.from({ length: 10 }, (_, i) => row(i + 1));
        const second = Array.from({ length: 10 }, (_, i) => row(i + 11));
        await openInbox(page(first, { hasMore: true, nextSkip: 10 }));
        answerList = () => Promise.resolve(ok(page(second, { hasMore: true, nextSkip: 20 })));
        await wrapper.find('.ibx__more').trigger('click');
        await flushPromises();
        expect(cards()).toHaveLength(20);
        answerList = () => Promise.resolve(ok(page([row(21), ...first, ...second.slice(0, 9)], { hasMore: true, nextSkip: 20 })));

        await somethingArrives();

        expect(new URLSearchParams(listReads.at(-1).split('?')[1]).get('limit')).toBe('20');
        expect(shown().slice(0, 2)).toEqual(['row 21', 'row 1']);
        expect(shown().at(-1)).toBe('row 20');
        expect(cards()).toHaveLength(21);
    });

    it('keeps its rows when the refresh fails', async () => {
        await openInbox(page([row(1), row(2)]));
        answerList = () => Promise.reject(new Error('offline'));

        await somethingArrives();

        expect(shown()).toEqual(['row 1', 'row 2']);
        expect(wrapper.find('.ibx__state--error').exists()).toBe(false);
    });

    it('still shows the loading state for the first read of another tab', async () => {
        await openInbox(page([row(1)]));
        holdTheNextRead();

        await wrapper.find('#ibx-tab-top-other').trigger('click');

        expect(wrapper.find('.ibx__state').text()).toBe('Inbox.loading');
        expect(cards()).toHaveLength(0);
    });

    it('drops a refresh that lands after the person moved to another tab', async () => {
        await openInbox(page([row(1)]));
        const landRefresh = holdTheNextRead();
        await somethingArrives();
        answerList = () => Promise.resolve(ok(page([row(7)])));
        await wrapper.find('#ibx-tab-top-other').trigger('click');
        await flushPromises();

        await landRefresh(page([row(2), row(1)]));

        expect(shown()).toEqual(['row 7']);
    });
});

describe('the rows a refresh keeps', () => {
    const keyOf = (item) => item.id;
    const rows = (...ids) => ids.map((value) => ({ id: value }));

    it('asks for as many rows as are on screen, within what one read may bring', () => {
        expect(refreshLimit(0)).toBe(10);
        expect(refreshLimit(23)).toBe(23);
        expect(refreshLimit(400)).toBe(MAX_REFRESH_ROWS);
    });

    it('is what the server sent when that is the whole list', () => {
        expect(stitchRows(rows('a', 'b', 'c'), rows('n', 'a'), keyOf, false)).toEqual(rows('n', 'a'));
    });

    it('keeps the rows loaded past the last row both lists hold', () => {
        expect(stitchRows(rows('a', 'b', 'c', 'd'), rows('n', 'a', 'c'), keyOf, true)).toEqual(rows('n', 'a', 'c', 'd'));
    });

    it('is what the server sent when the two lists share no row', () => {
        expect(stitchRows(rows('a', 'b'), rows('n', 'm'), keyOf, true)).toEqual(rows('n', 'm'));
    });
});

describe('the AI Inbox after a decision', () => {
    const proposal = (n) => ({
        _id: `pr${n}`, agentName: 'QA', what: `Change ${n}`, why: 'The list is full', status: 'pending',
        changes: [{ label: `Move T-${n}`, reversible: true }], createdAt: new Date().toISOString(),
    });
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });

    it('keeps the rows that are left on screen while the list is read again', async () => {
        let waiting = [proposal(1), proposal(2)];
        let land = null;
        apiRequest.mockImplementation((method, url) => {
            if (method === 'post') { waiting = [proposal(2)]; return Promise.resolve(ok({})); }
            if (!url.includes('/proposals')) return Promise.resolve(ok({}));
            const answer = { data: { status: true, data: waiting, counts: { waiting: waiting.length } } };
            if (!land) return Promise.resolve(answer);
            return new Promise((resolve) => { land = () => resolve(answer); });
        });
        wrapper = mount(AiInbox, { attachTo: document.body, global: { plugins: [store] } });
        await flushPromises();
        expect(wrapper.findAll('.ai-item')).toHaveLength(2);
        land = () => {};

        await wrapper.find('.ai-item').trigger('click');
        await wrapper.find('[data-test="decline"]').trigger('click');
        await wrapper.find('[data-test="decline-skip"]').trigger('click');
        await flushPromises();

        expect(wrapper.text()).not.toContain('Ai.loading');
        expect(wrapper.findAll('.ai-item')).toHaveLength(2);

        land();
        await flushPromises();
        expect(wrapper.findAll('.ai-item')).toHaveLength(1);
    });
});
