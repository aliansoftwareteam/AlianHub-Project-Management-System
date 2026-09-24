import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({
    default: {
        getters: {
            'users/users': [{ _id: 'user-1', Employee_Name: 'Tara Tracker', timeZone: 'UTC', timeFormat: '24' }],
            'settings/companyOwnerDetail': { _id: 'owner-1' },
            'settings/companyDateFormat': { dateFormat: 'DD/MM/YYYY' }
        }
    }
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Tara Tracker' }) }) }));

const TASK = { _id: 'task-1', TaskKey: 'AH-1', TaskName: 'Write spec', ProjectID: 'proj-1', sprintId: 'sprint-1' };

async function load() {
    vi.resetModules();
    const panel = await import('@/components/organisms/TaskDetailOverlay/useTaskTimer');
    const home = await import('@/components/molecules/Home/useTimer');
    const time = await import('@/composable/useTimer');
    return { panel, home, time };
}

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('userId', 'user-1');
    localStorage.setItem('selectedCompany', 'company-1');
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('one running timer for the panel, Home and Time', () => {
    it('Home and Time see a timer started in the task panel', async () => {
        const { panel, home, time } = await load();
        panel.initTimer('user-1');
        await panel.startTimer({ taskId: TASK._id, taskKey: TASK.TaskKey, taskName: TASK.TaskName, projectId: TASK.ProjectID, sprintId: TASK.sprintId });
        vi.advanceTimersByTime(90 * 1000);

        const homeTimer = home.useTimer();
        expect(homeTimer.timer.active).toMatchObject({ taskId: 'task-1', taskName: 'Write spec', running: true });
        expect(homeTimer.isTracking('task-1')).toBe(true);
        expect(Math.floor(homeTimer.elapsedMs.value / 1000)).toBe(90);

        const timeTimer = time.useTimer();
        expect(timeTimer.running.value).toBe(true);
        expect(timeTimer.active.value).toMatchObject({ taskId: 'task-1', taskName: 'Write spec' });
        expect(timeTimer.elapsed.value).toBe(90);
    });

    it('the panel sees a timer started on Home, stored per user', async () => {
        const { panel, home } = await load();
        home.useTimer().start(TASK, { ProjectName: 'Launch' });
        await Promise.resolve();
        expect(panel.isTimerFor('task-1')).toBe(true);
        expect(JSON.parse(localStorage.getItem('ah.timer.user-1'))).toMatchObject({ taskId: 'task-1', projectName: 'Launch' });
        expect(localStorage.getItem('ah.timer')).toBeNull();
    });

    it('pausing on Home pauses the panel timer', async () => {
        const { panel, home } = await load();
        panel.initTimer('user-1');
        await panel.startTimer({ taskId: 'task-1', taskName: 'Write spec' });
        home.useTimer().pause();
        expect(panel.timerState.entry.paused).toBe(true);
        expect(home.useTimer().timer.active.running).toBe(false);
    });

    it('stopping on Home logs the time once and clears it everywhere', async () => {
        const { panel, home, time } = await load();
        panel.initTimer('user-1');
        await panel.startTimer({ taskId: 'task-1', taskName: 'Write spec', projectId: 'proj-1', sprintId: 'sprint-1' });
        vi.advanceTimersByTime(25 * 60 * 1000);
        const result = await home.useTimer().stop({ companyId: 'company-1', userId: 'user-1' });
        expect(result).toMatchObject({ taskName: 'Write spec', logged: true });
        const posts = apiRequest.mock.calls.filter(([method]) => method === 'post');
        expect(posts).toHaveLength(1);
        expect(posts[0][2]).toMatchObject({ ticketId: 'task-1', timeDuration: '00:25', userId: 'user-1', userName: 'Tara Tracker', companyId: 'company-1' });
        expect(panel.timerState.entry).toBeNull();
        expect(time.useTimer().running.value).toBe(false);
    });

    it('trimming an overnight timer on the Time page logs the chosen minutes and clears it', async () => {
        const { panel, time } = await load();
        panel.initTimer('user-1');
        await panel.startTimer({ taskId: 'task-1', taskName: 'Write spec', projectId: 'proj-1', sprintId: 'sprint-1' });
        vi.advanceTimersByTime(13 * 3600 * 1000);
        const timer = time.useTimer();
        expect(timer.overnight.value).toBe(true);
        await timer.stop({ minutes: 180 });
        const post = apiRequest.mock.calls.find(([method]) => method === 'post');
        expect(post[2]).toMatchObject({ ticketId: 'task-1', timeDuration: '3:00' });
        expect(panel.timerState.entry).toBeNull();
    });

    it('carries over a timer left in the old shared key', async () => {
        localStorage.setItem('ah.timer', JSON.stringify({ taskId: 'task-9', taskName: 'Old one', projectId: 'proj-1', startedAt: Date.now() - 60000, accumulated: 0, running: true, firstStartedAt: Date.now() - 60000 }));
        const { panel, home } = await load();
        panel.initTimer('user-1');
        expect(panel.isTimerFor('task-9')).toBe(true);
        expect(localStorage.getItem('ah.timer')).toBeNull();
        expect(home.useTimer().timer.active).toMatchObject({ taskId: 'task-9', running: true });
    });
});
