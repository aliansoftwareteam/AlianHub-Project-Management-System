import fs from 'fs';
import path from 'path';
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
import { SAVE_DELAY_MS, NOTE_TONES, NOTE_BOUNDS, legacyKeyOf, unsavedKeyOf } from '@/views/Projects/WhiteboardView/useWhiteboardBoard';
import { NOTE_TONES as SERVER_TONES, MIN_WIDTH, MIN_HEIGHT, MAX_WIDTH, MAX_HEIGHT } from '../../../Modules/Whiteboards/boardRules';

const URL = '/api/v2/whiteboards/p1/s1';
const MARKUP = '<img src=x onerror=alert(1)><b>bold</b>';
const VIEW_DIR = path.resolve(__dirname, '../../src/views/Projects/WhiteboardView');
const card = (id, taskId, x, y) => ({ id, type: 'task', taskId, x, y, z: 0, title: `Task ${taskId}`, taskKey: `AP-${taskId}` });
const note = (id, text = 'Ask finance', extra = {}) => ({ id, type: 'note', text, tone: 'amber', x: 300, y: 200, w: 180, h: 120, z: 1, ...extra });
const label = (id, text = 'Q4 plan', extra = {}) => ({ id, type: 'text', text, x: 500, y: 60, w: 220, h: 40, z: 2, ...extra });
const boardOf = (revision, elements, extra = {}) => ({ boardId: revision ? 'board-1' : null, revision, elements, savedBy: 'u2', savedAt: null, canEdit: true, limits: { elements: 2000, notes: 500, text: 2000 }, ...extra });
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (status, data) => Promise.reject({ response: { status, data } });
const unreachable = () => Promise.reject({ code: 'ERR_NETWORK', message: 'Network Error' });

let wrapper;
let server;
let patches;

const calls = (method, url = URL) => apiRequest.mock.calls.filter(([m, u]) => m === method && u === url);
const bodies = () => calls('patch').map(([, , body]) => body);
const noteOf = (id) => wrapper.find(`[data-wb-note="${id}"]`);
const notes = () => wrapper.findAll('[data-wb-note]');
const boxOf = (id) => { const { left, top, width, height } = noteOf(id).element.style; return [left, top, width, height].map((value) => parseInt(value, 10)); };
const board = () => wrapper.find('[data-wb-board]');
const settle = async () => { await flushPromises(); await flushPromises(); };
const afterTheDelay = async () => { vi.advanceTimersByTime(SAVE_DELAY_MS); await settle(); };
const pointer = (type, at, extra = {}) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: at[0], clientY: at[1], button: 0, pointerId: 1, ...extra });
const press = (target, at = [0, 0], extra = {}) => target.element.dispatchEvent(pointer('pointerdown', at, extra));
const dragFrom = async (target, to, extra = {}) => {
    press(target, [0, 0], extra);
    window.dispatchEvent(pointer('pointermove', to, extra));
    window.dispatchEvent(pointer('pointerup', to, extra));
    await flushPromises();
};
const select = async (id) => { press(noteOf(id)); window.dispatchEvent(pointer('pointerup', [0, 0])); await flushPromises(); };
const type = async (id, text) => { await noteOf(id).find('textarea').setValue(text); };

