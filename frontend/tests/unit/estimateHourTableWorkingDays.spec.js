import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { getters, stub } = vi.hoisted(() => ({
    getters: {},
    stub: (name) => ({ default: { name, render: () => null } }),
}));

vi.mock('vuex', () => ({ useStore: () => ({ getters }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ addZero: (n) => String(n).padStart(2, '0') }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: 'Ana' }) }),
    useMoment: () => ({ changeDateFormate: (value) => String(value) }),
}));
vi.mock('@/components/atom/UserProfile/UserProfile', () => stub('UserProfile'));
vi.mock('vue3-timepicker', () => stub('VueTimepicker'));

import EstimateHourTable from '@/components/molecules/EstimateHourTable/EstimateHourTable.vue';

const WEEK = ['weekName.mon', 'weekName.tue', 'weekName.wed', 'weekName.thu', 'weekName.fri', 'weekName.sat', 'weekName.sun'];

const greyedDays = async (company) => {
    getters['settings/selectedCompany'] = { _id: 'company-1', ...company };
    getters['settings/companyUserDetail'] = { roleType: 1 };
    const wrapper = mount(EstimateHourTable, {
        props: { projectId: 'project-1', sprintId: 'sprint-1', taskId: 'task-1', dueDate: new Date(2030, 0, 1), createdAt: new Date(2026, 0, 1), AssigneeUserId: ['user-1'] },
        global: { stubs: { VDatePicker: { name: 'VDatePicker', props: ['attributes', 'modelValue', 'modelConfig', 'maxDate', 'popover'], render: () => null } } },
    });
    await flushPromises();
    const heads = wrapper.findAll('.estimate__daysdate-tr th');
    const cells = wrapper.findAll('tbody td.est_esditing_block');
    const greyed = (nodes) => nodes.map((node, index) => (node.classes().includes('disbleDate') ? WEEK[index] : null)).filter(Boolean);
    wrapper.unmount();
    return { heads: greyed(heads), cells: greyed(cells) };
};

describe('EstimateHourTable greys the company\'s days off', () => {
    it('greys Saturday and Sunday for a company that never chose a week', async () => {
        const { heads, cells } = await greyedDays({});
        expect(heads).toEqual(['weekName.sat', 'weekName.sun']);
        expect(cells).toEqual(heads);
    });

    it('greys Monday to Thursday for a Friday-to-Sunday company', async () => {
        const { heads, cells } = await greyedDays({ workingDays: [0, 5, 6] });
        expect(heads).toEqual(['weekName.mon', 'weekName.tue', 'weekName.wed', 'weekName.thu']);
        expect(cells).toEqual(heads);
    });
});
