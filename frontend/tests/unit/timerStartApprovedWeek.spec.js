import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const { apiRequest, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Tara Tracker' }) }) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

const CAN_START = '/api/v2/timetracker/can-start';
const LOCKED = { status: false, code: 'period_locked', statusText: "This timesheet period is approved and locked — a timer can't start in it." };
const TASK = { _id: 'task-1', TaskKey: 'AH-1', TaskName: 'Write spec', ProjectID: 'proj-1', sprintId: 'sprint-1' };
const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

const answer = (canStart) => (method, url) => {
    if (String(url).includes(CAN_START)) return typeof canStart === 'function' ? canStart() : Promise.resolve({ data: canStart });
    return Promise.resolve({ data: { status: true, data: [] } });
};
const posts = () => apiRequest.mock.calls.filter(([method]) => method === 'post');
const startChecks = () => apiRequest.mock.calls.filter(([, url]) => String(url).includes(CAN_START));

async function load() {
    vi.resetModules();
    const panel = await import('@/components/organisms/TaskDetailOverlay/useTaskTimer');
    const home = await import('@/components/molecules/Home/useTimer');
    const time = await import('@/composable/useTimer');
    panel.initTimer('user-1');
    return { panel, home, time };
}

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('userId', 'user-1');
    localStorage.setItem('selectedCompany', 'company-1');
    apiRequest.mockReset();
    apiRequest.mockImplementation(answer({ status: true }));
    Object.values(toast).forEach((fn) => fn.mockReset());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('starting a timer on a day in an approved week', () => {
    it('is refused before a timer exists, with the code a refused stop carries', async () => {
        apiRequest.mockImplementation(answer(LOCKED));
        const { panel } = await load();

        await expect(panel.startTimer({ taskId: 'task-1', taskName: 'Write spec' })).rejects.toMatchObject({ code: 'period_locked' });
        expect(panel.timerState.entry).toBeNull();
        expect(localStorage.getItem('ah.timer.user-1')).toBeNull();
    });

    it('is refused from Home and from the Time pages too', async () => {
        apiRequest.mockImplementation(answer(LOCKED));
        const { panel, home, time } = await load();

        await expect(home.useTimer().start(TASK, { ProjectName: 'Launch' })).rejects.toMatchObject({ code: 'period_locked' });
        await expect(time.useTimer().start({ taskId: 'task-1', taskName: 'Write spec' })).rejects.toMatchObject({ code: 'period_locked' });
        expect(panel.timerState.entry).toBeNull();
    });

    it('leaves a timer that is running on another task as it was', async () => {
        const { panel } = await load();
        await panel.startTimer({ taskId: 'task-1', taskName: 'Write spec' });
        vi.advanceTimersByTime(5 * 60 * 1000);
        apiRequest.mockImplementation(answer(LOCKED));

        await expect(panel.startTimer({ taskId: 'task-2', taskName: 'Review spec' })).rejects.toMatchObject({ code: 'period_locked' });
        expect(panel.isTimerFor('task-1')).toBe(true);
        expect(posts()).toHaveLength(0);
    });

    it('tells the person why, in the words a refused stop uses, and the task panel keeps its Start button', async () => {
        apiRequest.mockImplementation(answer(LOCKED));
        const { panel } = await load();
        const { default: TaskTimerChip } = await import('@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue');
        const wrapper = mount(TaskTimerChip, {
            props: { task: TASK, project: { ProjectName: 'Launch' } },
            global: { mocks: { $t: (key) => key }, stubs: { ShellIcon: true }, provide: { $userId: ref('user-1'), $companyId: ref('company-1') } }
        });

        await wrapper.find('.ah-timer__start').trigger('click');
        await flushPromises();

        expect(toast.error).toHaveBeenCalledWith('Time.period_locked', expect.anything());
        expect(panel.timerState.entry).toBeNull();
        expect(wrapper.find('.ah-timer__start').exists()).toBe(true);
    });

    it('is caught where Home starts one', () => {
        expect(read('views/Home/TodayOverdue.vue')).toMatch(/try \{\s*await start\(task, work\.projectOf\(task\)\);\s*\} catch \(error\) \{[^}]*timeLogFailureKey\(error,/);
    });
});

describe('starting a timer on an open day', () => {
    it('asks the server once and starts', async () => {
        const { panel } = await load();

        await panel.startTimer({ taskId: 'task-1', taskName: 'Write spec' });
        expect(startChecks()).toHaveLength(1);
        expect(startChecks()[0][0]).toBe('get');
        expect(panel.isTimerFor('task-1')).toBe(true);
    });

    it('starts when the server cannot be asked, since stopping is checked again', async () => {
        apiRequest.mockImplementation(answer(() => Promise.reject(new Error('offline'))));
        const { panel } = await load();

        await panel.startTimer({ taskId: 'task-1', taskName: 'Write spec' });
        expect(panel.isTimerFor('task-1')).toBe(true);
    });

    it('starts when the answer is a refusal of another kind', async () => {
        apiRequest.mockImplementation(answer({ status: false, statusText: 'An authenticated user is required.' }));
        const { panel } = await load();

        await panel.startTimer({ taskId: 'task-1', taskName: 'Write spec' });
        expect(panel.isTimerFor('task-1')).toBe(true);
    });
});

describe('a timer stopped under a minute', () => {
    it('logs nothing, and the Time page is told that it was too short', async () => {
        const { panel, time } = await load();
        await panel.startTimer({ taskId: 'task-1', taskName: 'Write spec', projectId: 'proj-1' });
        vi.advanceTimersByTime(20 * 1000);

        const stopped = await time.useTimer().stop();

        expect(stopped).toMatchObject({ tooShort: true, taskName: 'Write spec' });
        expect(posts()).toHaveLength(0);
        expect(panel.timerState.entry).toBeNull();
        expect(time.useTimer().lastStopped.value).toBeNull();
    });

    it('is said on the Time page in the line a logged timer gets', () => {
        expect(read('views/Timesheet/UserTimeSheet/UserTimesheet.vue')).toMatch(/flash\(stopped\.tooShort \? t\('TaskPanel\.timer_too_short'\) : t\('Time\.logged_ok'/);
    });

    it('is said when starting another task stops it', async () => {
        const { panel } = await load();
        const { default: TaskTimerChip } = await import('@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue');
        await panel.startTimer({ taskId: 'task-0', taskKey: 'AH-0', taskName: 'Earlier task' });
        vi.advanceTimersByTime(20 * 1000);
        const wrapper = mount(TaskTimerChip, {
            props: { task: TASK, project: { ProjectName: 'Launch' } },
            global: { mocks: { $t: (key) => key }, stubs: { ShellIcon: true }, provide: { $userId: ref('user-1'), $companyId: ref('company-1') } }
        });

        await wrapper.find('.ah-timer__start').trigger('click');
        await flushPromises();

        expect(panel.isTimerFor('task-1')).toBe(true);
        expect(toast.info.mock.calls.map(([message]) => message)).toEqual(['TaskPanel.timer_stopped_previous', 'TaskPanel.timer_too_short']);
    });
});
