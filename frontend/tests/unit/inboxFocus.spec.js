import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route, router, openRoute } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { query: {}, params: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => false },
    openRoute: vi.fn(),
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import Inbox from '@/views/Inbox/Inbox.vue';
import { bindRouter, closeTask, overlayState } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

const id = (n) => `64a0000000000000000000${String(n).padStart(2, '0')}`;
const taskIdOf = (n) => `74b0000000000000000000${String(n).padStart(2, '0')}`;
const row = (n, extra = {}) => ({
    sourceType: 'notification',
    sourceId: id(n),
    key: 'task_status',
    kind: 'update',
    message: `row ${n}`,
    unread: true,
    createdAt: '2026-09-24T09:00:00.000Z',
    duplicateIds: [],
    ...extra,
});
const mention = (n) => row(n, {
    sourceType: 'mention',
    kind: 'mention',
    key: 'mention',
    type: 'task',
    taskId: taskIdOf(n),
    projectId: '84c000000000000000000001',
    sprintId: '94d000000000000000000001',
    folderId: '',
    companyId: '54e000000000000000000001',
});
const ok = (data) => Promise.resolve({ data: { status: true, data } });

let primaryRows;
beforeEach(() => {
    route.query = {};
    route.params = {};
    router.replace.mockClear();
    router.push.mockClear();
    openRoute.mockClear();
    apiRequest.mockReset();
    primaryRows = [row(1), row(2), row(3)];
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url.endsWith('/counts')) return ok({ primary: primaryRows.length, other: 0, later: 0 });
        if (method === 'get') return ok({ items: primaryRows, approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
        return ok({ count: 1 });
    });
    window.localStorage.clear();
    bindRouter(router, route);
});

let wrapper;
let outsideInput;
afterEach(() => {
    if (wrapper) wrapper.unmount();
    wrapper = null;
    if (outsideInput) outsideInput.remove();
    outsideInput = null;
    closeTask({ keepRoute: true });
});

const mountInbox = async () => {
    wrapper = mount(Inbox, {
        attachTo: document.body,
        global: { stubs: { UserProfile: true, ShellIcon: true } },
    });
    await flushPromises();
    return wrapper;
};
const cards = () => wrapper.findAll('.ibx__card');
const focusedCard = () => cards().findIndex((c) => c.element === document.activeElement);
const press = async (target, key) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await flushPromises();
};

describe('Inbox focus on load', () => {
    it('puts focus on the first card once the list loads', async () => {
        await mountInbox();
        expect(cards()).toHaveLength(3);
        expect(focusedCard()).toBe(0);
    });

    it('leaves focus in a text field the person is typing in', async () => {
        outsideInput = document.createElement('input');
        document.body.appendChild(outsideInput);
        outsideInput.focus();
        await mountInbox();
        expect(document.activeElement).toBe(outsideInput);
    });

    it('lets j and k move into the list when nothing has focus', async () => {
        await mountInbox();
        document.activeElement.blur();
        expect(document.activeElement).toBe(document.body);
        await press(document.body, 'j');
        expect(focusedCard()).toBeGreaterThanOrEqual(0);
        await press(document.activeElement, 'j');
        expect(cards()[focusedCard()].classes()).toContain('is-cursor');
        expect(focusedCard()).toBeGreaterThan(0);
    });
});

describe('Inbox focus after clearing or snoozing', () => {
    it('e moves focus to the next card', async () => {
        await mountInbox();
        await press(cards()[0].element, 'e');
        expect(cards()).toHaveLength(2);
        expect(cards()[0].text()).toContain('row 2');
        expect(focusedCard()).toBe(0);
        await press(document.activeElement, 'e');
        expect(cards()).toHaveLength(1);
        expect(cards()[0].text()).toContain('row 3');
        expect(focusedCard()).toBe(0);
    });

    it('j then e then e clears two cards with no click', async () => {
        await mountInbox();
        await press(document.activeElement, 'j');
        await press(document.activeElement, 'e');
        await press(document.activeElement, 'e');
        expect(cards().map((c) => c.text().match(/row \d/)[0])).toEqual(['row 1']);
        expect(focusedCard()).toBe(0);
    });

    it('clearing the last card moves focus to the one before it', async () => {
        await mountInbox();
        await press(cards()[0].element, 'j');
        await press(document.activeElement, 'j');
        expect(focusedCard()).toBe(2);
        await press(document.activeElement, 'e');
        expect(cards()).toHaveLength(2);
        expect(focusedCard()).toBe(1);
    });

    it('the Clear button moves focus to the next card too', async () => {
        await mountInbox();
        const clear = cards()[0].findAll('button').find((b) => b.text() === 'Inbox.clear');
        clear.element.focus();
        await clear.trigger('click');
        await flushPromises();
        expect(focusedCard()).toBe(0);
        expect(cards()[0].text()).toContain('row 2');
    });

    it('a snooze preset moves focus to the next card', async () => {
        await mountInbox();
        await press(cards()[0].element, 's');
        await wrapper.find('[data-preset="tomorrow"]').trigger('click');
        await flushPromises();
        expect(cards()).toHaveLength(2);
        expect(focusedCard()).toBe(0);
        expect(cards()[0].text()).toContain('row 2');
    });
});

describe('Inbox open task', () => {
    it('opens the task over the Inbox with ?task= and marks the row read', async () => {
        primaryRows = [mention(1), row(2)];
        await mountInbox();
        const open = cards()[0].findAll('button').find((b) => b.text() === 'Inbox.open_task');
        await open.trigger('click');
        await flushPromises();

        expect(openRoute).not.toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();
        expect(overlayState.open).toBe(true);
        expect(overlayState.current).toEqual(expect.objectContaining({
            taskId: taskIdOf(1),
            projectId: '84c000000000000000000001',
            sprintId: '94d000000000000000000001',
        }));
        const nav = router.replace.mock.calls.map(([to]) => to).find((to) => to && to.query && to.query.task);
        expect(nav.query.task).toBe(taskIdOf(1));
        expect(nav.name).toBeUndefined();

        const read = apiRequest.mock.calls.filter(([m, url]) => m === 'post' && url === '/api/v1/inbox/read');
        expect(read).toHaveLength(1);
        expect(read[0][2].items[0]).toEqual(expect.objectContaining({ sourceType: 'mention', sourceId: id(1) }));
    });

    it('Enter on a focused card opens the overlay, and closing it returns focus to the list', async () => {
        primaryRows = [mention(1), mention(2)];
        await mountInbox();
        await press(cards()[0].element, 'Enter');
        expect(overlayState.open).toBe(true);
        document.activeElement.blur();
        closeTask();
        await flushPromises();
        expect(focusedCard()).toBe(0);
    });

    it('takes focus back from a panel that is still closing', async () => {
        primaryRows = [mention(1), mention(2)];
        await mountInbox();
        await press(cards()[0].element, 'Enter');
        const leaving = document.createElement('div');
        leaving.className = 'ah-detail';
        leaving.innerHTML = '<button type="button">Close</button>';
        document.body.appendChild(leaving);
        leaving.querySelector('button').focus();
        closeTask();
        await flushPromises();
        leaving.remove();
        expect(focusedCard()).toBe(0);
    });

    it('a channel mention still leaves for the channel', async () => {
        primaryRows = [{ ...mention(1), mainChat: true }];
        await mountInbox();
        const open = cards()[0].findAll('button').find((b) => b.text() === 'Inbox.open_chat');
        await open.trigger('click');
        await flushPromises();
        expect(openRoute).toHaveBeenCalledTimes(1);
        expect(overlayState.open).toBe(false);
    });
});
