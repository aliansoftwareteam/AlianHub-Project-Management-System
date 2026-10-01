import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const { apiRequest, tasks } = vi.hoisted(() => ({ apiRequest: vi.fn(), tasks: { list: [] } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/views/Projects/helper.js', () => ({ taskListHelper: () => ({ groupBy: vi.fn() }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: (id) => ({ Employee_Name: `Name of ${id}` }) }) }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({ getters: { 'projectData/tasks': { p1: { s1: { tasks: tasks.list } } }, 'projectData/tableTasks': {} } }),
}));

import WhiteboardView from '@/views/Projects/WhiteboardView/WhiteboardView.vue';
import { SAVE_DELAY_MS, WHITEBOARD_EVENT, legacyKeyOf, unsavedKeyOf } from '@/views/Projects/WhiteboardView/useWhiteboardBoard';

const URL = '/api/v2/whiteboards/p1/s1';
const MARKUP = '<img src=x onerror=alert(1)>';
const task = (id, name = `Task ${id}`) => ({ _id: id, TaskKey: `AP-${id}`, TaskName: name, deletedStatusKey: 0 });
const element = (id, taskId, x, y, extra = {}) => ({ id, type: 'task', taskId, x, y, z: 0, title: `Task ${taskId}`, taskKey: `AP-${taskId}`, ...extra });
const boardOf = (revision, elements, extra = {}) => ({ boardId: revision ? 'board-1' : null, revision, elements, savedBy: revision ? 'u2' : null, savedAt: null, canEdit: true, limits: { elements: 2000 }, ...extra });
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (status, data) => Promise.reject({ response: { status, data } });
const unreachable = () => Promise.reject({ code: 'ERR_NETWORK', message: 'Network Error' });

let wrapper;
let server;
let patches;
let live;

const calls = (method, url = URL) => apiRequest.mock.calls.filter(([m, u]) => m === method && u === url);
const bodies = () => calls('patch').map(([, , body]) => body);
const state = () => wrapper.find('[data-wb-state]');
const cardOf = (id) => wrapper.find(`[data-wb-card="${id}"]`);
const placeOf = (id) => { const { left, top } = cardOf(id).element.style; return [parseInt(left, 10), parseInt(top, 10)]; };
const settle = async () => { await flushPromises(); await flushPromises(); };
const afterTheDelay = async () => { vi.advanceTimersByTime(SAVE_DELAY_MS); await settle(); };

const drag = async (id, to) => {
    await cardOf(id).trigger('mousedown', { clientX: 0, clientY: 0 });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: to[0], clientY: to[1] }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: to[0], clientY: to[1] }));
    await flushPromises();
};