const open = async () => {
    wrapper = mount(WhiteboardView, {
        props: { projectData: { _id: 'p1' }, sprints: [{ id: 's1' }] },
        attachTo: document.body,
        global: { provide: { selectedProject: ref({ _id: 'p1' }), $socket: ref({ id: 'sock', on: vi.fn(), off: vi.fn(), emit: vi.fn() }) } },
    });
    await settle();
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    tasks.list = [{ _id: 't1', TaskKey: 'AP-1', TaskName: 'Task t1', deletedStatusKey: 0 }];
    server = boardOf(1, [card('a', 't1', 100, 200), note('n1'), label('x1')]);
    patches = [];
    apiRequest.mockReset().mockImplementation((method, url, body) => {
        if (method === 'get' && url === URL) return ok(server);
        if (method === 'patch' && url === URL) return patches.length ? patches.shift()(body) : ok({ ...server, revision: server.revision + 1 });
        return ok([]);
    });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('notes and text on the board', () => {
    it('are drawn where the saved board has them, at their size, a note in its tone and a text with none', async () => {
        await open();
        expect(boxOf('n1')).toEqual([300, 200, 180, 120]);
        expect(boxOf('x1')).toEqual([500, 60, 220, 40]);
        expect(noteOf('n1').classes()).toEqual(expect.arrayContaining(['is-note', 'tone-amber']));
        expect(noteOf('x1').classes()).toContain('is-text');
        expect(noteOf('x1').classes().some((name) => name.startsWith('tone-'))).toBe(false);
        expect(noteOf('n1').text()).toContain('Ask finance');
        expect(wrapper.find('[data-wb-card="t1"]').exists()).toBe(true);
    });

    it('shows markup someone saved in a note as the text it is', async () => {
        server = boardOf(1, [note('n1', MARKUP), label('x1', MARKUP)]);
        await open();
        for (const id of ['n1', 'x1']) {
            expect(noteOf(id).text()).toContain(MARKUP);
            expect(noteOf(id).find('img').exists()).toBe(false);
            expect(noteOf(id).find('b').exists()).toBe(false);
        }
        expect(wrapper.html()).not.toContain('<img');
    });

    it('knows the tones and sizes the server takes, and names a token for each tone', () => {
        expect(NOTE_TONES).toEqual(SERVER_TONES);
        expect(NOTE_BOUNDS).toEqual({ minW: MIN_WIDTH, maxW: MAX_WIDTH, minH: MIN_HEIGHT, maxH: MAX_HEIGHT });
        const styles = fs.readFileSync(path.join(VIEW_DIR, 'WhiteboardNote.vue'), 'utf8');
        NOTE_TONES.forEach((tone) => expect(styles).toMatch(new RegExp(`\\.tone-${tone}\\s*\\{\\s*--tone:\\s*var\\(--[a-z-]+\\)`)));
        expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });
});

describe('making and changing a note', () => {
    it('adds a note ready to type in, and saves it as one new element', async () => {
        await open();
        await wrapper.find('[data-wb-add-note]').trigger('click');
        expect(notes()).toHaveLength(3);
        const made = notes()[2];
        expect(made.find('textarea').exists()).toBe(true);
        expect(made.classes()).toEqual(expect.arrayContaining(['is-note', 'tone-amber']));

        await afterTheDelay();
        expect(bodies()).toHaveLength(1);
        const [{ baseRevision, upsert, remove }] = bodies();
        expect({ baseRevision, remove }).toEqual({ baseRevision: 1, remove: undefined });
        expect(upsert).toEqual([{ id: expect.stringMatching(/^[A-Za-z0-9_-]{8,40}$/), type: 'note', text: '', tone: 'amber', x: expect.any(Number), y: expect.any(Number), w: 180, h: 120, z: 3 }]);
    });

    it('adds a plain text the same way, with no tone', async () => {
        await open();
        await wrapper.find('[data-wb-add-text]').trigger('click');
        await afterTheDelay();
        const [made] = bodies()[0].upsert;
        expect(made).toMatchObject({ type: 'text', text: '', w: 220, h: 40 });
        expect(made).not.toHaveProperty('tone');
    });

    it('saves what is typed, as typed, and shows typed markup as text', async () => {
        await open();
        await select('n1');
        await noteOf('n1').find('[data-wb-note-edit]').trigger('click');
        await type('n1', MARKUP);
        await afterTheDelay();
        expect(bodies()).toEqual([{ baseRevision: 1, upsert: [{ ...note('n1', MARKUP) }] }]);

        await noteOf('n1').find('textarea').trigger('blur');
        expect(noteOf('n1').find('textarea').exists()).toBe(false);
        expect(noteOf('n1').text()).toContain(MARKUP);
        expect(noteOf('n1').find('img').exists()).toBe(false);
        expect(wrapper.html()).not.toContain('<img');
    });

    it('holds typing to the length the server takes', async () => {
        await open();
        await select('n1');
        await noteOf('n1').find('[data-wb-note-edit]').trigger('click');
        expect(noteOf('n1').find('textarea').attributes('maxlength')).toBe('2000');
        await type('n1', 'x'.repeat(2500));
        await afterTheDelay();
        expect(bodies()[0].upsert[0].text).toHaveLength(2000);
    });

    it('opens for typing on a double click and on Enter, and leaves on Escape', async () => {
        await open();
        await noteOf('n1').trigger('dblclick');
        expect(noteOf('n1').find('textarea').exists()).toBe(true);
        await noteOf('n1').find('textarea').trigger('keydown', { key: 'Escape' });
        expect(noteOf('n1').find('textarea').exists()).toBe(false);
        await noteOf('x1').trigger('keydown', { key: 'Enter' });
        expect(noteOf('x1').find('textarea').exists()).toBe(true);
    });

    it('moves with a drag and saves its new place', async () => {
        await open();
        await dragFrom(noteOf('n1'), [40, 50]);
        expect(boxOf('n1').slice(0, 2)).toEqual([40, 50]);
        await afterTheDelay();
        expect(bodies()).toEqual([{ baseRevision: 1, upsert: [note('n1', 'Ask finance', { x: 40, y: 50 })] }]);
    });

    it('is only selected, not moved or saved, by a press that does not travel', async () => {
        await open();
        await select('n1');
        expect(noteOf('n1').classes()).toContain('is-selected');
        expect(noteOf('n1').find('[data-wb-note-tools]').exists()).toBe(true);
        expect(noteOf('x1').find('[data-wb-note-tools]').exists()).toBe(false);
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);
    });

    it('is resized by its handle, within the sizes the server takes', async () => {
        await open();
        await select('n1');
        await dragFrom(noteOf('n1').find('[data-wb-note-resize]'), [60, 30]);
        expect(boxOf('n1')).toEqual([300, 200, 240, 150]);
        await dragFrom(noteOf('n1').find('[data-wb-note-resize]'), [-5000, -5000]);
        expect(boxOf('n1').slice(2)).toEqual([MIN_WIDTH, MIN_HEIGHT]);
        await dragFrom(noteOf('n1').find('[data-wb-note-resize]'), [5000, 0]);
        expect(boxOf('n1')[2]).toBe(MAX_WIDTH);
        await afterTheDelay();
        expect(bodies()).toEqual([{ baseRevision: 1, upsert: [note('n1', 'Ask finance', { w: MAX_WIDTH, h: MIN_HEIGHT })] }]);
    });

    it('takes another tone from the fixed list', async () => {
        await open();
        await select('n1');
        expect(noteOf('n1').findAll('[data-wb-tone]').map((button) => button.attributes('data-wb-tone'))).toEqual(NOTE_TONES);
        await noteOf('n1').find('[data-wb-tone="green"]').trigger('click');
        expect(noteOf('n1').classes()).toContain('tone-green');
        await afterTheDelay();
        expect(bodies()[0].upsert).toEqual([note('n1', 'Ask finance', { tone: 'green' })]);

        await select('x1');
        expect(noteOf('x1').findAll('[data-wb-tone]')).toHaveLength(0);
    });

    it('is deleted from its tools or with the Delete key, by its id', async () => {
        await open();
        await select('n1');
        await noteOf('n1').find('[data-wb-note-delete]').trigger('click');
        expect(noteOf('n1').exists()).toBe(false);
        await noteOf('x1').trigger('keydown', { key: 'Delete' });
        expect(noteOf('x1').exists()).toBe(false);
        await afterTheDelay();
        expect(bodies()).toEqual([{ baseRevision: 1, remove: ['n1', 'x1'] }]);
        expect(wrapper.find('[data-wb-card="t1"]').exists()).toBe(true);
    });

    it('does not take a Delete typed inside the note as deleting the note', async () => {
        await open();
        await noteOf('n1').trigger('dblclick');
        await noteOf('n1').find('textarea').trigger('keydown', { key: 'Delete' });
        await noteOf('n1').find('textarea').trigger('keydown', { key: 'Backspace' });
        expect(noteOf('n1').exists()).toBe(true);
    });

    it('stops offering new notes once the board holds as many as it may', async () => {
        server = boardOf(1, [note('n1'), label('x1')], { limits: { elements: 2000, notes: 2, text: 2000 } });
        await open();
        expect(wrapper.find('[data-wb-add-note]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-wb-add-text]').attributes('disabled')).toBeDefined();
    });
});

