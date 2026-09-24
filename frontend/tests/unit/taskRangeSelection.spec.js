import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';
import taskSelection from '@/store/TaskSelection';
import { taskNavAttrs } from '@/components/organisms/TaskDetailOverlay/taskNavigation';

const { holder } = vi.hoisted(() => ({ holder: { store: null } }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => holder.store }));

import { useTaskSelection, visibleTaskIdsAround } from '@/composable/useTaskSelection.js';

const task = (id, extra = {}) => ({ _id: id, isParentTask: true, ...extra });
const click = (shiftKey = false, target = null) => ({ shiftKey, target, type: 'click' });
const key = (keyName, shiftKey = true) => ({ key: keyName, shiftKey, type: 'keydown', preventDefault: vi.fn() });

function makeStore(tasks = []) {
    holder.store = createStore({
        modules: {
            taskSelection: { ...taskSelection, state: () => ({ selectedTaskIds: [], lastAnchorId: null, activeView: null, activeProjectId: null }) },
            projectData: { namespaced: true, state: () => ({ tasks: { p1: { sprints: ['s1'], s1: { tasks } } } }) }
        }
    });
    return holder.store;
}

const selected = () => [...holder.store.state.taskSelection.selectedTaskIds].sort();

describe('shift-click range selection', () => {
    let selection;
    beforeEach(() => {
        makeStore();
        selection = useTaskSelection();
    });

    it('selects every visible row between the anchor and the shift-clicked row', () => {
        const visible = ['a', 'b', 'c', 'd', 'e'];
        selection.toggleAndCascade(task('b'), click(), visible);
        selection.toggleAndCascade(task('d'), click(true), visible);
        expect(selected()).toEqual(['b', 'c', 'd']);
    });

    it('selects the same range when the shift-click is above the anchor', () => {
        const visible = ['a', 'b', 'c', 'd', 'e'];
        selection.toggleAndCascade(task('d'), click(), visible);
        selection.toggleAndCascade(task('b'), click(true), visible);
        expect(selected()).toEqual(['b', 'c', 'd']);
    });

    it('follows the visible order across groups, not the stored order', () => {
        const visible = ['g1-a', 'g1-b', 'g2-a', 'g2-b'];
        selection.toggleAndCascade(task('g1-b'), click(), visible);
        selection.toggleAndCascade(task('g2-a'), click(true), visible);
        expect(selected()).toEqual(['g1-b', 'g2-a']);
    });

    it('leaves out rows a filter hides, even when they sit between the two in the store', () => {
        makeStore([task('a'), task('hidden'), task('b'), task('c')]);
        selection = useTaskSelection();
        const visible = ['a', 'b', 'c'];
        selection.toggleAndCascade(task('a'), click(), visible);
        selection.toggleAndCascade(task('c'), click(true), visible);
        expect(selected()).toEqual(['a', 'b', 'c']);
    });

    it('treats shift-click with no anchor as a normal click', () => {
        selection.toggleAndCascade(task('c'), click(true), ['a', 'b', 'c']);
        expect(selected()).toEqual(['c']);
    });

    it('treats shift-click as a normal click when the anchor is no longer visible', () => {
        selection.toggleAndCascade(task('x'), click(), ['x', 'a', 'b']);
        selection.toggleAndCascade(task('b'), click(true), ['a', 'b']);
        expect(selected()).toEqual(['b', 'x']);
    });

    it('selects the loaded subtasks of every parent in the range', () => {
        const parent = task('b', { subtaskArray: [{ _id: 'b1', isParentTask: false }, { _id: 'b2', isParentTask: false }] });
        makeStore([task('a'), parent, task('c')]);
        selection = useTaskSelection();
        selection.toggleAndCascade(task('a'), click(), ['a', 'b', 'c']);
        selection.toggleAndCascade(task('c'), click(true), ['a', 'b', 'c']);
        expect(selected()).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    });

    it('keeps the clicked checkbox checked when a range includes an already selected row', () => {
        const visible = ['a', 'b', 'c'];
        selection.toggleAndCascade(task('c'), click(), visible);
        selection.toggleAndCascade(task('a'), click(), visible);
        const box = { type: 'checkbox', checked: false };
        selection.toggleAndCascade(task('c'), click(true, box), visible);
        expect(box.checked).toBe(true);
        expect(selected()).toEqual(['a', 'b', 'c']);
    });
});

describe('keyboard range selection from a focused row', () => {
    let selection;
    beforeEach(() => {
        makeStore();
        selection = useTaskSelection();
    });

    it('Shift+ArrowDown selects the next visible row and returns it for focus', () => {
        const visible = ['a', 'b', 'c'];
        selection.toggleAndCascade(task('a'), click(), visible);
        const event = key('ArrowDown');
        expect(selection.extendByKey(task('a'), event, visible)).toBe('b');
        expect(event.preventDefault).toHaveBeenCalled();
        expect(selected()).toEqual(['a', 'b']);
    });

    it('Shift+ArrowUp with no anchor selects the focused row and the one above', () => {
        const visible = ['a', 'b', 'c'];
        expect(selection.extendByKey(task('c'), key('ArrowUp'), visible)).toBe('b');
        expect(selected()).toEqual(['b', 'c']);
    });

    it('Shift+Space selects from the anchor to the focused row', () => {
        const visible = ['a', 'b', 'c', 'd'];
        selection.toggleAndCascade(task('a'), click(), visible);
        const event = key(' ');
        expect(selection.extendByKey(task('c'), event, visible)).toBe('c');
        expect(event.preventDefault).toHaveBeenCalled();
        expect(selected()).toEqual(['a', 'b', 'c']);
    });

    it('stops at the last visible row', () => {
        const visible = ['a', 'b'];
        selection.toggleAndCascade(task('b'), click(), visible);
        expect(selection.extendByKey(task('b'), key('ArrowDown'), visible)).toBe(null);
        expect(selected()).toEqual(['b']);
    });

    it('ignores the keys without Shift', () => {
        const event = key('ArrowDown', false);
        expect(selection.extendByKey(task('a'), event, ['a', 'b'])).toBe(null);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(selected()).toEqual([]);
    });
});

describe('visible task ids around a row', () => {
    const row = (id) => {
        const attrs = Object.entries(taskNavAttrs({ _id: id, sprintId: 's1' }, 'p1')).map(([k, v]) => `${k}="${v}"`).join(' ');
        return `<div class="row" ${attrs}><input type="checkbox" data-id="${id}"></div>`;
    };

    it('reads the rows the view renders, in screen order, within the given scope', () => {
        document.body.innerHTML = `
            <div class="view">
                <section>${row('g1-b')}${row('g1-a')}</section>
                <section>${row('g2-a')}</section>
            </div>
            <div class="other">${row('elsewhere')}</div>`;
        const box = document.querySelector('[data-id="g1-a"]');
        expect(visibleTaskIdsAround(box, '.view')).toEqual(['g1-b', 'g1-a', 'g2-a']);
    });

    it('returns nothing without a scope', () => {
        document.body.innerHTML = row('a');
        expect(visibleTaskIdsAround(document.querySelector('input'), '.missing')).toEqual([]);
        expect(visibleTaskIdsAround(null, '.view')).toEqual([]);
    });
});
