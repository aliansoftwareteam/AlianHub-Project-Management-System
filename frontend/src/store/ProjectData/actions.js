import * as env from '@/config/env';
import { apiRequest } from '../../services/index'
import { tableSortStages } from '@/views/Projects/composables/customFieldQuery';
import { groupCondition, groupCountsQuery, readGroupCounts, readGroupTotals, sprintTaskMatch } from './taskQueries';
import { ancestorsOf } from '@taskTreeRules';
import { homeListOf } from './listMembership';

/* A second caller for a page that is already on its way gets the first one's answer. */
const pagesInFlight = new Map();
/**
 * This function is used to get all the projects from MongoDB and add into the Vuex project store.
 * @param {*} state 
 * @returns 
 */
export const setProjects = (state, payload) => {
    return new Promise((resolve, reject) => {
        try {
            state.state.allProjects = [];
            apiRequest("get", `/api/v1/${env.PROJECTACTIONS}`).then((responseData) => {
                let result = [];
                responseData.data.map(x => {
                    const obj = { roleType: payload.roleType, snap: null, isPrivateSpace: x.isPrivateSpace, op: "added", data: {...x, isExpanded: false}}
                    result.push(obj);
                })
                resolve(result);
                state.commit('mutateProjects', result);
            }).catch((error)=>{
                console.error("Error while getting project",error);
            })
        } catch (error) {
            reject(error);
        }
    });
};
export const getTasksFromMongoDB = ({  state,commit,rootState  }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const {pid, sprintId, userId, showAllTasks,groupBy,currentView = 'tasks'} = payload;
            commit("setTaskSnapShotPayload",payload);
            const projectFound = Object.keys(state[currentView]).includes(pid);
            if(projectFound && groupBy?.type !== state[currentView]?.[pid]?.groupBy?.type) {
                state[currentView][pid].groupBy = groupBy;
            }
            rootState.settings.socketInstance.emit('getRoomList', rootState.settings.socketInstance.id, (rooms) => {
               let emitObj = {projectId: pid,sprintId: sprintId,socketId: rootState.settings.socketInstance.id};
               if (!(showAllTasks === undefined || showAllTasks === true || showAllTasks === 2)) {
                    emitObj.userId = userId
               }
               if (rooms.length) {
                    let currentSocketRooms = rooms.find((x)=> x.includes(rootState.settings.socketInstance.id) && x.includes('project_sprint_'))
                    if (currentSocketRooms) {
                        rootState.settings.socketInstance.emit('leaveProjectSprintForTask', currentSocketRooms);    
                        commit("setGetPaginatedTasksPayload",{data:{sprintId,pid},op: 'remove'});
                        commit("setGetTableTaskPayload",{data:{sprintId,pid},op: 'remove'});
                        const events = ['taskInsert', 'taskUpdate', 'taskDelete', 'taskReplace'];
                        events.forEach(event => {
                            rootState.settings.socketInstance.off(event);
                        });
                    }
                    rootState.settings.socketInstance.emit('joinProjectSprintForTask', emitObj);
                    rootState.settings.socketInstance.on('taskInsert', (data) => {
                        const docData = data.fullDocument;
                        commit('mutateUpdateFirebaseTasks', {snap: {}, op: "added", pid, sprintId, data: {...docData}, updatedFields:{...docData}})
                        commit('mutateTypesenseTableTasks', {snap: {},op: "added", pid, sprintId, data: {...docData}})
                    });
                    rootState.settings.socketInstance.on('taskUpdate', (data) => {
                        const docData = data.fullDocument;
                        commit('mutateUpdateFirebaseTasks', {snap: {}, op: "modified", pid, sprintId, data: {...docData},updatedFields:{...data?.updatedFields},showAllTasks});
                        commit('mutateMongoUpdatedTask', {snap: {}, op: "modified", pid, sprintId, data: {...docData}});
                        commit('mutateTypesenseTableTasks', {snap: {},op: "modified", pid, sprintId, data: {...docData}});
                    });
                    rootState.settings.socketInstance.on('taskDelete', (data) => {
                        const docData = data.fullDocument;
                        commit('mutateUpdateFirebaseTasks', {snap: {}, op: "removed", pid, sprintId, data: {...docData}})
                        commit('mutateMongoUpdatedTask', {snap: {}, op: "removed", pid, sprintId, data: {...docData}})
                        commit('mutateTypesenseTableTasks', {snap: {}, op: "removed", pid, sprintId, data: {...docData}})
                    });
                    rootState.settings.socketInstance.on('taskReplace', (data) => {
                        const docData = data.documentKey;
                        commit('mutateUpdateFirebaseTasks', {snap: {}, op: "modified", pid, sprintId, data: {...docData}})
                        commit('mutateMongoUpdatedTask', {snap: {}, op: "modified", pid, sprintId, data: {...docData}})
                        commit('mutateTypesenseTableTasks', {snap: {}, op: "modified", pid, sprintId, data: {...docData}})
                    });
               } else {
                rootState.settings.socketInstance.emit('joinProjectSprintForTask', emitObj);
                rootState.settings.socketInstance.on('taskInsert', (data) => {
                    const docData = data.fullDocument;
                    commit('mutateUpdateFirebaseTasks', {snap: {}, op: "added", pid, sprintId, data: {...docData}, updatedFields:{...docData}})
                    commit('mutateTypesenseTableTasks', {snap: {},op: "added", pid, sprintId, data: {...docData}})
                });
                rootState.settings.socketInstance.on('taskUpdate', (data) => {
                    const docData = data.fullDocument;
                    commit('mutateUpdateFirebaseTasks', {snap: {}, op: "modified", pid, sprintId, data: {...docData},updatedFields:{...data?.updatedFields},showAllTasks});
                    commit('mutateMongoUpdatedTask', {snap: {}, op: "modified", pid, sprintId, data: {...docData}});
                    commit('mutateTypesenseTableTasks', {snap: {},op: "modified", pid, sprintId, data: {...docData}});
                });
                rootState.settings.socketInstance.on('taskDelete', (data) => {
                    const docData = data.fullDocument;
                    commit('mutateUpdateFirebaseTasks', {snap: {}, op: "removed", pid, sprintId, data: {...docData}})
                    commit('mutateMongoUpdatedTask', {snap: {}, op: "removed", pid, sprintId, data: {...docData}})
                    commit('mutateTypesenseTableTasks', {snap: {}, op: "removed", pid, sprintId, data: {...docData}})
                });
                rootState.settings.socketInstance.on('taskReplace', (data) => {
                    const docData = data.documentKey;
                    commit('mutateUpdateFirebaseTasks', {snap: {}, op: "modified", pid, sprintId, data: {...docData}})
                    commit('mutateMongoUpdatedTask', {snap: {}, op: "modified", pid, sprintId, data: {...docData}})
                    commit('mutateTypesenseTableTasks', {snap: {}, op: "modified", pid, sprintId, data: {...docData}})
                });
               }
            });

            resolve();
        } catch (error) {
            reject(error);
        }
    })
}