describe('a note save that meets trouble', () => {
    it('puts its own note back on top of the board a 409 answers with, and sends that note alone', async () => {
        const theirs = boardOf(2, [card('a', 't1', 100, 200), note('n1'), label('x1', 'Their heading')]);
        patches.push(() => refused(409, { status: false, code: 'revision_conflict', data: theirs }));
        patches.push((body) => ok(boardOf(3, [card('a', 't1', 100, 200), body.upsert[0], label('x1', 'Their heading')])));
        await open();
        await noteOf('n1').trigger('dblclick');
        await type('n1', 'Mine');
        await afterTheDelay();
        expect(bodies().map((body) => [body.baseRevision, body.upsert.map((element) => element.id)])).toEqual([[1, ['n1']], [2, ['n1']]]);
        expect(noteOf('n1').find('textarea').element.value).toBe('Mine');
        expect(noteOf('x1').text()).toContain('Their heading');
    });

    it('keeps an unsaved note on this device while offline and sends it on the next visit', async () => {
        patches.push(unreachable, unreachable);
        await open();
        await dragFrom(noteOf('n1'), [40, 50]);
        await noteOf('x1').trigger('keydown', { key: 'Delete' });
        await afterTheDelay();
        expect(wrapper.find('[data-wb-state]').attributes('data-wb-state')).toBe('offline');
        expect(JSON.parse(localStorage.getItem(unsavedKeyOf('p1', 's1')))).toEqual({ 'el:n1': { element: note('n1', 'Ask finance', { x: 40, y: 50 }) }, 'el:x1': { remove: true } });

        wrapper.unmount();
        apiRequest.mockClear();
        await open();
        expect(boxOf('n1').slice(0, 2)).toEqual([40, 50]);
        expect(noteOf('x1').exists()).toBe(false);
        await afterTheDelay();
        expect(bodies().pop()).toEqual({ baseRevision: 1, upsert: [note('n1', 'Ask finance', { x: 40, y: 50 })], remove: ['x1'] });
    });
});