const open = async (provide = {}) => {
    wrapper = mount(WhiteboardView, {
        props: { projectData: { _id: 'p1' }, sprints: [{ id: 's1' }] },
        attachTo: document.body,
        global: { provide: { selectedProject: ref({ _id: 'p1' }), $socket: live, ...provide } },
    });
    await settle();
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    tasks.list = [task('t1'), task('t2')];
    server = boardOf(1, [element('a', 't1', 100, 200), element('b', 't2', 300, 400)]);
    patches = [];
    live = ref({ id: 'sock', on: vi.fn(), off: vi.fn(), emit: vi.fn() });
    apiRequest.mockReset().mockImplementation((method, url, body) => {
        if (method === 'get' && url === URL) return ok(server);
        if (method === 'patch' && url === URL) return patches.length ? patches.shift()(body) : ok(server);
        if (method === 'get' && url === `${URL}/history`) return ok([{ revision: 1, savedBy: 'u2', savedAt: '2026-10-01T10:00:00.000Z', cards: 2, reason: 'author' }]);
        if (method === 'post' && url === `${URL}/restore`) return ok(boardOf(3, [element('a', 't1', 1, 2), element('b', 't2', 3, 4)]));
        return ok({});
    });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('a whiteboard read from the server', () => {
    it('puts each card where the saved board has it and says the board is saved', async () => {
        await open();
        expect(calls('get')).toHaveLength(1);
        expect(placeOf('t1')).toEqual([100, 200]);
        expect(placeOf('t2')).toEqual([300, 400]);
        expect(state().attributes('data-wb-state')).toBe('saved');
        expect(state().text()).toBe('Views.whiteboard_saved');
    });

    it('draws a card whose task the list has not loaded from what the server sent', async () => {
        server = boardOf(1, [element('a', 't1', 100, 200), element('z', 't9', 500, 600, { title: 'Far down the list', taskKey: 'AP-9' })]);
        await open();
        expect(placeOf('t9')).toEqual([500, 600]);
        expect(cardOf('t9').text()).toContain('Far down the list');
    });

    it('shows a card it may not open as a placeholder, in its place, with no name and no handle to move it', async () => {
        server = boardOf(1, [element('a', 't1', 100, 200), { id: 'w', type: 'task', x: 700, y: 800, z: 0, withheld: true }]);
        await open();
        const placeholder = wrapper.find('[data-wb-withheld="w"]');
        expect(placeholder.text()).toBe('Views.whiteboard_card_withheld');
        expect([placeholder.element.style.left, placeholder.element.style.top]).toEqual(['700px', '800px']);
        await placeholder.trigger('mousedown', { clientX: 0, clientY: 0 });
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 50, clientY: 50 }));
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);
    });

    it('renders a task name as text, never as markup', async () => {
        tasks.list = [task('t1', MARKUP)];
        server = boardOf(1, [element('a', 't1', 100, 200, { title: MARKUP }), element('z', 't9', 5, 6, { title: MARKUP })]);
        await open();
        for (const id of ['t1', 't9']) {
            expect(cardOf(id).text()).toContain(MARKUP);
            expect(cardOf(id).find('img').exists()).toBe(false);
        }
        expect(wrapper.html()).not.toContain('<img');
    });

    it('lets someone who may not change the board look and not move', async () => {
        server = boardOf(1, [element('a', 't1', 100, 200)], { canEdit: false });
        await open();
        expect(state().text()).toBe('Views.view_only');
        expect(wrapper.find('[data-wb-arrange]').exists()).toBe(false);
        await drag('t1', [40, 50]);
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);
        expect(placeOf('t1')).toEqual([100, 200]);
    });
});

describe('saving a move', () => {
    it('waits a moment, sends only the card that moved against the revision it read, and shows Saving then Saved', async () => {
        let finish;
        patches.push((body) => new Promise((resolve) => { finish = () => resolve({ data: { status: true, data: boardOf(2, [element('a', 't1', body.upsert[0].x, body.upsert[0].y), element('b', 't2', 300, 400)]) } }); }));
        await open();
        await drag('t1', [40, 50]);
        expect(placeOf('t1')).toEqual([40, 50]);
        expect(calls('patch')).toHaveLength(0);
        expect(state().attributes('data-wb-state')).toBe('saving');
        expect(state().text()).toBe('Views.whiteboard_saving');

        await afterTheDelay();
        expect(bodies()).toEqual([{ baseRevision: 1, upsert: [{ id: 'a', type: 'task', taskId: 't1', x: 40, y: 50, z: 0 }] }]);
        expect(state().attributes('data-wb-state')).toBe('saving');

        finish();
        await settle();
        expect(state().attributes('data-wb-state')).toBe('saved');
        expect(placeOf('t1')).toEqual([40, 50]);
        expect(localStorage.getItem(unsavedKeyOf('p1', 's1'))).toBeNull();
    });

    it('gathers the moves made within the delay into one save', async () => {
        await open();
        await drag('t1', [40, 50]);
        await drag('t2', [60, 70]);
        await drag('t1', [80, 90]);
        await afterTheDelay();
        expect(bodies()).toHaveLength(1);
        expect(bodies()[0].upsert.map((card) => [card.id, card.x, card.y])).toEqual([['a', 80, 90], ['b', 60, 70]]);
    });

    it('gives a card the board has never held an id of its own', async () => {
        tasks.list = [task('t1'), task('t2'), task('t3')];
        await open();
        await drag('t3', [10, 20]);
        await afterTheDelay();
        const [card] = bodies()[0].upsert;
        expect(card).toMatchObject({ type: 'task', taskId: 't3', x: 10, y: 20, z: 0 });
        expect(card.id).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
        expect(['a', 'b']).not.toContain(card.id);
    });

    it('sends every card when the board is auto-arranged', async () => {
        await open();
        await wrapper.find('[data-wb-arrange]').trigger('click');
        await afterTheDelay();
        expect(bodies()[0].upsert.map((card) => card.id)).toEqual(['a', 'b']);
    });
});