export const getPaginatedTasks = ({state, commit}, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const {pid, sprintId, item, fetchNew, parentId = "", indexName = "", showAllTasks} = payload;
            commit("setGetPaginatedTasksPayload",{data:payload,op: 'add'});
            const indName = indexName || item.indexName

            const projectFound = Object.keys(state.tasks).includes(pid);
            let sprintFound = false;
            if(projectFound) {
                sprintFound = state.tasks[pid].sprints.includes(sprintId);
            }

            if(sprintFound && !fetchNew) {
                resolve();
                return;
            }

            let cursor = null;
            let foundKey = `${item.searchKey}_${item.searchValue}`;

            const indexKey = `${parentId && parentId.length ? `${parentId}_` : ''}${item.searchKey}_${item.searchValue}`;

            if(sprintFound) {
                cursor = state.tasks[pid][sprintId].index[indexKey] || null;
            }
            // The List opening a group, or a row opening its subtasks, wants the first page only: nothing is asked when it was read before.
            if(payload.firstPageOnly && sprintFound && state.tasks[pid][sprintId].index[indexKey] !== undefined) {
                resolve();
                return;
            }
            // The List counts the rows it holds up to the last page, so a row that left the group or joined it between pages moves the start.
            if(Number.isInteger(payload.skip) && payload.skip >= 0) {
                cursor = payload.skip;
            }

            const inParent = Boolean(parentId && parentId.length);
            const queryParams = [
                {
                    $match: {
                        ...sprintTaskMatch({ pid, sprintId: inParent ? homeListOf(state, pid, sprintId, parentId) : sprintId, showAllTasks, userId: payload.userId }),
                        ...( inParent ?
                            { ParentTaskId: parentId }
                        :
                            { isParentTask: true, ...groupCondition(item) }
                        ),
                    }
                },
                { $sort: {[indName]: 1, "createdAt": 1, _id: 1}},
            ]

            const findQuery = [
                ...queryParams,
                {
                    $facet: {
                        result:[
                            { $skip: cursor || 0},
                            { $limit: 35}
                        ],
                        count:[
                            {$count: "count" }
                        ]
                    }
                }
            ]

            const flight = `${pid}|${sprintId}|${indexKey}|${cursor || 0}`;
            if(pagesInFlight.has(flight)) {
                pagesInFlight.get(flight).then(resolve, reject);
                return;
            }

            const page = apiRequest('post',`${env.TASK}/find`,{findQuery: findQuery, ...(inParent ? {} : { inList: sprintId })})
            .then((resp) => {
                if(resp.status === 200){
                    const response = resp.data[0];
                    const responseData = response.result;

                    let resCount = {};
    
                    if (parentId && parentId.length) {
                        resCount = { [foundKey]: state.tasks[pid]?.[sprintId]?.found?.[foundKey] || 0 };
                    } else if (sprintFound && state.tasks[pid]?.[sprintId]?.found?.[foundKey]) {
                        if (response.count?.[0]?.count) {
                            resCount = { [foundKey]: response?.count[0]?.count || 0 };
                        } else {
                            // resCount = { [foundKey]: state.tasks[pid][sprintId].found[foundKey] || 0};
                            resCount = { [foundKey]: (state.tasks[pid][sprintId].found[foundKey] === 1 ? 0 : state.tasks[pid][sprintId].found[foundKey]) || 0 };
                        }
                    } else {
                        resCount = { [foundKey]: response.count?.[0]?.count || 0 };
                    }
    
                    // SET CURSOR
                    if(responseData && responseData.length) {
                        // BUG-017 / #71 fix: body is fully synchronous (Date
                        // construction + Vuex commit). Drop the unused
                        // `async` keyword.
                        responseData.forEach((task) => {
                            const doc = task;

                            if(doc.startDate && doc.startDate > 0) {
                                doc.startDate = new Date(doc.startDate * 1000);
                            }

                            if(doc.DueDate && doc.DueDate > 0) {
                                doc.DueDate = new Date(doc.DueDate * 1000);
                                // doc.dueDateDeadLine = doc.dueDateDeadLine.map((x) => JSON.parse(x)).map((x) => ({date: new Date(x.date * 1000)}));
                            }

                            commit('mutateTypesenseTasks', {found: resCount, nextPage: {[indexKey]: (cursor || 0) + responseData?.length || 0}, pid: pid, sprintId: sprintId, data: {...doc}})
                        })
                        const last = responseData[responseData.length - 1];
                        commit('mutatePageFrontier', {pid, sprintId, key: indexKey, row: {index: last[indName] ?? null, createdAt: last.createdAt ?? null, _id: last._id}});
                    } else {
                        commit('mutateTypesenseTasks', {found: resCount, nextPage: {[indexKey]: (cursor || 0) + responseData?.length || 0}, pid: pid, sprintId: sprintId, data: null})
                    }

                    return {responseData};
                }
                return Promise.reject();
            });

            pagesInFlight.set(flight, page);
            page.then(resolve, reject).finally(() => pagesInFlight.delete(flight));

        } catch (error) {
            reject(error);
        }
    })
}

