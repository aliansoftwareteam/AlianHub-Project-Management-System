import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import * as env from '@/config/env';
import mainChat from '@/store/MainChats';

const fakeSocket = () => {
    const handlers = {};
    return {
        id: 'sock-1',
        handlers,
        emit: vi.fn(),
        off: vi.fn((event) => { delete handlers[event]; }),
        on: vi.fn((event, fn) => { handlers[event] = fn; })
    };
};

const build = (socketInstance = null) => createStore({
    modules: {
        settings: { namespaced: true, state: { socketInstance } },
        mainChat: {
            ...mainChat,
            state: () => ({
                chats: { snap: null, data: [] },
                chatPaylaod: {},
                mainChatProjects: { snap: null, data: [] },
                mainChatSprints: { snap: null, data: {} },
                mainChatFolders: { snap: null, data: {} },
                commentRoomData: {}
            })
        }
    }
});

const chatIds = (store) => store.state.mainChat.chats.data.map((c) => c._id);

let store;
beforeEach(() => {
    apiRequest.mockReset();
    store = build();
});

describe('chat list mutations', () => {
    it('adds, replaces and removes chats by id', () => {
        store.commit('mainChat/mutateChats', [
            { snap: null, op: 'added', data: { _id: 'a', text: 'one' } },
            { snap: null, op: 'added', data: { _id: 'b', text: 'two' } }
        ]);
        store.commit('mainChat/mutateChats', [{ snap: {}, op: 'modified', data: { _id: 'a', text: 'edited' } }]);
        expect(store.state.mainChat.chats.data).toEqual([{ _id: 'a', text: 'edited' }, { _id: 'b', text: 'two' }]);

        store.commit('mainChat/mutateChats', [{ snap: {}, op: 'removed', data: { _id: 'a' } }]);
        expect(chatIds(store)).toEqual(['b']);
    });

    it('ignores an edit or removal of a chat it does not hold', () => {
        store.commit('mainChat/mutateChats', [{ op: 'added', data: { _id: 'a' } }]);
        store.commit('mainChat/mutateChats', [
            { op: 'modified', data: { _id: 'zzz', text: 'ghost' } },
            { op: 'removed', data: { _id: 'zzz' } }
        ]);
        expect(store.state.mainChat.chats.data).toEqual([{ _id: 'a' }]);
    });

    it('keeps the snapshot only when the event carries one', () => {
        store.commit('mainChat/mutateChats', [{ snap: { at: 1 }, op: 'added', data: { _id: 'a' } }]);
        store.commit('mainChat/mutateChats', [{ snap: null, op: 'added', data: { _id: 'b' } }]);
        expect(store.state.mainChat.chats.snap).toEqual({ at: 1 });
    });
});

describe('chat project mutations', () => {
    const projects = () => store.state.mainChat.mainChatProjects.data;

    it('treats adding a known project as a refresh, not a duplicate', () => {
        store.commit('mainChat/mutateChatProjects', [{ op: 'added', data: { _id: 'p1', name: 'Old' } }]);
        store.commit('mainChat/mutateChatProjects', [{ op: 'added', data: { _id: 'p1', name: 'New' } }]);
        expect(projects()).toEqual([{ _id: 'p1', name: 'New' }]);
    });

    it('modifies and removes only projects that exist', () => {
        store.commit('mainChat/mutateChatProjects', [{ snap: { s: 1 }, op: 'added', data: { _id: 'p1', name: 'A' } }]);
        store.commit('mainChat/mutateChatProjects', [
            { op: 'modified', data: { _id: 'p1', name: 'B' } },
            { op: 'modified', data: { _id: 'nope', name: 'X' } },
            { op: 'removed', data: { _id: 'nope' } }
        ]);
        expect(projects()).toEqual([{ _id: 'p1', name: 'B' }]);
        expect(store.state.mainChat.mainChatProjects.snap).toEqual({ s: 1 });

        store.commit('mainChat/mutateChatProjects', [{ op: 'removed', data: { _id: 'p1' } }]);
        expect(projects()).toEqual([]);
    });

    it('serves a deep copy through the getter so callers cannot edit the store', () => {
        store.commit('mainChat/mutateChatProjects', [{ op: 'added', data: { _id: 'p1', name: 'A' } }]);
        store.getters['mainChat/mainChatProjects'].data[0].name = 'hacked';
        expect(projects()[0].name).toBe('A');
    });
});

