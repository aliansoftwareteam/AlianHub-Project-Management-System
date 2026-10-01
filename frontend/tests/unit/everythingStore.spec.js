/* Task 046 M2, slice E2: the Everything store. `@/services` answers from
   tests/fixtures/everythingResponses.json, which the server's own handler recorded for the requests
   this store sends (tests/everything-fixture.test.js at the repo root), so a request that was never
   recorded is one the page should not be making. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';
import fixture from '../fixtures/everythingResponses.json';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import everything from '@/store/Everything';

const VIEWER = { now: new Date('2026-10-01T06:30:00.000Z'), timeZone: 'Asia/Kolkata' };
const ME = '6f0000000000000000000001';
const WEB = '6f0000000000000000000a01';
const OPS = '6f0000000000000000000a02';

const canon = (value) => {
    if (Array.isArray(value)) return value.map(canon);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
    return value;
};
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const recordedAs = (body) => Object.keys(fixture).find((name) => same(fixture[name].request, body));

const answer = (method, url, body) => {
    const name = recordedAs(body);
    if (!name) return Promise.reject(new Error(`a request the server never recorded: ${JSON.stringify(body)}`));
    const { statusCode, response } = fixture[name];
    return statusCode === 200 ? Promise.resolve({ data: response }) : Promise.reject({ response: { status: statusCode, data: response } });
};

const sent = () => apiRequest.mock.calls.map(([, , body]) => body);
const sentNames = () => sent().map(recordedAs);
const names = (group) => group.rows.map((row) => row.TaskName);

let store;
const groups = () => store.getters['everything/groups'];
const group = (id) => groups().find((entry) => entry.id === id);
const load = (options = {}) => store.dispatch('everything/load', { ...VIEWER, ...options });
const applySettings = (settings) => store.dispatch('everything/applySettings', { settings, ...VIEWER });
const loadGroup = (id) => store.dispatch('everything/loadGroup', { id });

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(answer);
    store = createStore({ modules: { everything } });
    store.commit('everything/setPageSize', 2);
});

describe('the first page', () => {
    it('posts to the everything endpoint and keeps the rows, the total, the cursor and the projects on the page', async () => {
        await load();

        expect(apiRequest.mock.calls[0].slice(0, 2)).toEqual(['post', '/api/v2/tasks/everything']);
        expect(sentNames()).toEqual(['all']);
        expect(store.getters['everything/status']).toBe('ready');
        expect(groups()).toHaveLength(1);
        expect(group('all')).toMatchObject({ count: 5, loaded: true, loading: false, nextCursor: fixture.all.response.data.nextCursor });
        expect(names(group('all'))).toEqual(['Rotate the keys', 'Renew the domain']);
        expect(store.getters['everything/total']).toBe(5);
        expect(Object.keys(store.getters['everything/projects'])).toEqual([OPS]);
        expect(store.getters['everything/projects'][OPS]).toMatchObject({ ProjectName: 'Operations', ProjectCode: 'OPS', edit: { status: true, priority: true } });
    });

    it('hides done work unless asked, and shows subtasks only when asked', async () => {
        await load();
        expect(sent()[0].filter.statusType).toEqual(['default_active', 'active']);
        expect(sent()[0].includeSubtasks).toBe(false);

        await applySettings({ hideDone: false });
        expect(sentNames().at(-1)).toBe('withDone');
        expect(sent().at(-1).filter).not.toHaveProperty('statusType');
        expect(store.getters['everything/total']).toBe(6);

        await applySettings({ hideDone: true, showSubtasks: true });
        expect(sentNames().at(-1)).toBe('withSubtasks');
        expect(sent().at(-1).includeSubtasks).toBe(true);
    });

    it('says so when nothing matches', async () => {
        await applySettings({ search: 'nothing is called this' });
        expect(sentNames()).toEqual(['nothing']);
        expect(store.getters['everything/status']).toBe('ready');
        expect(store.getters['everything/total']).toBe(0);
        expect(group('all').rows).toEqual([]);
    });

    it('reports a failure, and loads again when asked', async () => {
        apiRequest.mockImplementationOnce(() => Promise.reject(new Error('network')));
        await load();
        expect(store.getters['everything/status']).toBe('error');

        await load();
        expect(store.getters['everything/status']).toBe('ready');
        expect(names(group('all'))).toEqual(['Rotate the keys', 'Renew the domain']);
    });
});

describe('paging', () => {
    it('follows the cursor to the end, each row once, and then asks for nothing more', async () => {
        await load();
        await loadGroup('all');
        expect(sentNames()).toEqual(['all', 'allNext']);
        expect(sent()[1].cursor).toBe(fixture.all.response.data.nextCursor);
        expect(names(group('all'))).toEqual(['Rotate the keys', 'Renew the domain', 'Fix the footer', 'Draw the home page']);
        expect(Object.keys(store.getters['everything/projects']).sort()).toEqual([WEB, OPS].sort());

        await loadGroup('all');
        expect(sentNames().at(-1)).toBe('allLast');
        expect(names(group('all'))).toHaveLength(5);
        expect(group('all').nextCursor).toBeNull();

        await loadGroup('all');
        expect(apiRequest).toHaveBeenCalledTimes(3);
    });

    it('starts from page one, with no cursor, when a filter changes', async () => {
        await load();
        expect(group('all').nextCursor).toEqual(expect.any(String));

        await applySettings({ assignee: [ME] });
        expect(sentNames().at(-1)).toBe('mine');
        expect(sent().at(-1)).not.toHaveProperty('cursor');
        expect(names(group('all'))).toEqual(['Rotate the keys', 'Draw the home page']);
        expect(group('all').nextCursor).toBe(fixture.mine.response.data.nextCursor);
    });

    it('does not ask twice for the same page while one request is out', async () => {
        await load();
        await Promise.all([loadGroup('all'), loadGroup('all')]);
        expect(sentNames()).toEqual(['all', 'allNext']);
    });

    it('drops an answer that arrives after the filter has changed', async () => {
        let release;
        apiRequest.mockImplementationOnce((method, url, body) => new Promise((resolve) => { release = () => resolve(answer(method, url, body)); }));
        const slow = load();
        await applySettings({ assignee: [ME] });
        release();
        await slow;

        expect(names(group('all'))).toEqual(['Rotate the keys', 'Draw the home page']);
        expect(store.getters['everything/total']).toBe(3);
    });
});

describe('groups', () => {
    it('reads the counts first and no rows until a group is asked for', async () => {
        await applySettings({ group: 'status' });

        expect(sentNames()).toEqual(['statusCounts']);
        expect(sent()[0]).toMatchObject({ group: 'status', limit: 1 });
        expect(groups().map(({ id, count, loaded, rows }) => ({ id, count, loaded, rows }))).toEqual([
            { id: 'status:Doing', count: 3, loaded: false, rows: [] },
            { id: 'status:To Do', count: 2, loaded: false, rows: [] }
        ]);
    });

    it('pages inside a group by sending that group as a filter, then its cursor', async () => {
        await applySettings({ group: 'status' });
        await loadGroup('status:Doing');

        expect(sentNames().at(-1)).toBe('statusDoing');
        expect(sent().at(-1).filter).toEqual({ statusType: ['default_active', 'active'], status: ['Doing'] });
        expect(sent().at(-1)).not.toHaveProperty('group');
        expect(sent().at(-1)).not.toHaveProperty('cursor');
        expect(names(group('status:Doing'))).toEqual(['Rotate the keys', 'Fix the footer']);
        expect(group('status:To Do').rows).toEqual([]);

        await loadGroup('status:Doing');
        expect(sentNames().at(-1)).toBe('statusDoingNext');
        expect(sent().at(-1).cursor).toBe(fixture.statusDoing.response.data.nextCursor);
        expect(sent().at(-1).filter.status).toEqual(['Doing']);
        expect(names(group('status:Doing'))).toEqual(['Rotate the keys', 'Fix the footer', 'Draw the home page']);
        expect(group('status:Doing').nextCursor).toBeNull();
    });

    it.each([
        ['project', `project:${WEB}`, 'projectCounts', 'projectWebsite', { projectIds: [WEB] }],
        ['priority', 'priority:HIGH', 'priorityCounts', 'priorityHigh', { priority: ['HIGH'] }],
        ['assignee', 'assignee:unassigned', 'assigneeCounts', 'assigneeNobody', { assignee: ['unassigned'] }]
    ])('groups by %s', async (kind, id, counts, page, filter) => {
        await applySettings({ group: kind });
        await loadGroup(id);
        expect(sentNames()).toEqual([counts, page]);
        expect(sent().at(-1).filter).toMatchObject(filter);
        expect(group(id).rows.length).toBeGreaterThan(0);
    });

    it('puts nobody\'s tasks last, and names every project it counts', async () => {
        await applySettings({ group: 'assignee' });
        expect(groups().at(-1)).toMatchObject({ id: 'assignee:unassigned', key: null, count: 1 });

        await applySettings({ group: 'project' });
        expect(groups().map((entry) => entry.key).sort()).toEqual([WEB, OPS].sort());
    });

    it('folds due dates into the viewer\'s buckets and asks for each bucket by its dates', async () => {
        await applySettings({ group: 'dueDate' });
        expect(sentNames()).toEqual(['dueCounts']);
        expect(sent()[0].timezone).toBe('Asia/Kolkata');
        expect(groups().map(({ id, count }) => ({ id, count }))).toEqual([
            { id: 'dueDate:overdue', count: 1 }, { id: 'dueDate:today', count: 1 }, { id: 'dueDate:week', count: 1 },
            { id: 'dueDate:later', count: 1 }, { id: 'dueDate:none', count: 1 }
        ]);

        await loadGroup('dueDate:week');
        expect(sentNames().at(-1)).toBe('due_week');
        expect(names(group('dueDate:week'))).toEqual(['Fix the footer']);
        await loadGroup('dueDate:none');
        expect(sent().at(-1).filter.dueDate).toEqual({ none: true });
        expect(names(group('dueDate:none'))).toEqual(['Rotate the keys']);
    });

    it('starts a group again, silently, when the server refuses its cursor', async () => {
        await applySettings({ group: 'status' });
        store.commit('everything/groupPage', {
            id: 'status:To Do', rows: [{ _id: 'stale', TaskName: 'left over from an older query' }], projects: {},
            nextCursor: fixture.statusDoing.response.data.nextCursor, replace: true
        });

        await loadGroup('status:To Do');

        expect(sentNames().slice(-2)).toEqual(['staleCursor', 'statusToDo']);
        expect(sent().at(-1)).not.toHaveProperty('cursor');
        expect(names(group('status:To Do'))).toEqual(['Renew the domain', 'Write the brief']);
        expect(group('status:To Do')).toMatchObject({ failed: false, loading: false });
        expect(store.getters['everything/status']).toBe('ready');
    });

    it('marks only the group when its page fails, and can try again', async () => {
        await applySettings({ group: 'status' });
        apiRequest.mockImplementationOnce(() => Promise.reject(new Error('network')));
        await loadGroup('status:Doing');
        expect(group('status:Doing')).toMatchObject({ failed: true, loading: false, rows: [] });
        expect(store.getters['everything/status']).toBe('ready');

        await loadGroup('status:Doing');
        expect(group('status:Doing')).toMatchObject({ failed: false });
        expect(names(group('status:Doing'))).toHaveLength(2);
    });
});

describe('a quiet refresh, on focus and after an edit', () => {
    it('reads page one again without clearing the screen', async () => {
        await load();
        await loadGroup('all');
        const statuses = [];
        store.subscribe(() => statuses.push(store.getters['everything/status']));

        await load({ quiet: true });

        expect(sentNames().at(-1)).toBe('all');
        expect(statuses.every((status) => status === 'ready')).toBe(true);
        expect(names(group('all'))).toEqual(['Rotate the keys', 'Renew the domain']);
    });

    it('reads again the groups that were open, and leaves the others unread', async () => {
        await applySettings({ group: 'status' });
        await loadGroup('status:Doing');
        await loadGroup('status:Doing');
        apiRequest.mockClear();

        await load({ quiet: true });

        expect(sentNames()).toEqual(['statusCounts', 'statusDoing']);
        expect(names(group('status:Doing'))).toEqual(['Rotate the keys', 'Fix the footer']);
        expect(group('status:To Do')).toMatchObject({ loaded: false, rows: [] });
    });
});

describe('a row edited in place', () => {
    it('changes wherever the row is shown', async () => {
        await load();
        store.commit('everything/patchRow', { taskId: '6f0000000000000000000f05', fields: { Task_Priority: 'LOW' } });
        expect(store.getters['everything/rowById']('6f0000000000000000000f05')).toMatchObject({ TaskName: 'Rotate the keys', Task_Priority: 'LOW' });
        expect(store.getters['everything/rowById']('6f0000000000000000000f04').Task_Priority).toBe('LOW');
        expect(store.getters['everything/rowById']('missing')).toBeNull();
    });
});
