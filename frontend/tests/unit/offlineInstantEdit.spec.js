/* An edit made while the server is away is kept, sent when it is back, and put back with a
   message if the server then refuses it. It is never dropped without a word. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';

const h = vi.hoisted(() => ({
    network: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    rows: [],
    nextId: 1,
    storeWorks: true
}));

vi.mock('@/offline/db', () => ({
    queueAdd: async (item) => {
        if (!h.storeWorks) return undefined;
        const id = h.nextId++;
        h.rows.push({ ...item, id, at: 1000 + id });
        return id;
    },
    queueAll: async () => h.rows.map((row) => ({ ...row })),
    queueDelete: async (id) => { h.rows.splice(0, h.rows.length, ...h.rows.filter((row) => row.id !== id)); },
    queueUpdate: async (id, patch) => { Object.assign(h.rows.find((row) => row.id === id) || {}, patch); },
    cachePut: async () => {},
    cacheGet: async () => undefined,
    clearAll: async () => { h.rows.length = 0; }
}));
vi.mock('@/services', async () => {
    const offline = await import('@/offline');
    const apiRequest = (type, endPoint, data, dataType) => h.network(type, endPoint, data).catch(async (error) => {
        const kept = await offline.handleOfflineFailure(type, endPoint, data, dataType, error);
        if (kept) return kept;
        throw error;
    });
    offline.registerReplayer(apiRequest);
    return { apiRequest };
});
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key) } } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => h.toast }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
vi.mock('@/store/index', async () => {
    const { createStore } = await import('vuex');
    const { mutateUpdateFirebaseTasks } = await import('@/store/ProjectData/mutations');
    return {
        default: createStore({
            getters: { 'settings/companyOwnerDetail': () => ({ userId: 'u1' }), 'settings/companyPriority': () => [] },
            modules: { projectData: { namespaced: true, state: () => ({ tasks: {} }), mutations: { mutateUpdateFirebaseTasks } } }
        })
    };
});

import Store from '@/store/index';
import taskClass from '@/utils/TaskOperations';
import * as offline from '@/offline';

const PID = 'p1';
const SPRINT = 's1';
const TASK_ID = 'a'.repeat(24);
const PROJECT = { _id: PID, CompanyId: 'c1', ProjectName: 'Website', ProjectCode: 'WEB' };
const USER = { id: 'u1', Employee_Name: 'Olivia Owner', companyOwnerId: 'u1' };
const TOAST = { position: 'top-right' };
const CLOSED_PROJECT = 'This project is closed.';

const OPEN = { status: { text: 'Open', key: 1, type: 'default_active' }, statusType: 'default_active', statusKey: 1 };
const PROGRESS = { status: { text: 'In Progress', key: 3, type: 'active' }, statusType: 'active', statusKey: 3 };
const DONE = { status: { text: 'Done', key: 2, type: 'close' }, statusType: 'close', statusKey: 2 };

const seed = () => {
    Store.state.projectData.tasks = {
        [PID]: {
            projectId: PID, sprints: [SPRINT],
            groupBy: { type: 0, items: [{ key: 'statusKey_1', value: 1, name: 'Open' }, { key: 'statusKey_3', value: 3, name: 'In Progress' }, { key: 'statusKey_2', value: 2, name: 'Done' }] },
            [SPRINT]: {
                index: {}, found: { statusKey_1: 1, statusKey_3: 0, statusKey_2: 0 }, snapshot: null,
                tasks: [{ _id: TASK_ID, TaskName: 'Write the brief', ProjectID: PID, sprintId: SPRINT, isParentTask: true, ParentTaskId: '', ancestors: [], ...OPEN, AssigneeUserId: ['u1'] }]
            }
        }
    };
};

const row = () => Store.state.projectData.tasks[PID][SPRINT].tasks.find((task) => task._id === TASK_ID);
const setStatus = (next, options = {}) => taskClass.updateStatus({ newStatus: next, prevStatus: { taskId: TASK_ID }, projectData: PROJECT, task: { ...row() }, userData: USER, ...options });

const serverAway = () => h.network.mockImplementation(() => Promise.reject({ code: 'ERR_NETWORK', message: 'Network Error' }));
const serverTakes = () => h.network.mockImplementation(() => Promise.resolve({ data: { status: true } }));
const serverRefuses = (statusText = CLOSED_PROJECT) => h.network.mockImplementation((type) => (type === 'get'
    ? Promise.resolve({ data: {} })
    : Promise.reject({ response: { status: 400, data: { status: false, statusText } } })));

beforeEach(async () => {
    await offline.clearOffline();
    h.rows.length = 0;
    h.nextId = 1;
    h.storeWorks = true;
    h.network.mockReset();
    h.toast.error.mockReset();
    offline.attempt.value = 0;
    seed();
});

describe('the list of changes kept for later', () => {
    it('answers a kept write with the number it was kept under', async () => {
        const answer = await offline.handleOfflineFailure('patch', '/api/v2/tasks', { action: 'updateStatus' }, undefined, { code: 'ERR_NETWORK' });
        expect(answer.data).toMatchObject({ status: true, queuedOffline: true, queueId: 1 });
        expect(offline.pendingCount.value).toBe(1);
    });

    it('does not answer as kept when this device cannot keep the write', async () => {
        h.storeWorks = false;
        const answer = await offline.handleOfflineFailure('patch', '/api/v2/tasks', { action: 'updateStatus' }, undefined, { code: 'ERR_NETWORK' });
        expect(answer).toBeNull();
    });

    it('keeps a write under the same number and time when sending it again fails', async () => {
        serverAway();
        await setStatus(DONE);
        const kept = { ...h.rows[0] };
        await offline.flushQueue();
        expect(h.rows).toHaveLength(1);
        expect(h.rows[0]).toMatchObject({ id: kept.id, at: kept.at, attempts: 1 });
    });

    it('tells its listeners when the server refuses a kept write, and why', async () => {
        const settled = vi.fn();
        const stop = offline.onQueuedWriteSettled(settled);
        serverAway();
        await setStatus(DONE);
        serverRefuses();
        await offline.flushQueue();
        stop();
        expect(h.rows).toHaveLength(0);
        expect(settled).toHaveBeenCalledWith(expect.objectContaining({ id: 1, outcome: 'refused', reason: CLOSED_PROJECT }));
    });

    it('counts an answer of status false as a refusal', async () => {
        const settled = vi.fn();
        const stop = offline.onQueuedWriteSettled(settled);
        serverAway();
        await setStatus(DONE);
        h.network.mockImplementation((type) => Promise.resolve({ data: type === 'get' ? {} : { status: false, statusText: CLOSED_PROJECT } }));
        await offline.flushQueue();
        stop();
        expect(settled).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'refused', reason: CLOSED_PROJECT }));
    });
});

describe('an edit made while the server is away', () => {
    it('stays on the row, is counted as waiting and raises no message', async () => {
        serverAway();
        await expect(setStatus(DONE, { announce: true })).resolves.toMatchObject({ status: true });
        expect(row().statusKey).toBe(2);
        expect(offline.pendingCount.value).toBe(1);
        expect(h.toast.error).not.toHaveBeenCalled();
    });

    it('stays on the row once the server takes it', async () => {
        serverAway();
        await setStatus(DONE);
        serverTakes();
        await offline.flushQueue();
        await flushPromises();
        expect(row().statusKey).toBe(2);
        expect(offline.pendingCount.value).toBe(0);
        expect(h.toast.error).not.toHaveBeenCalled();
    });

    it('goes back with the server\'s reason when the server refuses it later', async () => {
        serverAway();
        await setStatus(DONE);
        serverRefuses();
        await offline.flushQueue();
        await flushPromises();
        expect(row().statusKey).toBe(1);
        expect(h.toast.error).toHaveBeenCalledTimes(1);
        expect(h.toast.error).toHaveBeenCalledWith(`Toast.offline_change_not_saved_reason ${JSON.stringify({ reason: CLOSED_PROJECT })}`, TOAST);
    });

    it('goes back with a plain message when the server gives no reason', async () => {
        serverAway();
        await setStatus(DONE);
        serverRefuses('');
        await offline.flushQueue();
        await flushPromises();
        expect(row().statusKey).toBe(1);
        expect(h.toast.error).toHaveBeenCalledWith('Toast.offline_change_not_saved', TOAST);
    });

    it('returns to where the row started when two edits of one field are both refused', async () => {
        serverAway();
        await setStatus(PROGRESS);
        await setStatus(DONE);
        expect(row().statusKey).toBe(2);
        serverRefuses();
        await offline.flushQueue();
        await flushPromises();
        expect(row().statusKey).toBe(1);
        expect(h.toast.error).toHaveBeenCalledTimes(2);
    });

    it('goes back at once, with the message, when this device cannot keep it', async () => {
        h.storeWorks = false;
        serverAway();
        await expect(setStatus(DONE, { announce: true })).rejects.toMatchObject({ status: false, announced: true });
        expect(row().statusKey).toBe(1);
        expect(h.toast.error).toHaveBeenCalledWith('Toast.Status_not_updated', TOAST);
    });

    it('says a kept change was refused even when no row on screen holds it', async () => {
        h.rows.push({ id: 9, at: 1, type: 'post', endPoint: '/api/v1/comments', data: { message: 'hello' }, attempts: 0 });
        serverRefuses();
        await offline.flushQueue();
        await flushPromises();
        expect(h.toast.error).toHaveBeenCalledWith(`Toast.offline_change_not_saved_reason ${JSON.stringify({ reason: CLOSED_PROJECT })}`, TOAST);
    });
});