describe.each([
    ['sprints', 'mutateChatSprints', 'mainChatSprints'],
    ['folders', 'mutateChatFolders', 'mainChatFolders']
])('chat %s per project', (_label, mutation, key) => {
    const bucket = () => store.getters[`mainChat/${key}`];
    const commit = (op, data) => store.commit(`mainChat/${mutation}`, { op, data });

    it('keeps every project cached side by side', () => {
        commit('added', { _id: 's1', projectId: 'p1' });
        commit('added', { _id: 's2', projectId: 'p2' });
        commit('added', { _id: 's3', projectId: 'p1' });
        expect(Object.keys(bucket()).filter((k) => k !== 'snap' && k !== 'data')).toEqual(['p1', 'p2']);
        expect(bucket().p1.map((x) => x._id)).toEqual(['s1', 's3']);
    });

    it('does not add the same item twice', () => {
        commit('added', { _id: 's1', projectId: 'p1' });
        commit('added', { _id: 's1', projectId: 'p1' });
        expect(bucket().p1).toHaveLength(1);
    });

    it('replaces a modified item and ignores one it does not know', () => {
        commit('added', { _id: 's1', projectId: 'p1', name: 'old' });
        commit('modified', { _id: 's1', projectId: 'p1', name: 'new' });
        commit('modified', { _id: 'missing', projectId: 'p1', name: 'x' });
        commit('modified', { _id: 's1', projectId: 'unknown', name: 'x' });
        expect(bucket().p1).toEqual([{ _id: 's1', projectId: 'p1', name: 'new' }]);
        expect(bucket().unknown).toBeUndefined();
    });
});

describe('chat sprint and folder removal', () => {
    it('removes a sprint by its id field', () => {
        store.commit('mainChat/mutateChatSprints', { op: 'added', data: { _id: 's1', projectId: 'p1' } });
        store.commit('mainChat/mutateChatSprints', { op: 'removed', data: { id: 's1', projectId: 'p1' } });
        expect(store.getters['mainChat/mainChatSprints'].p1).toEqual([]);
    });

    it('removes a folder by its _id', () => {
        store.commit('mainChat/mutateChatFolders', { op: 'added', data: { _id: 'f1', projectId: 'p1' } });
        store.commit('mainChat/mutateChatFolders', { op: 'added', data: { _id: 'f2', projectId: 'p1' } });
        store.commit('mainChat/mutateChatFolders', { op: 'removed', data: { _id: 'f1', projectId: 'p1' } });
        expect(store.getters['mainChat/mainChatFolders'].p1.map((f) => f._id)).toEqual(['f2']);
    });

    it('leaves the list alone when the sprint to remove is not in it', () => {
        store.commit('mainChat/mutateChatSprints', { op: 'added', data: { _id: 's1', projectId: 'p1' } });
        store.commit('mainChat/mutateChatSprints', { op: 'removed', data: { id: 'other', projectId: 'p1' } });
        expect(store.getters['mainChat/mainChatSprints'].p1).toHaveLength(1);
    });

    it('ignores removing a sprint of a project it never cached', () => {
        expect(() => store.commit('mainChat/mutateChatSprints', { op: 'removed', data: { id: 's1', projectId: 'p9' } })).not.toThrow();
    });

    // the guard before findIndex is missing for folders, so an unknown project throws
    it.fails('ignores removing a folder of a project it never cached', () => {
        expect(() => store.commit('mainChat/mutateChatFolders', { op: 'removed', data: { _id: 'f1', projectId: 'p9' } })).not.toThrow();
    });
});

