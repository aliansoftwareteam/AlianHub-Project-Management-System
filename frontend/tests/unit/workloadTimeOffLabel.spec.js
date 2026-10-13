import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, getters, stub } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    getters: {},
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
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/views/Timesheet/TimesheetTabs.vue', () => stub('TimesheetTabs'));

import WorkloadView from '@/views/Projects/WorkloadView/WorkloadView.vue';
import WorkloadTimesheet from '@/views/Timesheet/WorkloadTimesheet/WorkloadTimesheet.vue';

/* 2026-09-07 is a Monday. */
const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
const day = (date, extra = {}) => ({ date, chips: [], estimated: 0, logged: 0, capacityMinutes: 480, ...extra });
const person = (userId, days) => ({ userId, name: userId, days });
const users = [
    person('named', [day(DAYS[0], { pto: true, capacityMinutes: 0 }), ...DAYS.slice(1).map((date) => day(date))]),
    person('unnamed', [day(DAYS[0], { pto: false, unavailable: true, capacityMinutes: 0 }), ...DAYS.slice(1).map((date) => day(date))]),
];

const global = { provide: { $clientWidth: ref(1280), $userId: ref('user-1'), $companyId: ref('company-1') } };

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(async (method) => (method === 'post' ? { data: { status: true, data: { days: DAYS, users, unit: 'hours' } } } : { data: [] }));
    getters['settings/selectedCompany'] = { _id: 'company-1', planFeature: { workloadView: true, workloadTimesheet: true } };
    getters['settings/teams'] = [];
    getters['users/users'] = [];
});

describe('a day off in the workload grids', () => {
    it('is named PTO in the project grid only when the answer names it, and blocks the day either way', async () => {
        const wrapper = mount(WorkloadView, { props: { projectData: { _id: 'project-1' } }, global });
        wrapper.findComponent({ name: 'RangePickerComp' }).vm.$emit('SelectedDate', { dateVal: [new Date(2026, 8, 7), new Date(2026, 8, 11)] });
        await flushPromises();
        await flushPromises();
        expect(wrapper.findAll('.wv__cell.is-pto').map((cell) => cell.text())).toEqual(['Views.pto', 'Views.unavailable']);
        expect(wrapper.findAll('.wv__sub').map((cell) => cell.text())).toEqual(['Views.pto_range', 'Views.unavailable_range']);
    });

    it('is named PTO in the company grid only when the answer names it, and blocks the day either way', async () => {
        const wrapper = mount(WorkloadTimesheet, { global });
        await flushPromises();
        await flushPromises();
        expect(wrapper.findAll('.wl__cell.is-pto').map((cell) => cell.text())).toEqual(['Time.pto', 'Time.unavailable']);
    });
});