/* The server's count for every group of a sprint, and the totals of the columns named, in one request.
   Socket events can only adjust a count for a task the store holds; for any other change the List asks again. */
export const refreshGroupCounts = ({state, commit}, payload) => {
    const {pid, sprintId, items = [], showAllTasks, userId, totals = [], table = false} = payload;
    if(!items.length || (!table && !state.tasks?.[pid]?.sprints?.includes(sprintId))) return Promise.resolve();

    return apiRequest('post',`${env.TASK}/find`,{findQuery: groupCountsQuery({ pid, sprintId, items, showAllTasks, userId, totals }), inList: sprintId})
    .then((resp) => {
        if(resp.status !== 200) return;
        commit(table ? 'mutateTableGroupCounts' : 'mutateGroupCounts', {
            pid, sprintId,
            found: readGroupCounts(items, resp.data?.[0]),
            totals: totals.length ? readGroupTotals(items, resp.data?.[0], totals) : null
        });
    });
}


export const tabSyncTaskCommit = ({state,commit},payload) => {
    try {
        const {response,payloadObjcet} = payload;
        const responseData = response?.data[0]?.result || [];
        const {pid, sprintId, item, parentId = ""} = payloadObjcet;
        let resCount = {};
        const projectFound = Object.keys(state.tasks).includes(pid);
        let sprintFound = false;
        const indexKey = `${parentId && parentId.length ? `${parentId}_` : ''}${item.searchKey}_${item.searchValue}`;
        let cursor = null;
        if(projectFound) {
            sprintFound = state.tasks[pid].sprints.includes(sprintId);
        }
        if(sprintFound) {
            cursor = state.tasks[pid][sprintId].index[indexKey] || null;
        }
        let foundKey = `${item.searchKey}_${item.searchValue}`;
        resCount = {[foundKey]: response.data[0]?.count?.[0]?.count || 0}
        // SET CURSOR
        if(responseData && responseData.length) {
            // BUG-017 / #71 fix: body is fully synchronous. Drop the unused
            // `async` keyword.
            responseData.forEach((task) => {
                const doc = task;

                if(doc.favouriteTasks && doc.favouriteTasks.length && typeof doc.favouriteTasks[0] === "string") {
                    doc.favouriteTasks = doc.favouriteTasks.map((x) => ({...x}))
                }
                if(doc.startDate && doc.startDate > 0) {
                    doc.startDate = new Date(doc.startDate * 1000);
                }

                if(doc.DueDate && doc.DueDate > 0) {
                    doc.DueDate = new Date(doc.DueDate * 1000);
                }

                commit('mutateTypesenseTasks', {found: resCount, nextPage: {[indexKey]: (cursor || 0) + responseData?.length || 0}, pid: pid, sprintId: sprintId, data: {...doc}})
            })
        } else {
            commit('mutateTypesenseTasks', {found: resCount, nextPage: {[indexKey]: (cursor || 0) + responseData?.length || 0}, pid: pid, sprintId: sprintId, data: null})
        }
    } catch (error) {
        console.error(error);
    }
}

