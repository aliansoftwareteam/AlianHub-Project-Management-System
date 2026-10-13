import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { inkOf, worstContrast } from '../wcagContrast';

const { statuses, stub, idle } = vi.hoisted(() => ({
    statuses: [{ key: 1, name: 'To Do', textColor: '#ff9600', bgColor: '#ff960035' }],
    stub: (name) => ({ default: { name, render: () => null } }),
    idle: () => ({ get: () => ({ state: 'idle' }), ensure: () => {}, generate: () => {}, pin: () => {}, unpin: () => {} })
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: () => null, getTaskStatus: (key) => statuses.find((s) => s.key === key) })
}));
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({ useTaskSummaries: idle }));
vi.mock('@/views/Projects/TableView/useTaskCategories.js', () => ({ useTaskCategories: idle }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));

import TaskStatus from '@/components/molecules/TaskStatus/TaskStatus.vue';
import TableRow from '@/views/Projects/TableView/TableRow.vue';

function expectReadableChip(chip) {
    const style = chip.element.style;
    expect(chip.classes()).toContain('ah-status-ink');
    expect(style.color).not.toBe('rgb(255, 150, 0)');
    expect(worstContrast(inkOf(style), style.background, 'light')).toBeGreaterThanOrEqual(4.5);
    expect(worstContrast(style.getPropertyValue('--status-ink-dark'), style.background, 'dark')).toBeGreaterThanOrEqual(4.5);
}

describe('status chips painted from workspace colours', () => {
    it('keeps the task panel status chip readable on its tint', () => {
        const wrapper = mount(TaskStatus, {
            props: { taskKey: 1, projectId: 'p', sprintId: 's', taskId: 't' },
            global: { provide: { selectedProject: ref({ isGlobalPermission: true, taskStatusData: statuses }) }, stubs: { Sidebar: true } }
        });
        expectReadableChip(wrapper.get('.task-status-name'));
    });

    it('keeps the table status cell readable on its tint', () => {
        const wrapper = mount(TableRow, { props: { data: { _id: 't1', TaskName: 'Write spec', statusKey: 1 } } });
        expectReadableChip(wrapper.get('.tv2__status'));
    });
});