describe('small setters', () => {
    it('remembers the chat payload and the comment room', () => {
        store.commit('mainChat/setChatPayload', { projectId: 'p1', userId: 'u1' });
        store.commit('mainChat/setCommentRoomName', { room: 'r1' });
        expect(store.getters['mainChat/getChatPayload']).toEqual({ projectId: 'p1', userId: 'u1' });
        expect(store.getters['mainChat/getCommentRoomData']).toEqual({ room: 'r1' });
    });
});

describe('loading chats', () => {
    const payload = { projectId: 'p1', userId: 'u1' };

    it('asks for the main chats of the user in the project and fills the list', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [{ _id: 'c1' }, { _id: 'c2' }] });
        const res = await store.dispatch('mainChat/setChats', payload);

        expect(res.data).toHaveLength(2);
        expect(chatIds(store)).toEqual(['c1', 'c2']);
        expect(store.getters['mainChat/getChatPayload']).toEqual(payload);
        expect(apiRequest).toHaveBeenCalledWith('post', env.SET_CHATS, {
            findQuery: [{ mainChat: true, objId: { ProjectID: 'p1' }, AssigneeUserId: 'u1' }]
        });
    });

    it('resolves with an empty list and shows nothing when the project has no chats', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [] });
        await expect(store.dispatch('mainChat/setChats', payload)).resolves.toEqual([]);
        expect(chatIds(store)).toEqual([]);
    });

    it('resolves empty on a non-200 answer', async () => {
        apiRequest.mockResolvedValue({ status: 500, data: [{ _id: 'c1' }] });
        await expect(store.dispatch('mainChat/setChats', payload)).resolves.toEqual([]);
        expect(chatIds(store)).toEqual([]);
    });

    it('rejects when the request fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        await expect(store.dispatch('mainChat/setChats', payload)).rejects.toThrow('offline');
    });

    it('does not refetch for a store watch and resolves with how many chats are cached', async () => {
        store.commit('mainChat/mutateChats', [{ op: 'added', data: { _id: 'c1' } }, { op: 'added', data: { _id: 'c2' } }]);
        await expect(store.dispatch('mainChat/setChats', { ...payload, from: 'storeWatch' })).resolves.toBe(2);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('resolves an empty list on a store watch with nothing cached, instead of hanging', async () => {
        await expect(store.dispatch('mainChat/setChats', { ...payload, from: 'storeWatch' })).resolves.toEqual([]);
    });
});

describe('live chat events', () => {
    let socket;
    beforeEach(async () => {
        socket = fakeSocket();
        store = build(socket);
        apiRequest.mockResolvedValue({ status: 200, data: [{ _id: 'c1', text: 'hi' }] });
        await store.dispatch('mainChat/setChats', { projectId: 'p1', userId: 'u1' });
    });

    it('joins the chat room of the project', () => {
        expect(socket.emit).toHaveBeenCalledWith('joinChats', { projectId: 'p1', socketId: 'sock-1', userId: 'u1' });
    });

    it('shows a chat that arrives and an edit to one that exists', () => {
        socket.handlers.chatTaskInsert({ fullDocument: { _id: 'c2', text: 'new' } });
        socket.handlers.chatTaskUpdate({ fullDocument: { _id: 'c1', text: 'edited' } });
        expect(store.state.mainChat.chats.data).toEqual([{ _id: 'c1', text: 'edited' }, { _id: 'c2', text: 'new' }]);
    });

    it('re-dispatching does not stack handlers, so one event adds one chat', async () => {
        await store.dispatch('mainChat/setChats', { projectId: 'p1', userId: 'u1', from: 'storeWatch' });
        socket.handlers.chatTaskInsert({ fullDocument: { _id: 'c2' } });
        expect(chatIds(store)).toEqual(['c1', 'c2']);
        expect(Object.keys(socket.handlers).sort()).toEqual(['chatTaskDelete', 'chatTaskInsert', 'chatTaskReplace', 'chatTaskUpdate']);
    });

    // a deleted chat arrives as a bare document key; it is committed as an edit and wipes the chat's content
    it.fails('drops a chat when the server says it was deleted', () => {
        socket.handlers.chatTaskDelete({ _id: 'c1' });
        expect(chatIds(store)).toEqual([]);
    });

    // a replaced chat is committed as a removal, so the chat vanishes instead of updating
    it.fails('keeps a chat when the server replaces it', () => {
        socket.handlers.chatTaskReplace({ fullDocument: { _id: 'c1', text: 'replaced' } });
        expect(store.state.mainChat.chats.data).toEqual([{ _id: 'c1', text: 'replaced' }]);
    });
});

