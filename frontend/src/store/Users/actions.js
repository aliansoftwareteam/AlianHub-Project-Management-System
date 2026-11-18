import { apiRequest, apiRequestWithoutCompnay } from "@/services/index.js";
import * as env from '@/config/env';
export const setUsers = ({ commit }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const query = {
                isActive: true,
                AssignCompany: { $in: [payload.cid] }
            };
            apiRequestWithoutCompnay('post', `${env.USER_UPATE}/find`, { query: query, companyId: payload.cid })
                .then((resp) => {
                    if (resp.status === 200) {
                        const response = resp.data?.sort((a, b) => a.Employee_Name?.trim()?.toLowerCase() > b.Employee_Name?.trim()?.toLowerCase() ? 1 : -1);
                        if (response && response.length) {
                            const array = response.map((userFromResponse) => {
                                const tmpData = {
                                    ...userFromResponse,
                                    _id: userFromResponse._id,
                                    isUserDelete: false
                                }
                                commit("mutateUsers", {
                                    data: tmpData,
                                    op: "added",
                                });
                                return tmpData
                            });

                            resolve(array);
                        } else {
                            resolve([]);
                        }
                    } else {
                        resolve([]);
                    }
                })
                .catch((error) => {
                    console.error("ERROR in get data: ", error);
                    resolve([]);
                })

        } catch (error) {
            reject(error);
        }
    })
};

export const myCounts = ({ commit, rootState }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const { uid } = payload;
            apiRequest("get", `${env.USER_ID_COLLECTION}/${uid}`).then((response) => {
                const obj = {
                    type: "add",
                    data: response.data.data
                };
                commit("mutateCounts", { ...obj })
                resolve(obj)
            })
                .catch((error) => {
                    reject(error)
                })
            rootState.settings.socketInstance.emit('joinUserIdNotification', { uid, socketId: rootState.settings.socketInstance.id });
            rootState.settings.socketInstance.on('userIdNoticationUpdate', (data) => {
                const obj = {
                    type: "update",
                    data: data.fullDocument
                };
                commit("mutateCounts", { ...obj })
            })
        } catch (error) {
            reject(error);
        }
    })
}