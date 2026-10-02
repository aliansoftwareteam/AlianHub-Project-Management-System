import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, getters, openTask, stub } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    getters: {},
    openTask: vi.fn(),
    stub: (name) => ({ default: { name, render: () => null } }),
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debouncerWithPromise: () => Promise.resolve() }),
    useGetterFunctions: () => ({ getUser: () => ({}) }),
}));
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));
vi.mock('@/components/molecules/RangePickerComp/RangePickerComp.vue', () => stub('RangePickerComp'));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => stub('SpinnerComp'));
vi.mock('@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue', () => stub('UpgradePlan'));
vi.mock('@/components/molecules/AppState/AppState.vue', () => stub('AppState'));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask }));
vi.mock('@/views/Timesheet/TimesheetTabs.vue', () => stub('TimesheetTabs'));

import WorkloadView from '@/views/Projects/WorkloadView/WorkloadView.vue';
import WorkloadTimesheet from '@/views/Timesheet/WorkloadTimesheet/WorkloadTimesheet.vue';

/* 2026-09-07 is a Monday. */
const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
const chips = [
    { estimateId: 'e1', taskId: 't1', name: 'Write the brief', projectId: 'p1', projectName: 'Launch', sprintId: 's1', minutes: 60 },
    { estimateId: 'e2', taskId: 't2', name: '', projectId: 'p2', projectName: '', sprintId: '', minutes: 90 },
];
const day = (date, extra = {}) => ({ date, chips: [], estimated: 0, logged: 0, capacityMinutes: 480, ...extra });
const users = [{ userId: 'user-1', name: 'Ian', days: [day(DAYS[0], { chips, estimated: 150 }), ...DAYS.slice(1).map((date) => day(date))] }];

const global = { provide: { $clientWidth: ref(1280), $userId: ref('user-1'), $companyId: ref('company-1') } };

beforeEach(() => {
    apiRequest.mockReset();
    openTask.mockReset();
    apiRequest.mockImplementation(async (method) => (method === 'post' ? { data: { status: true, data: { days: DAYS, users, unit: 'hours' } } } : { data: [] }));
    getters['settings/selectedCompany'] = { _id: 'company-1', planFeature: { workloadView: true, workloadTimesheet: true } };
    getters['settings/teams'] = [];
    getters['users/users'] = [];
});

describe('a planned task the answer does not name', () => {
    it('keeps its place in the project grid, reads as a task the person cannot open, and is neither opened nor dragged', async () => {
        const wrapper = mount(WorkloadView, { props: { projectData: { _id: 'project-1' } }, global });
        wrapper.findComponent({ name: 'RangePickerComp' }).vm.$emit('SelectedDate', { dateVal: [new Date(2026, 8, 7), new Date(2026, 8, 11)] });
        await flushPromises();
        await flushPromises();
        const shown = wrapper.findAll('.wv__chip-task');

        expect(shown.map((chip) => chip.text())).toEqual(['Write the brief', 'Time.task_not_open']);
        expect(shown.map((chip) => chip.attributes('draggable'))).toEqual(['true', 'false']);
        await shown[1].trigger('click');
        expect(openTask).not.toHaveBeenCalled();
    });

    it('keeps its place in the company grid and reads as a task the person cannot open', async () => {
        const wrapper = mount(WorkloadTimesheet, { global });
        await flushPromises();
        await flushPromises();
        const shown = wrapper.findAll('.wl__chip');

        expect(shown.map((chip) => chip.text())).toEqual(['Write the brief', 'Time.task_not_open']);
        expect(shown.map((chip) => chip.attributes('draggable'))).toEqual(['true', 'false']);
    });
});
