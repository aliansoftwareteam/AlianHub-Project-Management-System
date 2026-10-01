/* The number beside a list in the List and in the sidebar is the list's own `tasks` counter, kept by the
   server. No event carries it, so a tab that hears a task move, appear, go to the trash or be archived
   reads the counters again, once for however many events and rooms say so. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';

const { sent } = vi.hoisted(() => ({ sent: { calls: [], sprints: [] } }));

vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => {
        sent.calls.push({ method, url });
        return Promise.resolve({ status: 200, data: sent.sprints.map((sprint) => ({ ...sprint })) });
    })
}));

import projectData from '@/store/ProjectData';

const PID = 'p1';
const LIST = { _id: 'list', id: 'list', projectId: PID, name: 'List', tasks: 6, archiveTaskCount: 0 };
const SPRINT_1 = { _id: 'sprint1', id: 'sprint1', projectId: PID, name: 'Sprint 1', tasks: 12, archiveTaskCount: 0 };

const handlers = {};
const socket = { id: 's1', emit: vi.fn((event, ...args) => { if (event === 'getRoomList') args[args.length - 1]([]); }), on: vi.fn((event, handler) => { handlers[event] = handler; }), off: vi.fn() };

let store;
const countOf = (id) => store.state.projectData.sprints[PID].find((sprint) => sprint._id === id).tasks;
const serverSays = (list, sprint1, archived = 0) => { sent.sprints = [{ ...LIST, tasks: list }, { ...SPRINT_1, tasks: sprint1, archiveTaskCount: archived }]; };
const sprintReads = () => sent.calls.filter((call) => /collection=sprints/.test(call.url));
const taskEvent = (event, fullDocument, updatedFields) => handlers[event]({ fullDocument, updatedFields });
const doc = (over = {}) => ({ _id: 't1', ProjectID: PID, sprintId: 'sprint1', isParentTask: true, statusKey: 1, deletedStatusKey: 0, ...over });
const settle = async () => { await vi.advanceTimersByTimeAsync(2000); };

beforeEach(async () => {
    vi.useFakeTimers();
    sent.calls.length = 0;
    Object.keys(handlers).forEach((key) => delete handlers[key]);
    store = createStore({
        modules: {
            projectData: { ...projectData, state: () => ({ ...projectData.state, sprints: {}, tasks: {}, tableTasks: {} }) },
            settings: { namespaced: true, state: { socketInstance: socket } }
        }
    });
    [LIST, SPRINT_1].forEach((sprint) => store.commit('projectData/mutateSprints', { op: 'added', data: { ...sprint } }));
    await store.dispatch('projectData/getTasksFromMongoDB', { pid: PID, sprintId: 'list', groupBy: { type: 0, items: [] }, currentView: 'tasks' });
});

afterEach(() => { vi.useRealTimers(); });

describe('the counter of a list, on a change from another tab', () => {
    it('follows a task moved to another list, on the list it left and the list it entered', async () => {
        serverSays(5, 13);

        taskEvent('taskUpdate', doc(), { sprintId: 'sprint1' });
        await settle();

        expect(countOf('list')).toBe(5);
        expect(countOf('sprint1')).toBe(13);
    });

    it('reads once when the same move arrives through two rooms', async () => {
        serverSays(5, 13);

        taskEvent('taskUpdate', doc(), { sprintId: 'sprint1' });
        taskEvent('taskUpdate', doc(), { sprintId: 'sprint1' });
        await settle();

        expect(sprintReads()).toHaveLength(1);
        expect(countOf('sprint1')).toBe(13);
    });

    it('follows a task created in the list', async () => {
        serverSays(7, 12);

        taskEvent('taskInsert', doc({ sprintId: 'list' }));
        await settle();

        expect(countOf('list')).toBe(7);
    });

    it('follows a task removed from the list', async () => {
        serverSays(5, 12);

        taskEvent('taskDelete', doc({ sprintId: 'list' }));
        await settle();

        expect(countOf('list')).toBe(5);
    });

    it('follows a task put in the trash or archived', async () => {
        serverSays(5, 12, 1);

        taskEvent('taskUpdate', doc({ sprintId: 'list', deletedStatusKey: 2 }), { deletedStatusKey: 2 });
        await settle();

        expect(countOf('list')).toBe(5);
        expect(store.state.projectData.sprints[PID].find((sprint) => sprint._id === 'sprint1').archiveTaskCount).toBe(1);
    });

    it('does not read the counters again for an edit that cannot change them', async () => {
        taskEvent('taskUpdate', doc({ TaskName: 'Renamed' }), { TaskName: 'Renamed' });
        taskEvent('taskUpdate', doc({ statusKey: 2 }), { statusKey: 2 });
        await settle();

        expect(sprintReads()).toHaveLength(0);
    });

    it('leaves a list whose counter the server confirms as it is', async () => {
        serverSays(6, 12);
        const writes = vi.fn();
        store.subscribe((mutation) => { if (mutation.type === 'projectData/mutateSprints') writes(); });

        taskEvent('taskUpdate', doc(), { sprintId: 'sprint1' });
        await settle();

        expect(sprintReads()).toHaveLength(1);
        expect(writes).not.toHaveBeenCalled();
    });
});
