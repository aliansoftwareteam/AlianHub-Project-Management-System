import { apiRequest } from "@/services";
import * as env from '@/config/env';

export const setChats = ({ commit, rootState }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            commit("setChatPayload", payload);
            if (!payload.from && payload.from !== 'storeWatch') {
                const getQuery = [
                    {
                        mainChat: true,
                        objId: {
                            ProjectID: payload.projectId
                        },
                        AssigneeUserId: payload.userId
                    }
                ]
                apiRequest('post', env.SET_CHATS, { findQuery: getQuery })
                    .then((res) => {
                        if (res.status === 200 && res.data.length > 0) {
                            commit('mutateChats', res.data.map((x) => ({ snap: null, op: "added", data: { ...x } })));
                            resolve(res);
                        } else {
                            resolve([]);
                        }
                    })
                    .catch((error) => {
                        reject(error);
                    })
            } else {
                // AHE-3834 — the fetch is skipped when the list is already cached
                // (`from` set). Previously nothing resolved here, so any awaiting
                // caller hung forever (e.g. the chat loading skeleton).
                resolve(rootState.mainChat?.chats?.data?.length || []);
            }
            const socketInstance = rootState.settings?.socketInstance;
            if (socketInstance) {
                socketInstance.emit('joinChats', { projectId: payload.projectId, socketId: socketInstance.id, userId: payload.userId });

                // AHE-3834 — always `.off()` before `.on()`. Without this, every
                // re-dispatch (project switch, reconnect, storeWatch) stacked another
                // handler on the same socket, so one incoming chat event fired the
                // mutation N times.
                socketInstance.off('chatTaskInsert');
                socketInstance.off('chatTaskUpdate');
                socketInstance.off('chatTaskDelete');
                socketInstance.off('chatTaskReplace');

                socketInstance.on('chatTaskInsert', (data) => {
                    commit('mutateChats', [{ snap: {}, op: "added", data: { ...data.fullDocument } }]);
                })
                socketInstance.on('chatTaskUpdate', (data) => {
                    commit('mutateChats', [{ snap: {}, op: "modified", data: { ...data.fullDocument } }]);
                })
                socketInstance.on('chatTaskDelete', (data) => {
                    commit('mutateChats', [{ snap: {}, op: "modified", data: { ...data } }]);
                })
                socketInstance.on('chatTaskReplace', (data) => {
                    commit('mutateChats', [{ snap: {}, op: "removed", data: { ...data.fullDocument } }]);
                })
            }
        } catch (e) {
            reject(e);
        }
    })
}

export const setChatTabSync = ({ state, commit }, payload) => {
    const { response } = payload;
    response.forEach((ele) => {
        let index = state.chats.data.findIndex((element) => element._id === ele._id);
        if (index !== -1) {
            commit('mutateChats', [{ snap: {}, op: "modified", data: ele }]);
        } else {
            commit('mutateChats', [{ snap: {}, op: "added", data: ele }]);
        }
    })
}


export const setChatProjects = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.MAIN_CHATS)
                .then((chats) => {
                    resolve(chats.data);
                    chats.data.forEach((ch) => {
                        commit("mutateChatProjects", [{ snap: {}, op: "added", data: { ...ch, _id: ch._id, sprintsObj: {}, sprintsfolders: {} } }]);
                    })
                })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error);
        }
    })
}

export const setChatSprints = ({ commit }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${payload?.projectId}?collection=sprints`)
                .then((resp) => {
                    let res = resp?.data || [];
                    let result = [];
                    res.map(x => {
                        const obj = { op: "added", data: { ...x } }
                        commit('mutateChatSprints', obj);
                        result.push(obj);
                    })
                    resolve(res);
                })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error)
        }
    })
}

export const setChatFolders = ({ commit }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${payload?.projectId}?collection=folders`)
                .then((resp) => {
                    let res = resp?.data || [];
                    let result = [];
                    res.map(x => {
                        const obj = { op: "added", data: { ...x } }
                        commit('mutateChatFolders', obj);
                        result.push(obj);
                    })
                    resolve(res);
                })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error)
        }
    })
}