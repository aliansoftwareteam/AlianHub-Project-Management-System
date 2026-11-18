import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { gantt, handlers, getters, apiRequest, updateDates, stub } = vi.hoisted(() => {
    const handlers = {};
    const dragged = {};
    return {
        handlers,
        gantt: {
            config: {},
            templates: {},
            dragged,
            init: () => {},
            render: () => {},
            parse: () => {},
            clearAll: () => {},
            addMarker: () => 'today',
            deleteMarker: () => {},
            detachEvent: () => {},
            attachEvent: (name, handler) => { handlers[name] = handler; return name; },
            getTask: (id) => dragged[id],
        },
        getters: {},
        apiRequest: vi.fn(async () => ({ data: { status: false } })),
        updateDates: vi.fn(async () => ({})),
        stub: (name) => ({ default: { name, render: () => null } }),
    };
});

vi.mock('dhtmlx-gantt', () => ({ gantt }));
vi.mock('dhtmlx-gantt/codebase/dhtmlxgantt.css', () => ({}));
vi.mock('vuex', () => ({ useStore: () => ({ getters }) }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: () => ({}) }),
}));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateDates, updateDatesBatch: vi.fn(async () => ({})) } }));
vi.mock('@/views/Projects/helper.js', () => ({ taskListHelper: () => ({ groupBy: () => {} }) }));
vi.mock('@/views/Ai/plainLabels', () => ({ proposalTitle: () => '' }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/composable/useUndoToast', () => ({ showUndoToast: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));

import GanttView from '@/views/Projects/GanttView/GanttView.vue';

const PROJECT = 'project-1';
const SPRINT = 'sprint-1';
/* Local dates, as the chart reads them. 2026-09-04 is a Friday. */
const day = (d) => new Date(2026, 8, d);
const short = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const range = (start, end) => `${short(start)} – ${short(end)}`;
const task =(id, start, end, blocks = []) => ({
    _id: id, TaskName: id, ProjectID: PROJECT, sprintId: SPRINT, deletedStatusKey: 0, startDate: start, DueDate: end,
    relations: blocks.map((taskId) => ({ type: 'blocks', taskId })),
});

const open = async ({ company = {}, project = {} } = {}) => {
    getters['settings/selectedCompany'] = { _id: 'company-1', ...company };
    getters['users/users'] = [];
    getters['projectData/tableTasks'] = {};
    getters['projectData/tasks'] = {
        [PROJECT]: { [SPRINT]: { tasks: [task('blocker', day(1), day(3), ['waiting']), task('waiting', day(3), day(4))] } },
    };
    const wrapper = mount(GanttView, {
        props: { projectData: { _id: PROJECT, isGlobalPermission: true, ...project }, sprints: [{ id: SPRINT, name: 'Sprint' }] },
        global: { stubs: { 'router-link': true } },
    });
    await flushPromises();
    await flushPromises();
    return wrapper;
};

const dragBlockerTo = async (wrapper, end) => {
    gantt.dragged.blocker = { start_date: day(1), end_date: end };
    handlers.onAfterTaskDrag('blocker');
    await flushPromises();
    return wrapper.find('.gv__shift');
};

describe('Gantt shift preview and the working-days setting', () => {
    beforeEach(() => { updateDates.mockClear(); });

    it('lands the dependant on Monday for a company that never chose a week, and says working days', async () => {
        const wrapper = await open();
        const panel = await dragBlockerTo(wrapper, day(5));
        expect(panel.exists()).toBe(true);
        expect(panel.text()).toContain('Views.shift_working_days');
        expect(panel.text()).toContain('Views.shift_working_note');
        expect(panel.find('.gv__shift-range').text()).toBe(range(day(7), day(8)));
        wrapper.unmount();
    });

    it('uses the project\'s own week over the company\'s', async () => {
        const wrapper = await open({ company: { workingDays: [1, 2, 3, 4, 5] }, project: { workingDays: [0, 5, 6] } });
        const panel = await dragBlockerTo(wrapper, day(8));
        expect(panel.find('.gv__shift-range').text()).toBe(range(day(11), day(12)));
        expect(panel.text()).toContain('Views.shift_working_days');
        wrapper.unmount();
    });

    it('counts plain days when every day is a working day', async () => {
        const wrapper = await open({ company: { workingDays: [0, 1, 2, 3, 4, 5, 6] } });
        const panel = await dragBlockerTo(wrapper, day(5));
        expect(panel.find('.gv__shift-range').text()).toBe(range(day(5), day(6)));
        expect(panel.text()).toContain('Views.shift_days');
        expect(panel.text()).not.toContain('Views.shift_working_days');
        expect(panel.text()).not.toContain('Views.shift_working_note');
        wrapper.unmount();
    });
});
