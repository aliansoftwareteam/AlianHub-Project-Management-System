import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { path: '/c1/home', name: 'Home', query: {}, params: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()) }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskTimer', () => ({ initTimer: vi.fn() }));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue', () => ({
    default: { name: 'TaskDetailPanel', render: () => null }
}));
vi.mock('@/components/molecules/UndoToast/UndoToast.vue', () => ({
    default: { name: 'UndoToast', render: () => null }
}));

import TaskDetailOverlay from '@/components/organisms/TaskDetailOverlay/TaskDetailOverlay.vue';
import {
    bindRouter, closeTask, loadMinimizedTray, minimizeTask, openTask, overlayState, dismissMinimized
} from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { TRAY_CAP, trayStorageKey } from '@/components/organisms/TaskDetailOverlay/minimizedTray';

const USER = 'user-1';
const COMPANY = 'company-1';
const KEY = trayStorageKey(USER, COMPANY);
const id = (n) => `64a0000000000000000000${String(n).padStart(2, '0')}`;
const serverTask = (n, extra = {}) => ({ _id: id(n), TaskKey: `AH-${n}`, TaskName: `Task ${n}`, ProjectID: 'p1', sprintId: 's1', ...extra });
const stored = () => JSON.parse(localStorage.getItem(KEY) || 'null');

function minimise(n) {
    openTask({ companyId: COMPANY, projectId: 'p1', sprintId: 's1', taskId: id(n) });
    overlayState.meta[id(n)] = { taskKey: `AH-${n}`, taskName: `Task ${n}` };
    minimizeTask();
}

function answer(tasks, { missing = [] } = {}) {
    apiRequest.mockImplementation((method, url) => {
        const taskId = url.split('/').pop();
        if (missing.includes(taskId)) return Promise.reject({ response: { status: 404 } });
        const found = tasks.find((task) => task._id === taskId);
        return found ? Promise.resolve({ data: found }) : Promise.reject({ response: { status: 404 } });
    });
}

const fetchTask = (taskId) => apiRequest('get', `/api/v1/task/${taskId}`).then((response) => response.data);

beforeEach(async () => {
    localStorage.clear();
    apiRequest.mockReset();
    route.query = {};
    bindRouter(router, route);
    overlayState.minimized = [];
    await loadMinimizedTray({ userId: USER, companyId: COMPANY, fetchTask });
});

afterEach(() => {
    closeTask({ keepRoute: true });
    overlayState.minimized = [];
    localStorage.clear();
});

describe('minimised tray storage', () => {
    it('stores only task ids, in tray order, keyed by user and company', () => {
        minimise(1);
        minimise(2);

        expect(stored()).toEqual([id(1), id(2)]);
        expect(localStorage.getItem(KEY)).not.toContain('Task 1');
        expect(localStorage.getItem(KEY)).not.toContain('AH-1');
        expect(KEY).toContain(USER);
        expect(KEY).toContain(COMPANY);
    });

    it(`keeps at most ${TRAY_CAP} tasks, dropping the oldest`, () => {
        expect(TRAY_CAP).toBe(8);
        for (let n = 1; n <= 10; n += 1) minimise(n);

        expect(overlayState.minimized.map((item) => item.taskId)).toEqual([3, 4, 5, 6, 7, 8, 9, 10].map(id));
        expect(stored()).toEqual([3, 4, 5, 6, 7, 8, 9, 10].map(id));
    });

    it('forgets a task that is reopened or dismissed', () => {
        minimise(1);
        minimise(2);
        minimise(3);

        openTask({ companyId: COMPANY, projectId: 'p1', sprintId: 's1', taskId: id(2) });
        dismissMinimized(id(3));

        expect(stored()).toEqual([id(1)]);
    });
});

