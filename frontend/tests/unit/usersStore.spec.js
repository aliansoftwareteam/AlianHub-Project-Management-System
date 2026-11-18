import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';

const { apiRequest, apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/services/index.js', () => ({ apiRequest, apiRequestWithoutCompnay }));

import users from '@/store/Users';
import { mutateUsers, mutateCounts } from '@/store/Users/mutations';

let store, socket;
const u = (id, name, extra = {}) => ({ _id: id, Employee_Name: name, ...extra });

beforeEach(() => {
    socket = { id: 'sock-1', emit: vi.fn(), on: vi.fn() };
    store = createStore({
        modules: {
            users: { ...users, state: { users: [], myCounts: {} } },
            settings: { namespaced: true, state: { socketInstance: socket } }
        }
    });
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('setUsers', () => {
    it('lists the company users sorted by name ignoring case and padding', async () => {
        apiRequestWithoutCompnay.mockResolvedValueOnce({ status: 200, data: [u('3', 'zoe'), u('1', '  bob '), u('2', 'Alice')] });
        const result = await store.dispatch('users/setUsers', { cid: 'c1' });
        expect(result.map((x) => x._id)).toEqual(['2', '1', '3']);
        expect(store.getters['users/users'].map((x) => x._id)).toEqual(['2', '1', '3']);
        expect(result.every((x) => x.isUserDelete === false)).toBe(true);
    });

    it('asks only for active users assigned to the company', async () => {
        apiRequestWithoutCompnay.mockResolvedValueOnce({ status: 200, data: [u('1', 'A')] });
        await store.dispatch('users/setUsers', { cid: 'c9' });
        const [method, , body] = apiRequestWithoutCompnay.mock.calls[0];
        expect(method).toBe('post');
        expect(body).toEqual({ query: { isActive: true, AssignCompany: { $in: ['c9'] } }, companyId: 'c9' });
    });

    it('does not list a user twice when loaded again', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ status: 200, data: [u('1', 'A')] });
        await store.dispatch('users/setUsers', { cid: 'c1' });
        await store.dispatch('users/setUsers', { cid: 'c1' });
        expect(store.getters['users/users']).toHaveLength(1);
    });

    it('survives users without a name while sorting', async () => {
        apiRequestWithoutCompnay.mockResolvedValueOnce({ status: 200, data: [u('1', 'Bob'), { _id: '2' }] });
        const result = await store.dispatch('users/setUsers', { cid: 'c1' });
        expect(result).toHaveLength(2);
    });

    it.each([
        ['an empty list', { status: 200, data: [] }],
        ['no data', { status: 200 }],
        ['a non-200 answer', { status: 500, data: [u('1', 'A')] }]
    ])('resolves [] for %s', async (_, resp) => {
        apiRequestWithoutCompnay.mockResolvedValueOnce(resp);
        expect(await store.dispatch('users/setUsers', { cid: 'c1' })).toEqual([]);
    });

    it('resolves [] when the request fails', async () => {
        apiRequestWithoutCompnay.mockRejectedValueOnce(new Error('offline'));
        expect(await store.dispatch('users/setUsers', { cid: 'c1' })).toEqual([]);
    });

    it('shows no users when the company has none', async () => {
        apiRequestWithoutCompnay.mockResolvedValueOnce({ status: 200, data: [] });
        await store.dispatch('users/setUsers', { cid: 'c1' });
        expect(store.getters['users/users']).toEqual([]);
    });

    it('shows no users after a failed request', async () => {
        apiRequestWithoutCompnay.mockRejectedValueOnce(new Error('offline'));
        await store.dispatch('users/setUsers', { cid: 'c1' });
        expect(store.getters['users/users']).toEqual([]);
    });

    it('rejects when the payload is missing', async () => {
        await expect(store.dispatch('users/setUsers')).rejects.toBeDefined();
    });
});

