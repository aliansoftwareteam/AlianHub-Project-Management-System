/* Task 093: a Workload cell shows only its hours; tasks are listed, and dragged, from the side panel. */
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
vi.mock('@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue', () => stub('UpgradePlan'));
vi.mock('@/components/molecules/AppState/AppState.vue', () => stub('AppState'));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn(), onTaskClosed: vi.fn(() => () => {}) }));
vi.mock('@/views/Timesheet/TimesheetTabs.vue', () => stub('TimesheetTabs'));

import WorkloadTimesheet from '@/views/Timesheet/WorkloadTimesheet/WorkloadTimesheet.vue';

/* 2026-09-07 is a Monday. */
const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
const busy = [
    { estimateId: 'e1', taskId: 't1', name: 'Write the brief', projectId: 'p1', projectName: 'Launch', sprintId: 's1', minutes: 360 },
    { estimateId: 'e2', taskId: 't2', name: 'Review', projectId: 'p1', projectName: 'Launch', sprintId: 's1', minutes: 120 },
    { estimateId: 'e3', taskId: 't2', name: 'Review', projectId: 'p1', projectName: 'Launch', sprintId: 's1', minutes: 60 },
];
const day = (date, extra = {}) => ({ date, chips: [], estimated: 0, logged: 0, capacityMinutes: 480, ...extra });
const users = () => [
    { userId: 'user-1', name: 'Ian', capacityMinutes: 2400, totalEstimated: 570, totalLogged: 0, days: [day(DAYS[0], { chips: busy, estimated: 540 }), day(DAYS[1], { chips: [{ ...busy[0], estimateId: 'e4', minutes: 30 }], estimated: 30 }), ...DAYS.slice(2).map((date) => day(date))] },
    { userId: 'user-2', name: 'Ana', capacityMinutes: 2400, totalEstimated: 0, totalLogged: 0, days: DAYS.map((date) => day(date)) },
];

const global = { provide: { $clientWidth: ref(1280), $userId: ref('user-1'), $companyId: ref('company-1') } };
const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: '' });

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(async (method, url) => {
        if (method !== 'post') return { data: [] };
        if (String(url).includes('move')) return { data: { status: true } };
        return { data: { status: true, data: { days: DAYS, users: users(), unit: 'hours' } } };
    });
    getters['settings/selectedCompany'] = { _id: 'company-1', planFeature: { workloadTimesheet: true } };
    getters['settings/teams'] = [];
    getters['settings/companyUsers'] = [];
});

const mountGrid = async () => {
    const wrapper = mount(WorkloadTimesheet, { global });
    await flushPromises();
    await flushPromises();
    return wrapper;
};
const cellsOf = (wrapper, row) => wrapper.findAll('.wl__row:not(.wl__row--head)')[row].findAll('[data-test="workload-cell"]');

describe('a workload cell', () => {
    it('shows only its hours, however many tasks it holds', async () => {
        const wrapper = await mountGrid();
        const [busyDay, shortDay, emptyDay] = cellsOf(wrapper, 0);

        expect(wrapper.findAll('.wl__chip')).toHaveLength(0);
        expect(busyDay.find('[data-test="workload-hours"]').text()).toBe('9h');
        expect(busyDay.find('[data-test="workload-hours"]').classes()).toContain('is-over');
        expect(busyDay.text()).not.toContain('Write the brief');
        expect(emptyDay.find('[data-test="workload-hours"]').exists()).toBe(false);
        expect(emptyDay.find('.wl__fill').exists()).toBe(false);
        expect(shortDay.find('[data-test="workload-hours"]').text()).toBe('0.5h');
    });

    it('keeps the number outside the bar, so a short bar cannot clip it', async () => {
        const wrapper = await mountGrid();
        const shortDay = cellsOf(wrapper, 0)[1];

        expect(shortDay.find('.wl__fill').attributes('style')).toContain('height: 6.25%');
        expect(shortDay.find('.wl__fill [data-test="workload-hours"]').exists()).toBe(false);
    });

    it('lists its tasks in the side panel when clicked', async () => {
        const wrapper = await mountGrid();
        await cellsOf(wrapper, 0)[0].trigger('click');
        const rows = wrapper.findAll('[data-test="workload-panel-task"]');

        expect(rows.map((row) => row.find('.wcp__task-name').text())).toEqual(['Write the brief', 'Review']);
        expect(rows.map((row) => row.attributes('draggable'))).toEqual(['true', 'true']);
    });
});

describe('moving a task from the side panel', () => {
    it('moves every estimate of the dragged task to the cell it is dropped on', async () => {
        const wrapper = await mountGrid();
        await cellsOf(wrapper, 0)[0].trigger('click');
        const review = wrapper.findAll('[data-test="workload-panel-task"]')[1];

        await review.trigger('dragstart', { dataTransfer: dataTransfer() });
        const target = cellsOf(wrapper, 1)[2];
        await target.trigger('dragover');
        expect(wrapper.find('.wl__hint').text()).toContain('Time.dragging');
        await target.trigger('drop');
        await review.trigger('dragend');
        await flushPromises();

        const moves = apiRequest.mock.calls.filter(([, url]) => String(url).includes('move')).map(([, , body]) => body);
        expect(moves).toEqual([
            { taskId: 't2', estimateId: 'e2', fromUserId: 'user-1', toUserId: 'user-2', fromDate: '2026-09-07', toDate: '2026-09-09' },
            { taskId: 't2', estimateId: 'e3', fromUserId: 'user-1', toUserId: 'user-2', fromDate: '2026-09-07', toDate: '2026-09-09' },
        ]);
    });

    it('does not offer dragging in Logged mode', async () => {
        const wrapper = await mountGrid();
        await wrapper.find('[data-test="workload-mode-logged"]').trigger('click');
        await cellsOf(wrapper, 0)[0].trigger('click');

        expect(wrapper.findAll('[data-test="workload-panel-task"]').map((row) => row.attributes('draggable'))).toEqual(['false', 'false']);
    });
});