describe('restoring the tray after a reload', () => {
    it('re-reads each task through the task endpoint and restores the tray in order', async () => {
        localStorage.setItem(KEY, JSON.stringify([id(2), id(1)]));
        answer([serverTask(1), serverTask(2, { folderObjId: 'f9', sprintId: 's2' })]);

        await loadMinimizedTray({ userId: USER, companyId: COMPANY, fetchTask });

        expect(apiRequest).toHaveBeenCalledWith('get', `/api/v1/task/${id(2)}`);
        expect(apiRequest).toHaveBeenCalledWith('get', `/api/v1/task/${id(1)}`);
        expect(overlayState.minimized).toEqual([
            { companyId: COMPANY, projectId: 'p1', sprintId: 's2', folderId: 'f9', taskId: id(2), taskKey: 'AH-2', taskName: 'Task 2' },
            { companyId: COMPANY, projectId: 'p1', sprintId: 's1', folderId: '', taskId: id(1), taskKey: 'AH-1', taskName: 'Task 1' }
        ]);
    });

    it('drops tasks the user can no longer read or that were deleted, silently', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorage.setItem(KEY, JSON.stringify([id(1), id(2), id(3), id(4)]));
        answer([serverTask(1), serverTask(3, { deletedStatusKey: 1 }), serverTask(4)], { missing: [id(2)] });

        await loadMinimizedTray({ userId: USER, companyId: COMPANY, fetchTask });

        expect(overlayState.minimized.map((item) => item.taskId)).toEqual([id(1), id(4)]);
        expect(stored()).toEqual([id(1), id(4)]);
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
    });

    it('ignores anything in storage that is not a task id, and past the cap', async () => {
        const many = Array.from({ length: 12 }, (_, i) => id(i + 1));
        localStorage.setItem(KEY, JSON.stringify([{ taskName: 'x' }, 'not-an-id', ...many]));
        answer(many.map((taskId, i) => serverTask(i + 1)));

        await loadMinimizedTray({ userId: USER, companyId: COMPANY, fetchTask });

        expect(overlayState.minimized.map((item) => item.taskId)).toEqual(many.slice(-TRAY_CAP));
        expect(apiRequest).toHaveBeenCalledTimes(TRAY_CAP);
    });

    it('keeps each company its own tray', async () => {
        minimise(1);
        answer([serverTask(5)]);
        localStorage.setItem(trayStorageKey(USER, 'company-2'), JSON.stringify([id(5)]));

        await loadMinimizedTray({ userId: USER, companyId: 'company-2', fetchTask });
        expect(overlayState.minimized.map((item) => item.taskId)).toEqual([id(5)]);
        expect(stored()).toEqual([id(1)]);

        answer([serverTask(1)]);
        await loadMinimizedTray({ userId: USER, companyId: COMPANY, fetchTask });
        expect(overlayState.minimized.map((item) => item.taskId)).toEqual([id(1)]);
    });

    it('survives an unreadable storage value', async () => {
        localStorage.setItem(KEY, '{not json');
        await loadMinimizedTray({ userId: USER, companyId: COMPANY, fetchTask });
        expect(overlayState.minimized).toEqual([]);
    });
});

describe('the tray on screen', () => {
    it('shows the restored tray after a reload, and follows another tab', async () => {
        localStorage.setItem(KEY, JSON.stringify([id(1)]));
        answer([serverTask(1), serverTask(2)]);
        overlayState.minimized = [];

        const wrapper = mount(TaskDetailOverlay, { attachTo: document.body });
        await flushPromises();

        const names = () => wrapper.findAll('.ah-tray__name').map((el) => el.text());
        expect(names()).toEqual(['Task 1']);

        const value = JSON.stringify([id(1), id(2)]);
        localStorage.setItem(KEY, value);
        window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: value }));
        await flushPromises();
        expect(names()).toEqual(['Task 1', 'Task 2']);

        await wrapper.find('.ah-tray__dismiss').trigger('click');
        expect(stored()).toEqual([id(2)]);
        wrapper.unmount();
    });
});