describe('someone who may only read the board', () => {
    beforeEach(() => { server = boardOf(1, [card('a', 't1', 100, 200), note('n1'), label('x1')], { canEdit: false }); });

    it('reads the notes and can change none of them', async () => {
        await open();
        expect(noteOf('n1').text()).toContain('Ask finance');
        expect(wrapper.find('[data-wb-add-note]').exists()).toBe(false);
        expect(wrapper.find('[data-wb-add-text]').exists()).toBe(false);
        await dragFrom(noteOf('n1'), [40, 50]);
        await noteOf('n1').trigger('dblclick');
        await noteOf('n1').trigger('keydown', { key: 'Enter' });
        await noteOf('n1').trigger('keydown', { key: 'Delete' });
        expect(boxOf('n1').slice(0, 2)).toEqual([300, 200]);
        expect(noteOf('n1').find('textarea').exists()).toBe(false);
        expect(noteOf('n1').find('[data-wb-note-tools]').exists()).toBe(false);
        expect(noteOf('n1').find('[data-wb-note-resize]').exists()).toBe(false);
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);
    });

    it('can still pan the board by dragging its empty space', async () => {
        await open();
        board().element.scrollLeft = 300;
        board().element.scrollTop = 200;
        await dragFrom(board(), [-120, -80]);
        expect([board().element.scrollLeft, board().element.scrollTop]).toEqual([420, 280]);
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);
    });
});

describe('pointers', () => {
    it('pans the board on a drag over empty space and deselects, without moving anything', async () => {
        await open();
        await select('n1');
        board().element.scrollLeft = 100;
        await dragFrom(board(), [-30, 0]);
        expect(board().element.scrollLeft).toBe(130);
        expect(noteOf('n1').classes()).not.toContain('is-selected');
        expect(boxOf('n1').slice(0, 2)).toEqual([300, 200]);
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);
    });

    it('leaves a touch on empty space to the browser, which scrolls the board itself', async () => {
        await open();
        board().element.scrollLeft = 100;
        await dragFrom(board(), [-30, 0], { pointerType: 'touch' });
        expect(board().element.scrollLeft).toBe(100);
    });

    it('drags a card with a touch or a pen as with a mouse', async () => {
        await open();
        for (const [pointerType, to] of [['touch', [40, 50]], ['pen', [60, 70]]]) {
            await dragFrom(wrapper.find('[data-wb-card="t1"]'), to, { pointerType });
            const { left, top } = wrapper.find('[data-wb-card="t1"]').element.style;
            expect([parseInt(left, 10), parseInt(top, 10)]).toEqual(to);
        }
    });

    it('ignores a second finger and another mouse button, and drops a drag the browser cancels', async () => {
        await open();
        const cardEl = wrapper.find('[data-wb-card="t1"]');
        press(cardEl, [0, 0], { pointerId: 1 });
        window.dispatchEvent(pointer('pointermove', [500, 500], { pointerId: 2 }));
        window.dispatchEvent(pointer('pointerup', [500, 500], { pointerId: 2 }));
        window.dispatchEvent(pointer('pointermove', [40, 50], { pointerId: 1 }));
        window.dispatchEvent(pointer('pointercancel', [40, 50], { pointerId: 1 }));
        await flushPromises();
        expect(cardEl.element.style.left).toBe('100px');

        await dragFrom(cardEl, [40, 50], { pointerType: 'mouse', button: 2 });
        expect(cardEl.element.style.left).toBe('100px');
        await afterTheDelay();
        expect(calls('patch')).toHaveLength(0);
    });

    it('keeps the page from scrolling while a card or a note is dragged, and listens for no mouse events', () => {
        const view = fs.readFileSync(path.join(VIEW_DIR, 'WhiteboardView.vue'), 'utf8');
        const noteView = fs.readFileSync(path.join(VIEW_DIR, 'WhiteboardNote.vue'), 'utf8');
        expect(view).toMatch(/\.wb-view__card\s*\{[^}]*touch-action:\s*none/);
        expect(noteView).toMatch(/\.wb-note\s*\{[^}]*touch-action:\s*none/);
        expect(`${view}${noteView}`).not.toMatch(/mousedown|mousemove|mouseup/);
    });
});

describe('a board still kept in this browser', () => {
    it('offers no notes until it is saved to the workspace', async () => {
        localStorage.setItem(legacyKeyOf('p1', 's1'), JSON.stringify({ t1: { x: 5, y: 6 } }));
        server = boardOf(0, []);
        await open();
        expect(wrapper.find('[data-wb-offer]').exists()).toBe(true);
        expect(wrapper.find('[data-wb-add-note]').exists()).toBe(false);
    });
});