export const setTableTasksFromTypesense = ({ state, commit, rootGetters }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const {pid, sprintId, item, fetchNew, parentId = "",sortKey = '',isFirst=false,resetTable=false} = payload;
            commit("setGetTableTaskPayload",{data:payload,op: 'add'});
            const projectFound = Object.keys(state.tableTasks).includes(pid);
            let sprintFound = false;
            if(projectFound) {
                sprintFound = state.tableTasks[pid].sprints.includes(sprintId);
            }

            if(sprintFound && (!fetchNew || resetTable === false)) {
                resolve();
                return;
            }
            let page = 0;
            let skip = 0;
            let batchSize = 35;

            const indexKey = `${parentId && parentId.length ? `${parentId}_` : ''}${item.searchKey}_${item.searchValue}`;
            if(sprintFound) {
                page = state.tableTasks[pid][sprintId].index[indexKey] || 1;
                skip = state.tableTasks[pid][sprintId].index[indexKey] ? state.tableTasks[pid][sprintId].index[indexKey] * 35 : 35;
            }
            if((sortKey && sortKey.length && isFirst) || (resetTable === true)){
                state.tableTasks = {};
                page = 0;
                skip = 0;
                batchSize = 35;
            }            
            let queryDetail = [
                {
                    $match: {
                        $and: [
                            {
                                $and:[
                                    {ProjectID:
                                        {
                                            objId: {
                                                $in : [pid]
                                            }
                                        } 
                                    },
                                    {sprintId: 
                                        {
                                            objId: {
                                                $eq:sprintId
                                            }
                                        }
                                    },
                                    {deletedStatusKey: { $in: [0] }},
                                    {isParentTask: true},
                                ]
                            },
                            {
                                ...( item.mongoConditions?.length ? 
                                    { ...item.mongoConditions[0] }
                                :
                                    item?.conditions?.length ?
                                        { ...item.conditions[0] }
                                    :
                                        {}
                                )
                            },
                            {
                                ...(payload?.showAllTasks !== undefined && !payload?.showAllTasks && {
                                    $and: [
                                        {AssigneeUserId: {$in : [payload.userId]}}
                                    ],
                                }),
                            },
                            {
                                ...(pid !== "6571e7195470e64b1203295c" ? {} : {AssigneeUserId: {$in: [payload.userId]}}),
                            }
                        ],
                    },
                },
                ...(sortKey ? tableSortStages(sortKey, rootGetters?.['settings/finalCustomFields'], { users: rootGetters?.['users/users'] }) : [{ $sort: item?.indexName ? { [item.indexName]: 1 } : { createdAt: 1 } }]),
                {
                    $skip: skip,
                },
                {
                    $limit: batchSize,
                },
            ]
            apiRequest('post',`${env.TASK}/find`,{findQuery: queryDetail, inList: sprintId})
            .then((result) => {
                if(result && result.status === 200 && result?.data && result?.data.length){
                    result?.data.forEach((task) => {
                        const doc = task;
                        if(doc.startDate && doc.startDate > 0) {
                            doc.startDate = (new Date(doc.startDate));
                        }
                        if(doc.DueDate && doc.DueDate > 0) {
                            doc.DueDate = (new Date(doc.DueDate));
                            doc.dueDateDeadLine = doc.dueDateDeadLine.map((x) => JSON.parse(x)).map((x) => ({date: (new Date(x.date))}));
                        }
                        commit('mutateTypesenseTableTasks', {nextPage: {[indexKey]: page+1}, pid, sprintId, data: {...doc}, total: result?.data.found})
                    })
                } else {
                    commit('mutateTypesenseTableTasks', {nextPage: {[indexKey]: page}, pid, sprintId, data: null})
                }
                resolve({result:result?.data, page});
            })
            .catch((error) => {
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

export const tabSyncTableCommit = ({state,commit},payload) => {
    try {
        const {response,payloadObjcet} = payload;
        const result = response?.data || [];
        const {pid, sprintId, item, parentId = ""} = payloadObjcet;
        const indexKey = `${parentId && parentId.length ? `${parentId}_` : ''}${item.searchKey}_${item.searchValue}`;
        const projectFound = Object.keys(state.tableTasks).includes(pid);
        let sprintFound = false;
        if(projectFound) {
            sprintFound = state.tableTasks[pid].sprints.includes(sprintId);
        }
        let page = 0;
        if(sprintFound) {
            page = state.tableTasks[pid][sprintId].index[indexKey] || 1;
        }
        if(result && result.length){
            result.forEach((task) => {
                const doc = task;
                if(doc.startDate && doc.startDate > 0) {
                    doc.startDate = (new Date(doc.startDate));
                }
                if(doc.DueDate && doc.DueDate > 0) {
                    doc.DueDate = (new Date(doc.DueDate));
                    doc.dueDateDeadLine = doc.dueDateDeadLine.map((x) => JSON.parse(x)).map((x) => ({date: (new Date(x.date))}));
                }
                commit('mutateTypesenseTableTasks', {nextPage: {[indexKey]: page+1}, pid, sprintId, data: {...doc}, total: result.found})
            })
        } else {
            commit('mutateTypesenseTableTasks', {nextPage: {[indexKey]: page}, pid, sprintId, data: null})
        }
    } catch (error) {
        console.error(error);
    }
}

let searcAbortController;
export const searchTask = ({commit}, payload) => {
    return new Promise((resolve, reject) => {
        try {
            if(searcAbortController) {
                searcAbortController.abort();
                searcAbortController = null;
            }
            searcAbortController = new AbortController();
            const signal = searcAbortController.signal;

            apiRequest('post',`${env.TASK}/find`,{findQuery: payload.query}, "JSON", {signal})
            .then((resp) => {
                if(resp.status === 200){
                    const results = resp.data;
                    // A match on the second or third level is shown under every row above it, so each of those is read too.
                    const requiredParents = results.filter((x) => !x.isParentTask).flatMap((x) => [...ancestorsOf(x), x.ParentTaskId]).filter(Boolean).map(String);
                    const availableParents = results.map((x) => String(x._id));
                    const parentIds = [...new Set(requiredParents)].filter((x) => !availableParents.includes(x));
                    if(parentIds?.length) {
                        let query = [
                            {
                                $match: {
                                    $and:[
                                        {
                                            _id: { objId: {$in: parentIds.map(id => id)} }
                                        },
                                        {deletedStatusKey: { $in: payload.showArchived === true ? [0,2] : [0] }}
                                    ]
                                }
                            }
                        ]
                        apiRequest('post',`${env.TASK}/find`,{findQuery: query})
                        .then((results2) => {
                            if(results2 && results2?.status === 200 && results2?.data){
                                resolve([...results, ...results2.data]);
                                commit("mutateSearchTask", {data: [...results, ...results2.data],op:"added"});
                            }else{
                                resolve([...results]);
                                commit("mutateSearchTask", {data: [...results],op:"added"});
                            }
                        })
                        .catch((error) => {
                            reject(error);
                        })
                    } else {
                        resolve(results);
                        commit("mutateSearchTask", {data: results,op:"added"});
                    }
                }
                else{
                    reject();
                }
            })
            .catch((error) => {
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

export const setprojectTemplate = ({ state, commit }) => {
    return new Promise((resolve, reject) => {
        try {
            state.projectTemplate = {};
            apiRequest("get", `${env.PROJECT_TEMPLATE}`).then((response) => {
                let result = [];
                if (response.data.status) {
                    const data = response.data.data;
                    data.forEach((change) => {
                        result.push({ op: 'add', data: { ...change, id: change._id } });
                    })
                }
                commit("mutateprojectTemplate", result);
                resolve()
            }).catch((error) => {
                reject(error);
                console.error("Error while getting project template", error);
            })
        }
        catch (error) {
            reject(error);
        }
    })
}

export const setSprints = ({commit }, payload) => {
    return new Promise((resolve,reject) => {
        try {
            apiRequest("get", `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${payload?.projectId}?collection=sprints`).then((resp) => {
                let res = resp?.data || [];
                let result = [];
                res.map(x => {
                    const obj = {op: "added", data: {...x}}
                    commit('mutateSprints', obj);
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

export const setFolders = ({ commit }, payload) => {
    return new Promise((resolve,reject) => {
        try {
            apiRequest("get", `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${payload?.projectId}?collection=folders`).then((resp) => {
                let res = resp?.data || [];
                let result = [];
                res.map(x => {
                    const obj = {op: "added", data: {...x}}
                    commit('mutateFolders', obj);
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

export const searchProjects = ({ commit }, payload) => {
    return new Promise((resolve, reject) => {
      try {
        if (payload.type !== 'projectName') {
            delete payload.projectList
            apiRequest("post", `${env.PROJECTSEARCH}`, payload).then((serachedData)=>{
                commit("mutateSearchedProjects", { data: serachedData?.data || [], searchType: payload.type });
                resolve({ data: serachedData?.data, searchType: payload.type } || []);
            }).catch((error)=>{
                reject(error)
            })
        } 
        else {
            let searchedProjects = payload.projectList.filter((x)=> x.ProjectName.toLowerCase().includes(payload.search.toLowerCase()))
            commit("mutateSearchedProjects", { data: searchedProjects || [], searchType: payload.type });
        }
      } catch (error) {
        reject(error);
      }
    });
  };



export const getTaskDetailSnapShot = ({  commit,rootState  }, payload)   => {
    commit("setTaskdetailPayloadId",payload);
    rootState.settings?.socketInstance?.emit('joinTaskDetail',{taskId: payload.taskId, socketId: rootState.settings.socketInstance.id});
    rootState.settings?.socketInstance?.on('taskDetail_taskUpdate',(data)=>{
        commit('setTaskDetailData',data);
    })
    rootState.settings?.socketInstance?.on('taskDetail_taskInsert',(data)=>{
        commit('setTaskDetailData',data);
    })
        rootState.settings?.socketInstance?.on('taskDetail_taskDelete',()=>{
        commit('setTaskDetailData',{});
    })
}

export const getAllTask = ({ commit }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const { projectIds, sprintIds, skip, parentId = "" } = payload;
            let queryObj = [
                {
                    $match:
                    {
                        ProjectID: { objId: { $in: projectIds.map((x) => x) } },
                        sprintId: { objId: { $in: sprintIds.map((x) => x) } },
                        deletedStatusKey: { $in: [0, undefined] },
                        ...(parentId && parentId.length ?
                            { ParentTaskId: parentId }
                            :
                            {
                                isParentTask: true,
                            }
                        ),
                    }
                },
                { $sort: { createdAt: -1, _id: 1 } },
                { $skip: skip },
                {
                    $limit: 15,
                }
            ]
            apiRequest('post', `${env.TASK}/find`, { findQuery: queryObj }).then((resp) => {
                let res = resp?.data || [];
                let result = [];
                res.map(x => {
                    const obj = { op: "added", data: { ...x }, projectIds: projectIds }
                    commit('mutateAllTask', obj);
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