describe('myCounts', () => {
    it('stores the counts for the user and resolves them', async () => {
        apiRequest.mockResolvedValueOnce({ data: { data: { t1_comments: 4 } } });
        const out = await store.dispatch('users/myCounts', { uid: 'u1' });
        expect(out).toEqual({ type: 'add', data: { t1_comments: 4 } });
        expect(store.getters['users/myCounts']).toEqual(out);
        expect(apiRequest.mock.calls[0][0]).toBe('get');
        expect(apiRequest.mock.calls[0][1]).toMatch(/\/u1$/);
    });

    it('joins the notification room with the socket id and applies live updates', async () => {
        apiRequest.mockResolvedValueOnce({ data: { data: { a_comments: 1 } } });
        await store.dispatch('users/myCounts', { uid: 'u1' });
        expect(socket.emit).toHaveBeenCalledWith('joinUserIdNotification', { uid: 'u1', socketId: 'sock-1' });

        const [event, handler] = socket.on.mock.calls[0];
        expect(event).toBe('userIdNoticationUpdate');
        handler({ fullDocument: { a_comments: 7 } });
        expect(store.getters['users/myCounts']).toEqual({ type: 'update', data: { a_comments: 7 } });
    });

    it('never shows a negative badge from a live update', async () => {
        apiRequest.mockResolvedValueOnce({ data: { data: {} } });
        await store.dispatch('users/myCounts', { uid: 'u1' });
        socket.on.mock.calls[0][1]({ fullDocument: { a_comments: -3, b_comments: 2 } });
        expect(store.getters['users/myCounts'].data).toEqual({ a_comments: 0, b_comments: 2 });
    });

    it('rejects when the counts request fails', async () => {
        apiRequest.mockRejectedValueOnce(new Error('nope'));
        await expect(store.dispatch('users/myCounts', { uid: 'u1' })).rejects.toThrow('nope');
        expect(store.getters['users/myCounts']).toEqual({});
    });

    it('rejects when the answer has no data', async () => {
        apiRequest.mockResolvedValueOnce({});
        await expect(store.dispatch('users/myCounts', { uid: 'u1' })).rejects.toBeDefined();
    });

    it('rejects when no socket is available', async () => {
        apiRequest.mockResolvedValueOnce({ data: { data: {} } });
        store.state.settings.socketInstance = null;
        await expect(store.dispatch('users/myCounts', { uid: 'u1' })).rejects.toBeDefined();
    });

    it('rejects when called without a payload', async () => {
        await expect(store.dispatch('users/myCounts')).rejects.toBeDefined();
    });
});

describe('mutateUsers', () => {
    let state;
    beforeEach(() => { state = { users: [u('1', 'A'), u('2', 'B')] }; });

    it('adds a new user but not a duplicate', () => {
        mutateUsers(state, { op: 'added', data: u('3', 'C') });
        mutateUsers(state, { op: 'added', data: u('3', 'Dup') });
        expect(state.users.map((x) => x.Employee_Name)).toEqual(['A', 'B', 'C']);
    });

    it('replaces a modified user and ignores unknown ids', () => {
        mutateUsers(state, { op: 'modified', data: u('2', 'Bee') });
        mutateUsers(state, { op: 'modified', data: u('9', 'Ghost') });
        expect(state.users.map((x) => x.Employee_Name)).toEqual(['A', 'Bee']);
    });

    it('removes a user and ignores unknown ids', () => {
        mutateUsers(state, { op: 'removed', data: u('1') });
        mutateUsers(state, { op: 'removed', data: u('9') });
        expect(state.users.map((x) => x._id)).toEqual(['2']);
    });

    it('ignores unknown operations', () => {
        mutateUsers(state, { op: 'noop', data: u('5', 'E') });
        expect(state.users).toHaveLength(2);
    });
});

describe('mutateCounts', () => {
    it('clamps negative comment counts to 0 and keeps other fields', () => {
        const state = { myCounts: {} };
        mutateCounts(state, { data: { a_comments: -2, b_comments: 5, c_other: -9, d_comments: '-1', _id: 'x' } });
        expect(state.myCounts.data).toEqual({ a_comments: 0, b_comments: 5, c_other: -9, d_comments: '-1', _id: 'x' });
    });

    it.each([[undefined], [{}], [{ data: null }], [{ data: 'str' }]])('stores %j without failing', (payload) => {
        const state = { myCounts: { old: 1 } };
        mutateCounts(state, payload);
        expect(state.myCounts).toEqual(payload);
    });
});

describe('getters', () => {
    it('currentUser is the user whose id is saved on this device', async () => {
        store.commit('users/mutateUsers', { op: 'added', data: u('1', 'A') });
        store.commit('users/mutateUsers', { op: 'added', data: u('2', 'B') });
        localStorage.setItem('userId', '2');
        expect(store.getters['users/currentUser'].Employee_Name).toBe('B');
    });

    it('currentUser is undefined when nobody is signed in or the user is not listed', () => {
        store.commit('users/mutateUsers', { op: 'added', data: u('1', 'A') });
        expect(store.getters['users/currentUser']).toBeUndefined();
        localStorage.setItem('userId', 'ghost');
        expect(store.getters['users/currentUser']).toBeUndefined();
    });
});
