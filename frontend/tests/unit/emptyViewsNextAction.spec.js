/* Task 047 S-5: the Board, Gantt and Calendar of a project with no tasks name what they are for and offer the
   one next step; a person who may not create tasks reads the sentence without it. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';

const state = vi.hoisted(() => ({ perms: {}, replace: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: (key) => (key in state.perms ? state.perms[key] : true) }) }));

import { LIST_TAB, useAddFirstTask } from '@/views/Projects/composables/useAddFirstTask';
import en from '@/locales/en';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = (file) => fs.readFileSync(path.resolve(HERE, '../../src', file), 'utf8');

const probe = (project) => {
    let out;
    mount(defineComponent({ setup() { out = useAddFirstTask(ref(project)); return () => null; } }));
    return out;
};

describe('adding the first task from a view that has no place to type it', () => {
    it('is offered to someone who may create and list tasks, and goes to the List', () => {
        state.perms = {};
        state.replace.mockClear();
        const { canAddFirstTask, goToList } = probe({ _id: 'p1' });
        expect(canAddFirstTask.value).toBe(true);
        goToList();
        expect(state.replace).toHaveBeenCalledWith({ query: { tab: LIST_TAB } });
    });

    it.each(['task.task_create', 'task.task_list'])('is not offered without %s', (key) => {
        state.perms = { [key]: false };
        expect(probe({ _id: 'p1' }).canAddFirstTask.value).toBe(false);
    });
});

describe('the three views', () => {
    it('the Board keeps the sentence and adds Create task only for someone who may', () => {
        const block = /<EmptyState\s+v-else-if="project\?\.deletedStatusKey !== 2"[^>]*data-test="board-empty"[^>]*\/>/s.exec(source('views/Projects/Kanban/BoardView.vue'))[0];
        expect(block).toContain(':actionLabel="canCreateFirstTask ? $t(\'EmptyState.no_tasks_action\') : \'\'"');
        expect(block).toContain('@action="creatingFirstTask = true"');
        expect(source('views/Projects/Kanban/BoardView.vue')).toContain("checkPermission('task.task_create'");
    });

    it('the Gantt chart explains itself and offers Add a task only while the project has none', () => {
        const block = /<EmptyState[^>]*data-test="gantt-empty"[^>]*\/>/s.exec(source('views/Projects/GanttView/GanttView.vue'))[0];
        expect(block).toContain(":actionLabel=\"noTasks ? $t('Views.add_a_task') : ''\"");
        expect(block).toContain(':actionAllowed="canAddFirstTask"');
        expect(block).toContain('@action="goToList"');
    });

    it('the Calendar explains itself in the tray and offers Add a task', () => {
        const block = /<EmptyState[^>]*data-test="calendar-empty"[^>]*\/>/s.exec(source('views/Projects/ProjectCalendarView/CalendarViewComponent.vue'))[0];
        expect(block).toContain(":actionLabel=\"$t('Views.add_a_task')\"");
        expect(block).toContain(':actionAllowed="canAddFirstTask"');
        expect(block).toContain('@action="goToList"');
    });

    it('every sentence they use exists', () => {
        ['gantt_no_tasks_title', 'gantt_no_tasks_msg', 'gantt_empty_title', 'gantt_empty', 'calendar_no_tasks_title', 'calendar_no_tasks_msg', 'add_a_task']
            .forEach((key) => expect(en.Views[key]).toBeTruthy());
    });
});