describe('syncing chats from another tab', () => {
    it('updates chats it has and adds the ones it lacks', async () => {
        store.commit('mainChat/mutateChats', [{ op: 'added', data: { _id: 'c1', text: 'old' } }]);
        await store.dispatch('mainChat/setChatTabSync', { response: [{ _id: 'c1', text: 'fresh' }, { _id: 'c2', text: 'extra' }] });
        expect(store.state.mainChat.chats.data).toEqual([{ _id: 'c1', text: 'fresh' }, { _id: 'c2', text: 'extra' }]);
    });

    it('does nothing for an empty response', async () => {
        await store.dispatch('mainChat/setChatTabSync', { response: [] });
        expect(chatIds(store)).toEqual([]);
    });
});

describe('loading chat projects, sprints and folders', () => {
    it('stores each chat project with empty sprint and folder maps', async () => {
        apiRequest.mockResolvedValue({ data: [{ _id: 'p1', name: 'A' }, { _id: 'p2', name: 'B' }] });
        const res = await store.dispatch('mainChat/setChatProjects');
        expect(res).toHaveLength(2);
        expect(store.state.mainChat.mainChatProjects.data).toEqual([
            { _id: 'p1', name: 'A', sprintsObj: {}, sprintsfolders: {} },
            { _id: 'p2', name: 'B', sprintsObj: {}, sprintsfolders: {} }
        ]);
        expect(apiRequest).toHaveBeenCalledWith('get', env.MAIN_CHATS);
    });

    it('rejects when the chat projects cannot be read', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        await expect(store.dispatch('mainChat/setChatProjects')).rejects.toThrow('down');
        expect(store.state.mainChat.mainChatProjects.data).toEqual([]);
    });

    it.each([
        ['setChatSprints', 'sprints', 'mainChatSprints'],
        ['setChatFolders', 'folders', 'mainChatFolders']
    ])('%s caches the rows under their project', async (action, collection, key) => {
        apiRequest.mockResolvedValue({ data: [{ _id: 'x1', projectId: 'p1' }, { _id: 'x2', projectId: 'p1' }] });
        const res = await store.dispatch(`mainChat/${action}`, { projectId: 'p1' });
        expect(res).toHaveLength(2);
        expect(store.getters[`mainChat/${key}`].p1.map((x) => x._id)).toEqual(['x1', 'x2']);
        expect(apiRequest.mock.calls[0][1]).toContain(`/p1?collection=${collection}`);
    });

    it.each(['setChatSprints', 'setChatFolders'])('%s resolves empty when the answer carries no data', async (action) => {
        apiRequest.mockResolvedValue(undefined);
        await expect(store.dispatch(`mainChat/${action}`, { projectId: 'p1' })).resolves.toEqual([]);
        apiRequest.mockResolvedValue({});
        await expect(store.dispatch(`mainChat/${action}`, { projectId: 'p1' })).resolves.toEqual([]);
    });

    it.each(['setChatSprints', 'setChatFolders'])('%s rejects when the request fails', async (action) => {
        apiRequest.mockRejectedValue(new Error('boom'));
        await expect(store.dispatch(`mainChat/${action}`, { projectId: 'p1' })).rejects.toThrow('boom');
    });
});
