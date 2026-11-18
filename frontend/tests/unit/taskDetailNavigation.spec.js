import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { navKeyDirection, neighbours, readSequence, taskNavAttrs } from '@/components/organisms/TaskDetailOverlay/taskNavigation';
import {
    bindRouter, closeTask, openTask, overlayState, registerTaskSequence, restoreFromSequence, stepTask
} from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

const row = (task, extra = '') => {
    const attrs = Object.entries(taskNavAttrs(task, 'p1')).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<div class="row ${extra}" ${attrs}><button>${task._id}</button></div>`;
};

function listFixture() {
    const root = document.createElement('div');
    root.innerHTML = `
        <section class="group">
            ${row({ _id: 't3', sprintId: 's1' })}
            ${row({ _id: 't2', sprintId: 's1', isParentTask: true })}
            ${row({ _id: 't2a', sprintId: 's1', ParentTaskId: 't2' }, 'is-sub')}
            ${row({ _id: 't2b', sprintId: 's1', ParentTaskId: 't2' }, 'is-sub')}
        </section>
        <section class="group">
            ${row({ _id: 't1', sprintId: 's2', folderObjId: 'f1', ProjectID: 'p9' })}
        </section>`;
    return root;
}

function boardFixture() {
    const root = document.createElement('div');
    root.innerHTML = `
        <div class="kanban-column">${row({ _id: 'a1', sprintId: 's1' })}${row({ _id: 'a2', sprintId: 's1' })}</div>
        <div class="kanban-column">${row({ _id: 'b1', sprintId: 's1' })}</div>
        <div class="kanban-column"></div>
        <div class="kanban-column">${row({ _id: 'd1', sprintId: 's1' })}</div>`;
    return root;
}

describe('task sequence from a view', () => {
    it('follows a list top to bottom, including the subtasks it shows', () => {
        const ids = readSequence(listFixture()).map((item) => item.taskId);
        expect(ids).toEqual(['t3', 't2', 't2a', 't2b', 't1']);
    });

    it('carries where each task lives so the overlay can open it', () => {
        const last = readSequence(listFixture()).at(-1);
        expect(last).toEqual({ taskId: 't1', projectId: 'p9', sprintId: 's2', folderId: 'f1' });
        expect(readSequence(listFixture())[0].projectId).toBe('p1');
    });

    it('walks a board column by column, card by card', () => {
        const ids = readSequence(boardFixture()).map((item) => item.taskId);
        expect(ids).toEqual(['a1', 'a2', 'b1', 'd1']);
    });

    it('lists a task once when a grouping shows it twice', () => {
        const root = listFixture();
        root.insertAdjacentHTML('beforeend', row({ _id: 't3', sprintId: 's1' }));
        expect(readSequence(root).map((item) => item.taskId)).toEqual(['t3', 't2', 't2a', 't2b', 't1']);
    });

    it('is empty without a view', () => {
        expect(readSequence(null)).toEqual([]);
    });
});

describe('neighbours', () => {
    const sequence = readSequence(boardFixture());

    it('gives the previous and next task with the position', () => {
        const around = neighbours(sequence, 'b1');
        expect(around.index).toBe(2);
        expect(around.total).toBe(4);
        expect(around.prev.taskId).toBe('a2');
        expect(around.next.taskId).toBe('d1');
    });

    it('has no previous task at the start and no next task at the end', () => {
        expect(neighbours(sequence, 'a1').prev).toBeNull();
        expect(neighbours(sequence, 'd1').next).toBeNull();
    });

    it('is null for a task the view does not show', () => {
        expect(neighbours(sequence, 'elsewhere')).toBeNull();
    });
});

describe('navigation keys', () => {
    const keyOn = (target, key, extra = {}) => ({ key, target, defaultPrevented: false, ...extra });
    const headButton = () => {
        const head = document.createElement('header');
        head.className = 'ah-detail__head';
        const button = document.createElement('button');
        head.appendChild(button);
        return button;
    };

    it('reads j as next and k as previous', () => {
        expect(navKeyDirection(keyOn(document.body, 'j'))).toBe(1);
        expect(navKeyDirection(keyOn(document.body, 'k'))).toBe(-1);
    });

    it('ignores j and k typed into a field', () => {
        for (const tag of ['input', 'textarea', 'select']) {
            expect(navKeyDirection(keyOn(document.createElement(tag), 'j'))).toBe(0);
        }
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        const inner = document.createElement('p');
        editor.appendChild(inner);
        expect(navKeyDirection(keyOn(inner, 'k'))).toBe(0);
        const textbox = document.createElement('div');
        textbox.setAttribute('role', 'textbox');
        expect(navKeyDirection(keyOn(textbox, 'j'))).toBe(0);
    });

    it('ignores j and k with a modifier and inside a picker or dialog on top', () => {
        expect(navKeyDirection(keyOn(document.body, 'j', { metaKey: true }))).toBe(0);
        expect(navKeyDirection(keyOn(document.body, 'k', { ctrlKey: true }))).toBe(0);
        const picker = document.createElement('div');
        picker.className = 'sidebar-main';
        const option = document.createElement('div');
        picker.appendChild(option);
        expect(navKeyDirection(keyOn(option, 'j'))).toBe(0);
    });

    it('moves with the arrow keys only while focus is on the header', () => {
        expect(navKeyDirection(keyOn(headButton(), 'ArrowDown'))).toBe(1);
        expect(navKeyDirection(keyOn(headButton(), 'ArrowUp'))).toBe(-1);
        expect(navKeyDirection(keyOn(document.body, 'ArrowDown'))).toBe(0);
    });
});

describe('moving through the view from the overlay', () => {
    let router;
    let route;
    let root;
    let unregister;

    beforeEach(() => {
        route = reactive({ name: 'ProjectSprint', params: { cid: 'c1', id: 'p1', sprintId: 's1' }, query: {} });
        router = {
            push: vi.fn((to) => { route.query = { ...(to.query || {}) }; if (to.params) route.params = { ...to.params }; return Promise.resolve(); }),
            replace: vi.fn((to) => { route.query = { ...(to.query || {}) }; return Promise.resolve(); })
        };
        bindRouter(router, route);
        root = listFixture();
        unregister = registerTaskSequence(() => root);
    });

    afterEach(() => {
        unregister?.();
        closeTask({ keepRoute: true });
    });

    it('offers the neighbours of the open task and moves to the next one with a history entry', () => {
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't2' });
        expect(overlayState.nav).toMatchObject({ index: 1, total: 5 });
        expect(overlayState.nav.prev.taskId).toBe('t3');
        expect(overlayState.nav.next.taskId).toBe('t2a');

        expect(stepTask(1)).toBe(true);
        expect(overlayState.current.taskId).toBe('t2a');
        expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ query: { task: 't2a' } }));
        expect(overlayState.nav.index).toBe(2);
    });

    it('keeps the task where it lives when moving', () => {
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't2b' });
        stepTask(1);
        expect(overlayState.current).toMatchObject({ companyId: 'c1', projectId: 'p9', sprintId: 's2', folderId: 'f1', taskId: 't1' });
    });

    it('does nothing past either end', () => {
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't3' });
        expect(overlayState.nav.prev).toBeNull();
        expect(stepTask(-1)).toBe(false);
        expect(overlayState.current.taskId).toBe('t3');
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't1' });
        expect(overlayState.nav.next).toBeNull();
        expect(stepTask(1)).toBe(false);
        expect(router.push).not.toHaveBeenCalled();
    });

    it('offers no navigation for a task the view does not show', () => {
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 'from-inbox' });
        expect(overlayState.nav).toBeNull();
        expect(stepTask(1)).toBe(false);
    });

    it('offers no navigation once the view is gone', () => {
        unregister();
        unregister = null;
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't2' });
        expect(overlayState.nav).toBeNull();
    });

    it('pushes the task route when the task is expanded', () => {
        route.name = 'ProjectSprintTask';
        route.params = { cid: 'c1', id: 'p1', sprintId: 's1', taskId: 't3' };
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't3' });
        stepTask(1);
        expect(router.push).toHaveBeenCalledWith(expect.objectContaining({
            name: 'ProjectSprintTask',
            params: expect.objectContaining({ taskId: 't2', sprintId: 's1', id: 'p1', cid: 'c1' })
        }));
    });

    it('opens a task from the view without a fetch when history comes back to it', () => {
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't3' });
        stepTask(1);
        expect(restoreFromSequence('t3', 'c1')).toBe(true);
        expect(overlayState.current.taskId).toBe('t3');
        expect(restoreFromSequence('not-in-view', 'c1')).toBe(false);
    });
});
