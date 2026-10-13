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
import { workingDaysOnly } from '@/views/Projects/WorkloadView/workloadUnits';

/* 2026-09-07 is a Monday. */
const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
const FRI_TO_SUN = [0, 5, 6];
const person = { userId: 'user-1', name: 'Ana', days: DAYS.map((date) => ({ date, chips: [], estimated: 0, logged: 0, capacityMinutes: 480 })) };

const gridAnswer = (workingDays) => ({ data: { status: true, data: { days: DAYS, users: [person], unit: 'hours', ...(workingDays ? { workingDays } : {}) } } });
const answerWith = (workingDays) => apiRequest.mockImplementation(async (method) => (method === 'post' ? gridAnswer(workingDays) : { data: [] }));

const company = (fields = {}) => {
    getters['settings/selectedCompany'] = { _id: 'company-1', planFeature: { workloadView: true, workloadTimesheet: true }, ...fields };
    getters['settings/teams'] = [];
    getters['users/users'] = [];
};

const global = { provide: { $clientWidth: ref(1280), $userId: ref('user-1'), $companyId: ref('company-1') } };

const openProjectGrid = async (project = {}) => {
    const wrapper = mount(WorkloadView, { props: { projectData: { _id: 'project-1', ...project } }, global });
    wrapper.findComponent({ name: 'RangePickerComp' }).vm.$emit('SelectedDate', { dateVal: [new Date(2026, 8, 7), new Date(2026, 8, 13)] });
    await flushPromises();
    await flushPromises();
    return wrapper.findAll('.wv__row--head span').map((cell) => cell.text()).filter(Boolean);
};

const openCompanyGrid = async () => {
    const wrapper = mount(WorkloadTimesheet, { global });
    await flushPromises();
    await flushPromises();
    return wrapper.findAll('.wl__row--head span').map((cell) => cell.text()).filter(Boolean);
};

describe('workingDaysOnly', () => {
    it('keeps the days of the working week', () => {
        expect(workingDaysOnly(DAYS, [1, 2, 3, 4, 5])).toEqual(DAYS.slice(0, 5));
        expect(workingDaysOnly(DAYS, FRI_TO_SUN)).toEqual(DAYS.slice(4));
        expect(workingDaysOnly(undefined, FRI_TO_SUN)).toEqual([]);
    });
});

describe('the project workload grid hides the days outside the working week', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('shows Monday to Friday for a company that never chose a week', async () => {
        company();
        answerWith(null);
        expect(await openProjectGrid()).toEqual(['M7', 'T8', 'W9', 'T10', 'F11', 'Views.total']);
    });

    it('shows Friday to Sunday when the grid answers with that week', async () => {
        company();
        answerWith(FRI_TO_SUN);
        expect(await openProjectGrid()).toEqual(['F11', 'S12', 'S13', 'Views.total']);
    });

    it('falls back to the project\'s own week when the answer names none', async () => {
        company({ workingDays: [1, 2, 3, 4, 5] });
        answerWith(null);
        expect(await openProjectGrid({ workingDays: FRI_TO_SUN })).toEqual(['F11', 'S12', 'S13', 'Views.total']);
    });
});

describe('the company workload grid hides the days outside the working week', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('shows Monday to Friday for a company that never chose a week', async () => {
        company();
        answerWith(null);
        expect(await openCompanyGrid()).toEqual(['M7', 'T8', 'W9', 'T10', 'F11', 'Time.col_total']);
    });

    it('shows Friday to Sunday for a Friday-to-Sunday company', async () => {
        company({ workingDays: FRI_TO_SUN });
        answerWith(FRI_TO_SUN);
        expect(await openCompanyGrid()).toEqual(['F11', 'S12', 'S13', 'Time.col_total']);
    });
});
