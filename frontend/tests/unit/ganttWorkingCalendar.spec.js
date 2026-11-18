import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { gantt, getters, stub } = vi.hoisted(() => ({
    gantt: {
        config: {},
        templates: {},
        renders: 0,
        init: () => {},
        render() { this.renders += 1; },
        parse: () => {},
        clearAll: () => {},
        addMarker: () => 'today',
        deleteMarker: () => {},
        detachEvent: () => {},
        attachEvent: (name) => name,
    },
    getters: {},
    stub: (name) => ({ default: { name, render: () => null } }),
}));

vi.mock('dhtmlx-gantt', () => ({ gantt }));
vi.mock('dhtmlx-gantt/codebase/dhtmlxgantt.css', () => ({}));
vi.mock('vuex', () => ({ useStore: () => ({ getters }) }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(async () => ({ data: { status: false } })) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: () => ({}) }),
}));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateDates: vi.fn(), updateDatesBatch: vi.fn() } }));
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
const task = (id, start, end, blocks = []) => ({
    _id: id, TaskName: id, ProjectID: PROJECT, sprintId: SPRINT, deletedStatusKey: 0, startDate: start, DueDate: end,
    relations: blocks.map((taskId) => ({ type: 'blocks', taskId })),
});

const open = async ({ company = {}, project = {} } = {}) => {
    getters['settings/selectedCompany'] = { _id: 'company-1', ...company };
    getters['users/users'] = [];
    getters['projectData/tableTasks'] = {};
    getters['projectData/tasks'] = {
        [PROJECT]: { [SPRINT]: { tasks: [task('first', day(1), day(2), ['second']), task('second', day(4), day(7))] } },
    };
    const wrapper = mount(GanttView, {
        props: { projectData: { _id: PROJECT, isGlobalPermission: true, ...project }, sprints: [{ id: SPRINT, name: 'Sprint' }] },
        global: { stubs: { 'router-link': true } },
    });
    await flushPromises();
    await flushPromises();
    return wrapper;
};

const clickButton = async (wrapper, label) => {
    await wrapper.findAll('button').find((button) => button.text().includes(label)).trigger('click');
    await flushPromises();
};

describe('the Gantt Replan line counts in the working week', () => {
    it('says working days for a company that never chose a week', async () => {
        const wrapper = await open();
        await clickButton(wrapper, 'Views.replan');
        expect(wrapper.find('.gv__replan').text()).toContain('Views.replan_chain_working');
        wrapper.unmount();
    });

    it('says days when every day is a working day', async () => {
        const wrapper = await open({ company: { workingDays: [0, 1, 2, 3, 4, 5, 6] } });
        await clickButton(wrapper, 'Views.replan');
        expect(wrapper.find('.gv__replan').text()).toContain('Views.replan_chain');
        expect(wrapper.find('.gv__replan').text()).not.toContain('Views.replan_chain_working');
        wrapper.unmount();
    });
});

describe('the Gantt chart shades the days off', () => {
    const cellClass = (date) => gantt.templates.timeline_cell_class({}, date);

    it('shades Saturday and Sunday in the day scale by default', async () => {
        const wrapper = await open();
        await clickButton(wrapper, 'Views.zoom_days');
        expect(cellClass(day(5))).toBe('gv-off');
        expect(cellClass(day(6))).toBe('gv-off');
        expect(cellClass(day(4))).toBe('');
        wrapper.unmount();
    });

    it('shades the project\'s days off when it has its own week', async () => {
        const wrapper = await open({ project: { workingDays: [0, 5, 6] } });
        await clickButton(wrapper, 'Views.zoom_days');
        expect(cellClass(day(7))).toBe('gv-off');
        expect(cellClass(day(5))).toBe('');
        wrapper.unmount();
    });

    it('shades nothing where a column is a whole week', async () => {
        const wrapper = await open();
        expect(cellClass(day(5))).toBe('');
        await clickButton(wrapper, 'Views.zoom_months');
        expect(cellClass(day(5))).toBe('');
        wrapper.unmount();
    });
});