describe('a save that meets someone else\'s', () => {
    it('takes the board the server answers with, puts its own move back on top and saves again', async () => {
        const theirs = boardOf(2, [element('a', 't1', 100, 200), element('b', 't2', 900, 950)]);
        patches.push(() => refused(409, { status: false, code: 'revision_conflict', data: theirs }));
        patches.push((body) => ok(boardOf(3, [element('a', 't1', body.upsert[0].x, body.upsert[0].y), element('b', 't2', 900, 950)])));
        await open();
        await drag('t1', [40, 50]);
        await afterTheDelay();

        expect(bodies().map((body) => body.baseRevision)).toEqual([1, 2]);
        expect(bodies()[1].upsert).toEqual([{ id: 'a', type: 'task', taskId: 't1', x: 40, y: 50, z: 0 }]);
        expect(placeOf('t1')).toEqual([40, 50]);
        expect(placeOf('t2')).toEqual([900, 950]);
        expect(state().attributes('data-wb-state')).toBe('saved');
    });

    it('never sends the whole board to win: the other person\'s card is not in the second save', async () => {
        patches.push(() => refused(409, { status: false, code: 'revision_conflict', data: boardOf(2, [element('a', 't1', 100, 200), element('b', 't2', 900, 950)]) }));
        await open();
        await drag('t1', [40, 50]);
        await afterTheDelay();
        expect(bodies()[1].upsert.map((card) => card.id)).toEqual(['a']);
    });

    it('stops after a few tries and keeps the move on this device', async () => {
        for (let n = 0; n < 10; n += 1) patches.push(() => refused(409, { status: false, code: 'revision_conflict', data: boardOf(2 + n, [element('a', 't1', 100, 200)]) }));
        await open();
        await drag('t1', [40, 50]);
        await afterTheDelay();
        expect(calls('patch').length).toBeLessThanOrEqual(5);
        expect(state().attributes('data-wb-state')).toBe('failed');
        expect(JSON.parse(localStorage.getItem(unsavedKeyOf('p1', 's1')))).toEqual({ t1: { x: 40, y: 50 } });
    });

    it('reads the board again when the server says it changed, and keeps a move it has not saved yet', async () => {
        await open();
        const [, onChanged] = live.value.on.mock.calls.find(([event]) => event === WHITEBOARD_EVENT);
        await drag('t1', [40, 50]);
        server = boardOf(2, [element('a', 't1', 100, 200), element('b', 't2', 900, 950)]);
        onChanged({ boardId: 'board-1', revision: 2 });
        await settle();
        expect(calls('get')).toHaveLength(2);
        expect(placeOf('t2')).toEqual([900, 950]);
        expect(placeOf('t1')).toEqual([40, 50]);

        onChanged({ boardId: 'board-1', revision: 2 });
        onChanged({ boardId: 'another-board', revision: 9 });
        await settle();
        expect(calls('get')).toHaveLength(2);

        wrapper.unmount();
        wrapper = null;
        expect(live.value.off).toHaveBeenCalledWith(WHITEBOARD_EVENT, onChanged);
    });
});

