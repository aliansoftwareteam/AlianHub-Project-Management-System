import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import en from '@/locales/en.js';

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

const LOG = '/api/v2/manualLogtime';
const TRIM = '/api/v2/timetracker/trim';
const LOCKED = { status: false, code: 'period_locked', statusText: "This timesheet period is approved and locked — time can't be added to it." };
const KEPT_LOCKED = 'Time.timer_kept_period_locked';
const KEPT_FAILED = 'Time.timer_kept_log_failed';
const TASK = { _id: 'task-1', TaskKey: 'AH-1', TaskName: 'Write spec', ProjectID: 'proj-1', sprintId: 'sprint-1' };
const STORED = 'ah.timer.user-1';
const MINUTE = 60 * 1000;
const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

let logAnswer;
const logs = () => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && String(url).includes(LOG));
const approveTheWeek = () => { logAnswer = () => Promise.resolve({ data: LOCKED }); };
const reopenTheWeek = () => { logAnswer = () => Promise.resolve({ data: { status: true, data: {} } }); };

async function load() {
    vi.resetModules();
    const panel = await import('@/components/organisms/TaskDetailOverlay/useTaskTimer');
    const home = await import('@/components/molecules/Home/useTimer');
    const time = await import('@/composable/useTimer');
    const failure = await import('@/composable/timeLogFailure');
    panel.initTimer('user-1');
    return { panel, home, time, failure };
}

async function runningFor(minutes, panel) {
    await panel.startTimer({ taskId: 'task-1', taskKey: 'AH-1', taskName: 'Write spec', projectId: 'proj-1', sprintId: 'sprint-1' });
    vi.advanceTimersByTime(minutes * MINUTE);
}

const mountOptions = { global: { mocks: { $t: (key) => key }, stubs: { ShellIcon: true }, provide: { $userId: ref('user-1'), $companyId: ref('company-1') } } };

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('userId', 'user-1');
    localStorage.setItem('selectedCompany', 'company-1');
    reopenTheWeek();
    apiRequest.mockReset();
    apiRequest.mockImplementation((method, url) => {
        if (method === 'post' && String(url).includes(LOG)) return logAnswer();
        if (method === 'post' && String(url).includes(TRIM)) return Promise.resolve({ data: { status: false, code: 'period_locked', statusText: 'This timesheet period is approved and locked.' } });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
    Object.values(toast).forEach((fn) => fn.mockReset());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('stopping a timer whose week was approved while it ran', () => {
    it('keeps the timer, running from where it started, on the screen and in the browser', async () => {
        const { panel } = await load();
        await runningFor(25, panel);
        const startedAt = panel.timerState.entry.firstStartedAt;
        approveTheWeek();

        const result = await panel.stopTimer();

        expect(result).toMatchObject({ logged: false, timerKept: true, code: 'period_locked' });
        expect(panel.isTimerFor('task-1')).toBe(true);
        expect(panel.timerState.entry).toMatchObject({ firstStartedAt: startedAt, paused: false });
        expect(JSON.parse(localStorage.getItem(STORED))).toMatchObject({ taskId: 'task-1', firstStartedAt: startedAt });
        vi.advanceTimersByTime(5 * MINUTE);
        expect(panel.elapsedSeconds.value).toBe(30 * 60);
    });

    it('logs all of the time once the week is reopened', async () => {
        const { panel } = await load();
        await runningFor(25, panel);
        approveTheWeek();
        await panel.stopTimer();
        vi.advanceTimersByTime(5 * MINUTE);
        reopenTheWeek();

        const result = await panel.stopTimer();

        expect(result).toMatchObject({ logged: true });
        expect(logs()).toHaveLength(2);
        expect(logs()[1][2]).toMatchObject({ ticketId: 'task-1', timeDuration: '00:30' });
        expect(panel.timerState.entry).toBeNull();
        expect(localStorage.getItem(STORED)).toBeNull();
    });

    it('keeps a paused timer paused, with the time it had', async () => {
        const { panel } = await load();
        await runningFor(25, panel);
        panel.pauseTimer();
        approveTheWeek();

        await panel.stopTimer();

        expect(panel.timerState.entry).toMatchObject({ paused: true, accumulatedMs: 25 * MINUTE });
    });

    it('is told to Home and to the Time pages as a kept timer, and both still show it', async () => {
        const { panel, home, time } = await load();
        await runningFor(25, panel);
        approveTheWeek();

        await expect(home.useTimer().stop()).rejects.toMatchObject({ code: 'period_locked', timerKept: true });
        await expect(time.useTimer().stop()).rejects.toMatchObject({ code: 'period_locked', timerKept: true });
        expect(home.useTimer().timer.active).toMatchObject({ taskId: 'task-1', running: true });
        expect(time.useTimer().running.value).toBe(true);
        expect(time.useTimer().lastStopped.value).toBeNull();
    });

    it('is told the same way when the Time page stops it at a chosen length', async () => {
        const { panel, time } = await load();
        await runningFor(13 * 60, panel);
        approveTheWeek();

        await expect(time.useTimer().stop({ minutes: 180 })).rejects.toMatchObject({ code: 'period_locked', timerKept: true });
        expect(panel.isTimerFor('task-1')).toBe(true);
    });

    it('says so in the task panel, which keeps its clock and its Stop button', async () => {
        const { panel } = await load();
        const { default: TaskTimerChip } = await import('@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue');
        await runningFor(25, panel);
        approveTheWeek();
        const wrapper = mount(TaskTimerChip, { props: { task: TASK, project: { ProjectName: 'Launch' } }, ...mountOptions });

        await wrapper.find('.ah-timer__btn--stop').trigger('click');
        await flushPromises();

        expect(toast.error).toHaveBeenCalledWith(KEPT_LOCKED, expect.anything());
        expect(toast.success).not.toHaveBeenCalled();
        expect(wrapper.emitted('logged')).toBeUndefined();
        expect(wrapper.find('.ah-timer__btn--stop').exists()).toBe(true);
        expect(wrapper.find('.ah-timer__clock').text()).toBe('00:25:00');
    });

    it('says so on Home, which keeps its timer chip', async () => {
        const { panel } = await load();
        const { default: TimerChip } = await import('@/components/molecules/Home/TimerChip.vue');
        await runningFor(25, panel);
        approveTheWeek();
        const wrapper = mount(TimerChip, mountOptions);

        await wrapper.find('.hc-timer__btn--icon').trigger('click');
        await flushPromises();

        expect(toast.error).toHaveBeenCalledWith(KEPT_LOCKED, expect.anything());
        expect(wrapper.find('.hc-timer').exists()).toBe(true);
    });

    it('has words that name the approval and say nothing is lost', () => {
        expect(en.Time.timer_kept_period_locked).toMatch(/approved/);
        expect(en.Time.timer_kept_period_locked).toMatch(/nothing is lost/);
        expect(en.Time.timer_kept_log_failed).toMatch(/nothing is lost/);
    });
});

describe('a stop that fails for another reason', () => {
    it('keeps the timer when the server cannot be reached', async () => {
        const { panel, failure } = await load();
        await runningFor(25, panel);
        logAnswer = () => Promise.reject(new Error('offline'));

        const result = await panel.stopTimer();

        expect(result).toMatchObject({ logged: false, timerKept: true });
        expect(failure.timeLogFailureKey(result, 'Home.timer_log_failed')).toBe(KEPT_FAILED);
        expect(panel.isTimerFor('task-1')).toBe(true);
    });

    it('keeps the timer when the server refuses the time', async () => {
        const { panel } = await load();
        await runningFor(25, panel);
        logAnswer = () => Promise.resolve({ data: { status: false, statusText: 'Description is required' } });

        expect(await panel.stopTimer()).toMatchObject({ logged: false, timerKept: true });
        expect(panel.isTimerFor('task-1')).toBe(true);
    });

    it('does not start a timer on another task over the one it could not log', async () => {
        const { panel } = await load();
        await runningFor(25, panel);
        logAnswer = () => Promise.reject(new Error('offline'));

        await expect(panel.startTimer({ taskId: 'task-2', taskName: 'Review spec' })).rejects.toMatchObject({ timerKept: true });
        expect(panel.isTimerFor('task-1')).toBe(true);
        vi.advanceTimersByTime(5 * MINUTE);
        expect(panel.elapsedSeconds.value).toBe(30 * 60);
    });
});

describe('a stop that goes through', () => {
    it('is sent once when Stop is pressed twice', async () => {
        const { panel } = await load();
        await runningFor(25, panel);

        const [first, second] = await Promise.all([panel.stopTimer(), panel.stopTimer()]);

        expect(first).toMatchObject({ logged: true });
        expect(second).toBeNull();
        expect(logs()).toHaveLength(1);
        expect(panel.timerState.entry).toBeNull();
    });

    it('leaves a timer started on another task while it was being sent', async () => {
        const { panel } = await load();
        await runningFor(25, panel);
        let answerLog;
        logAnswer = () => new Promise((resolve) => { answerLog = resolve; });

        const stopping = panel.stopTimer();
        panel.timerState.entry = { taskId: 'task-2', firstStartedAt: Date.now(), startedAt: Date.now(), accumulatedMs: 0, paused: false };
        answerLog({ data: { status: true } });
        await stopping;

        expect(panel.isTimerFor('task-2')).toBe(true);
    });
});

describe('a message for a refusal', () => {
    it('is the kept-timer one only when a timer was kept', async () => {
        const { failure } = await load();

        expect(failure.timeLogFailureKey({ code: 'period_locked', timerKept: true }, 'Time.log_failed')).toBe(KEPT_LOCKED);
        expect(failure.timeLogFailureKey({ timerKept: true }, 'Time.log_failed')).toBe(KEPT_FAILED);
        expect(failure.timeLogFailureKey({ code: 'period_locked' }, 'Time.log_failed')).toBe('Time.period_locked');
        expect(failure.timeLogFailureKey(new Error('log_failed'), 'Time.log_failed')).toBe('Time.log_failed');
    });

    it('reaches the Time page when a tracker timer in an approved week cannot be trimmed', async () => {
        const { time } = await load();

        await expect(time.useTimer().trim({ timeSheetId: 'sheet-1' }, 180)).rejects.toMatchObject({ code: 'period_locked', timerKept: true });
        expect(read('views/TimeLog/LogTimeSheet.vue')).toMatch(/\[s\.key\]: t\(timeLogFailureKey\(e, 'Time\.trim_failed'\)\)/);
    });
});