describe('a save that cannot reach the server', () => {
    it('says the changes are kept on this device, keeps them, and saves when the connection is back', async () => {
        patches.push(unreachable);
        await open();
        await drag('t1', [40, 50]);
        await afterTheDelay();
        expect(state().attributes('data-wb-state')).toBe('offline');
        expect(state().text()).toBe('Views.whiteboard_offline');
        expect(placeOf('t1')).toEqual([40, 50]);
        expect(JSON.parse(localStorage.getItem(unsavedKeyOf('p1', 's1')))).toEqual({ t1: { x: 40, y: 50 } });

        window.dispatchEvent(new Event('online'));
        await settle();
        expect(calls('patch')).toHaveLength(2);
        expect(state().attributes('data-wb-state')).toBe('saved');
        expect(localStorage.getItem(unsavedKeyOf('p1', 's1'))).toBeNull();
    });

    it('says so when the board cannot be read, moves nothing, and reads it once the connection is back', async () => {
        apiRequest.mockImplementationOnce(unreachable);
        await open();
        expect(wrapper.find('[data-wb-unavailable]').text()).toBe('Views.whiteboard_load_failed');
        await drag('t1', [40, 50]);
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);

        window.dispatchEvent(new Event('online'));
        await settle();
        expect(wrapper.find('[data-wb-unavailable]').exists()).toBe(false);
        expect(placeOf('t1')).toEqual([100, 200]);
    });

    it('puts changes left unsaved by an earlier visit back on the board and saves them', async () => {
        localStorage.setItem(unsavedKeyOf('p1', 's1'), JSON.stringify({ t2: { x: 11, y: 12 }, gone: { x: 1, y: 1 } }));
        await open();
        expect(placeOf('t2')).toEqual([11, 12]);
        await afterTheDelay();
        expect(bodies()[0]).toMatchObject({ baseRevision: 1 });
        expect(bodies()[0].upsert).toContainEqual({ id: 'b', type: 'task', taskId: 't2', x: 11, y: 12, z: 0 });
    });

    it('says a refused save is not saved, and keeps the change on this device', async () => {
        patches.push(() => refused(403, { status: false, statusText: 'You do not have permission to change this whiteboard.' }));
        await open();
        await drag('t1', [40, 50]);
        await afterTheDelay();
        expect(state().attributes('data-wb-state')).toBe('failed');
        expect(state().text()).toBe('Views.whiteboard_not_saved');
        expect(calls('patch')).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem(unsavedKeyOf('p1', 's1')))).toEqual({ t1: { x: 40, y: 50 } });
    });
});

describe('a board that was kept in this browser', () => {
    const LOCAL = { t1: { x: 21, y: 22 }, t2: { x: 23, y: 24 }, old: { x: 1, y: 1 } };
    const keepLocal = () => localStorage.setItem(legacyKeyOf('p1', 's1'), JSON.stringify(LOCAL));
    const offer = () => wrapper.find('[data-wb-offer]');
    const upload = () => wrapper.find('[data-wb-upload]');

    it('is shown as it was and offered for upload when the workspace has no board, and nothing is sent unasked', async () => {
        keepLocal();
        server = boardOf(0, []);
        await open();
        expect(placeOf('t1')).toEqual([21, 22]);
        expect(offer().text()).toContain('Views.whiteboard_local_offer');
        expect(upload().text()).toBe('Views.whiteboard_upload');
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);
        expect(JSON.parse(localStorage.getItem(legacyKeyOf('p1', 's1')))).toEqual(LOCAL);
    });

    it('keeps saving moves in this browser until it is uploaded', async () => {
        keepLocal();
        server = boardOf(0, []);
        await open();
        await drag('t1', [40, 50]);
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);
        expect(JSON.parse(localStorage.getItem(legacyKeyOf('p1', 's1'))).t1).toEqual({ x: 40, y: 50 });
    });

    it('is uploaded as a first save when asked, and the browser copy is dropped once the server has it', async () => {
        keepLocal();
        server = boardOf(0, []);
        patches.push((body) => ok(boardOf(1, body.upsert.filter((card) => card.taskId !== 'old').map((card) => element(card.id, card.taskId, card.x, card.y)))));
        await open();
        await upload().trigger('click');
        await settle();
        expect(bodies()).toHaveLength(1);
        expect(bodies()[0].baseRevision).toBe(0);
        expect(bodies()[0].upsert.map((card) => [card.taskId, card.x, card.y])).toEqual([['t1', 21, 22], ['t2', 23, 24], ['old', 1, 1]]);
        expect(localStorage.getItem(legacyKeyOf('p1', 's1'))).toBeNull();
        expect(offer().exists()).toBe(false);
        expect(placeOf('t1')).toEqual([21, 22]);
        expect(state().attributes('data-wb-state')).toBe('saved');
    });

    it('does not replace a board someone saved in the meantime: the workspace board is shown and the browser copy is kept', async () => {
        keepLocal();
        server = boardOf(0, []);
        patches.push(() => refused(409, { status: false, code: 'revision_conflict', data: boardOf(1, [element('a', 't1', 100, 200)]) }));
        await open();
        await upload().trigger('click');
        await settle();
        expect(calls('patch')).toHaveLength(1);
        expect(placeOf('t1')).toEqual([100, 200]);
        expect(JSON.parse(localStorage.getItem(legacyKeyOf('p1', 's1')))).toEqual(LOCAL);
        expect(offer().exists()).toBe(false);
        expect(wrapper.find('[data-wb-unused]').text()).toContain('Views.whiteboard_local_unused');
    });

    it('is left alone, and said to be unused, when the workspace already has a board; it goes only when asked', async () => {
        keepLocal();
        await open();
        expect(placeOf('t1')).toEqual([100, 200]);
        expect(offer().exists()).toBe(false);
        expect(JSON.parse(localStorage.getItem(legacyKeyOf('p1', 's1')))).toEqual(LOCAL);
        await wrapper.find('[data-wb-discard]').trigger('click');
        expect(localStorage.getItem(legacyKeyOf('p1', 's1'))).toBeNull();
        expect(wrapper.find('[data-wb-unused]').exists()).toBe(false);
        expect(calls('patch')).toHaveLength(0);
    });

    it('is offered without the upload button to someone who may not change the board', async () => {
        keepLocal();
        server = boardOf(0, [], { canEdit: false });
        await open();
        expect(offer().exists()).toBe(true);
        expect(upload().exists()).toBe(false);
    });

    it('is not made up for a list that never had one: the first move goes to the workspace', async () => {
        server = boardOf(0, []);
        patches.push((body) => ok(boardOf(1, body.upsert.map((card) => element(card.id, card.taskId, card.x, card.y)))));
        await open();
        expect(offer().exists()).toBe(false);
        await drag('t1', [40, 50]);
        await afterTheDelay();
        expect(bodies()[0]).toMatchObject({ baseRevision: 0, upsert: [{ taskId: 't1', x: 40, y: 50 }] });
        expect(localStorage.getItem(legacyKeyOf('p1', 's1'))).toBeNull();
    });
});

describe('earlier states', () => {
    it('lists them with who saved each and restores the one picked', async () => {
        await open();
        await wrapper.find('[data-wb-history]').trigger('click');
        await settle();
        expect(calls('get', `${URL}/history`)).toHaveLength(1);
        const row = wrapper.find('[data-wb-history-row="1"]');
        expect(row.text()).toContain('Name of u2');
        await wrapper.find('[data-wb-restore="1"]').trigger('click');
        await settle();
        expect(calls('post', `${URL}/restore`)[0][2]).toEqual({ revision: 1 });
        expect(placeOf('t1')).toEqual([1, 2]);
        expect(placeOf('t2')).toEqual([3, 4]);
    });

    it('offers no restore to someone who may not change the board', async () => {
        server = boardOf(1, [element('a', 't1', 100, 200)], { canEdit: false });
        await open();
        await wrapper.find('[data-wb-history]').trigger('click');
        await settle();
        expect(wrapper.find('[data-wb-history-row="1"]').exists()).toBe(true);
        expect(wrapper.find('[data-wb-restore="1"]').exists()).toBe(false);
    });
});
