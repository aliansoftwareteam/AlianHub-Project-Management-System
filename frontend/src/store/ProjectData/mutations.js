import Cookies from 'js-cookie';
import { useCustomComposable } from '@/composable/index.js';
const { checkPermission } = useCustomComposable();

export const mutateMongoUpdatedTask = (state, payload) => {
    state.mongoUpdatedTask = payload;
}

export const mutateProjects = (state, payload) => {
    if(!payload || !payload.length) return;

    const sortObject = (object = {}) => {
        let obj = {};
        Object.values(object).sort((a, b) => a?.createdAt?.seconds > b?.createdAt?.seconds ? -1 : 1).forEach((x) => {
            obj[x.id] = x;
        });

        return obj;
    }
    
    payload.forEach((x) => {
        const {snap, privateSnap, op, data, userId, roleType } = x;
        if(Object.keys(state.allProjects).length) {
            if(privateSnap && state.allProjects.privateSnap === null) {
                state.allProjects.privateSnap = snap;
            } else if(!privateSnap && state.allProjects.publicSnap === null) {
                state.allProjects.publicSnap = snap;
            }
        }

        if(op === "added") {
            if(!Object.keys(state.allProjects).length) {
                // NO PROJECTS FOUND
                state.allProjects = {
                    data: [data]
                }

                if(privateSnap) {
                    state.allProjects.privateSnap = snap;
                    state.allProjects.publicSnap = null;
                } else {
                    state.allProjects.privateSnap = null;
                    state.allProjects.publicSnap = snap;
                }
            } else {
                data.sprintsObj = sortObject(data.sprintsObj);

                if(data.sprintsfolders && Object.keys(data.sprintsfolders).length) {
                    Object.keys(data.sprintsfolders).forEach((key) => {
                        data.sprintsfolders[key].sprintsObj = sortObject(data.sprintsfolders[key]?.sprintsObj);
                    })
                }

                const index = state.allProjects?.data?.findIndex((x) => x._id === data._id);
                if(index !== -1) {
                    state.allProjects.data[index]= {...state.allProjects.data[index], ...data};
                } else {
                    state.allProjects.data.push(data);
                }
            }
        } else if(op === "modified") {
            const index = state.allProjects.data.findIndex((x) => x._id === data._id);
            if(index !== -1) {
                if (!data.sprintsfolders) {
                    data.sprintsfolders = {};
                }
                if(([1, 2].includes(roleType)) || checkPermission('project.private_projects') === 2) {
                    data.sprintsObj = sortObject({...state.allProjects.data[index].sprintsObj, ...data.sprintsObj});
                    let object = {...state.allProjects.data[index].sprintsfolders, ...data.sprintsfolders};
                    if(object && Object.keys(object || {}).length) {
                        Object.keys(object || {}).forEach((key) => {
                            if (!data.sprintsfolders[key]) {
                                data.sprintsfolders[key] = {};
                            }
                            data.sprintsfolders[key] = {...object[key], sprintsObj : sortObject(object[key]?.sprintsObj)};
                        })
                    }
                    state.allProjects.data[index] = data;
                } else {
                    if((data.isPrivateSpace && !data.AssigneeUserId.includes(userId))) {
                        state.allProjects.data.splice(index, 1);
                    } else {
                        data.sprintsObj = sortObject({...state.allProjects.data[index].sprintsObj, ...data.sprintsObj});
                        let object = {...state.allProjects.data[index].sprintsfolders, ...data.sprintsfolders};
                        if(object && Object.keys(object || {}).length) {
                            Object.keys(object || {}).forEach((key) => {
                                if (!data.sprintsfolders[key]) {
                                    data.sprintsfolders[key] = {};
                                }
                                data.sprintsfolders[key] = {...object[key], sprintsObj : sortObject(object[key]?.sprintsObj)};
                            })
                        }
                        state.allProjects.data[index] = data;
                    }
                }
            } else {
                data.sprintsObj = sortObject({...state.allProjects.data[index].sprintsObj, ...data.sprintsObj});

                let object = {...state.allProjects.data[index].sprintsfolders, ...data.sprintsfolders};
                if(object && Object.keys(object || {}).length) {
                    Object.keys(object || {}).forEach((key) => {
                        if (!data.sprintsfolders[key]) {
                            data.sprintsfolders[key] = {};
                        }
                        data.sprintsfolders[key] = {...object[key], sprintsObj : sortObject(object[key]?.sprintsObj)};
                    })
                }
                state.allProjects.data.push(data);
            }
        } else if(op === "removed") {
            const index = state.allProjects.data.findIndex((x) => x._id === data._id);
            if(index !== -1) {
                state.allProjects.data.splice(index, 1);
            }
        }
    })
}

export const mutateCurrentProjectTasks = (state, payload) => {
    if(JSON.stringify(state.currentProjectTasks) !== JSON.stringify(payload)) {
        state.currentProjectTasks = payload;
    }
}

export const mutateCurrentProjectDetails = (state, payload) => {
    if(JSON.stringify(state.currentProjectDetails) !== JSON.stringify(payload)) {
        state.currentProjectDetails = payload;
    }
}

export const mutateTaskItems = (state, payload) => {
    state.items = payload;
}

function returnItemCountDetails(tasks, groupBy, updatedFields = null, taskId) {
    const obj = {};

    let removeCountValue;
    const today = new Date().setHours(0, 0, 0, 0)/1000;
    let over;
    let next;
    switch(groupBy.type) {
        case 0:
            removeCountValue = tasks?.find((x) => x._id === taskId)?.statusKey
            if(updatedFields?.statusKey) {
                obj.addKey = groupBy.items?.find((x) => x.value === updatedFields.statusKey)?.key
                obj.removeKey = groupBy.items?.find((x) => x.value === removeCountValue)?.key
            }
            break;
        case 1:
            break;
        case 2:
            removeCountValue = tasks?.find((x) => x._id === taskId)?.Task_Priority
            if(updatedFields?.Task_Priority) {
                obj.addKey = groupBy.items?.find((x) => x.value === updatedFields.Task_Priority)?.key
                obj.removeKey = groupBy.items?.find((x) => x.value === removeCountValue)?.key
            }
            break;
        case 3:
            removeCountValue = tasks?.find((x) => x._id === taskId)?.DueDate;
            over = groupBy.items.find((x) => x.name === "Overdue")?.value
            next = groupBy.items.find((x) => x.name === "Next")?.value

            if(updatedFields?.DueDate !== undefined) {
                if(updatedFields.DueDate === null) {
                    obj.addKey = groupBy.items?.find((x) => x.value === "DueDate_0")?.key
                } else {
                    if(today > (new Date(updatedFields.DueDate).setHours(0,0,0,0) / 1000)) {
                        obj.addKey = groupBy.items?.find((x) => x.value === (over))?.key
                    } else if(next <= (new Date(updatedFields.DueDate).setHours(0,0,0,0) / 1000)) {
                        obj.addKey = groupBy.items?.find((x) => x.value === (next))?.key
                    } else {
                        obj.addKey = groupBy.items?.find((x) => x.value === (new Date(updatedFields.DueDate).setHours(0,0,0,0) / 1000))?.key
                    }
                }

                // HANDLE REMOVE KEY
                if(removeCountValue === null) {
                    obj.removeKey = groupBy.items?.find((x) => x.value === "DueDate_0")?.key
                } else {
                    if(today > (new Date(removeCountValue).setHours(0,0,0,0) / 1000)) {
                        obj.removeKey = groupBy.items?.find((x) => x.value === (over))?.key
                    } else if(next <= (new Date(removeCountValue).setHours(0,0,0,0) / 1000)) {
                        obj.removeKey = groupBy.items?.find((x) => x.value === (next))?.key
                    } else {
                        obj.removeKey = groupBy.items?.find((x) => x.value === (new Date(removeCountValue).setHours(0,0,0,0) / 1000))?.key
                    }
                }
            }
            break;
    }

    return obj;
}

// HANDLE TASK
export const mutateUpdateFirebaseTasks = (state, payload) => {
    const {pid, sprintId, op, data, snap, updatedFields,dragDropcheck, groupBy: payloadGroupBy} = payload;

    const projectFound = Object.keys(state.tasks).includes(pid);

    if(projectFound) {
        const {groupBy} = state.tasks[pid];
        const sprintFound = state.tasks[pid].sprints.includes(sprintId);
        if(sprintFound) {
            if(groupBy) {
                if(["modified", "added"]?.includes(op) && data.isParentTask) {
                    const {addKey, removeKey} = returnItemCountDetails(state.tasks[pid][sprintId].tasks, groupBy, updatedFields, data._id);
                    if(addKey) {
                        if(state.tasks[pid][sprintId].found[addKey]) {
                            state.tasks[pid][sprintId].found[addKey] += 1
                        } else {
                            state.tasks[pid][sprintId].found[addKey] = 1
                        }
                    }
                    if(removeKey) {
                        if(state.tasks[pid][sprintId].found[removeKey]) {
                            state.tasks[pid][sprintId].found[removeKey] -= 1
                        } else {
                            state.tasks[pid][sprintId].found[removeKey] = 0
                        }
                    }
                } else if(["removed"]?.includes(op)) {
                    const {removeKey} = returnItemCountDetails(state.tasks[pid][sprintId].tasks, groupBy, null, data._id);

                    if(removeKey) {
                        if(state.tasks[pid][sprintId].found[removeKey]) {
                            state.tasks[pid][sprintId].found[removeKey] -= 1
                        } else {
                            state.tasks[pid][sprintId].found[removeKey] = 0
                        }
                    }
                }
            }
            if(op === "inital") {
                if(!state.tasks[pid][sprintId].snapshot) {
                    state.tasks[pid][sprintId].snapshot = snap
                }
                state.tasks[pid].groupBy = payloadGroupBy;
            } else if(op === "added") {
                if(data.isParentTask === false) {
                    const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data.ParentTaskId);
                    if(taskIndex !== -1) {
                        if(state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray && state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.length) {
                            const subTaskIndex = state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.findIndex((x) => x._id === data._id);
                            if(subTaskIndex === -1) {
                                state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.push(data);
                            } else {
                                state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray[subTaskIndex] = {...state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray[subTaskIndex], ...data};
                            }
                        } else {
                            state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray= [data];
                        }
                    }
                } else {
                    const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data._id);

                    if(taskIndex === -1) {
                        // state.tasks[pid][sprintId].found[``] += 1;
                        state.tasks[pid][sprintId].tasks = [...state.tasks[pid][sprintId].tasks, data];
                    } else {
                        state.tasks[pid][sprintId].tasks[taskIndex] = {...state.tasks[pid][sprintId].tasks[taskIndex], ...data};
                    }
                }
            } else if(op === "modified") {
                if(data.isParentTask === false) {
                    const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data.ParentTaskId);
                    if(taskIndex !== -1 && state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray) {
                        const subTaskIndex = state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.findIndex((x) => x._id === data._id);
                        if(subTaskIndex !== -1){
                            state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray[subTaskIndex] = {...state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray[subTaskIndex], ...data};
                        }else{
                            if(state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray && state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.length){
                                state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.push(data);
                            }else{
                                state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray = [data];
                            }
                        }
                        // state.tasks[pid][sprintId].tasks[taskIndex].subTasks = state?.tasks?.[pid]?.[sprintId]?.tasks[taskIndex]?.subtaskArray?.length || 0;
                    }
                    else if(dragDropcheck === true && state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray === undefined && data.ParentTaskId){
                        state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray = [data];
                    }
                } else {
                    const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data._id);
                    
                    if (data.islocalSnapStop && data.islocalSnapStop === true) {     
                        if (data.updateToken?.user !== Cookies.get('accessToken')) {     
                            if(taskIndex !== -1) {
                                state.tasks[pid][sprintId].tasks[taskIndex] = {...state.tasks[pid][sprintId].tasks[taskIndex], ...data};
                            }else{
                                state.tasks[pid][sprintId].tasks.push(data);
                            }
                        } else {
                            const temp = state.tasks[pid][sprintId].tasks?.[taskIndex]
                            if (temp?.updateTimeStamp <= updatedFields.updateToken?.timeStamp) {
                                let indexes = ['groupByDueDateIndex','groupByPriorityIndex','groupByAssigneeIndex','groupByStatusIndex']
                                let updatedIndex = Object.keys(updatedFields).find((x) => indexes.includes(x))
                                if (updatedIndex) {
                                    state.tasks[pid][sprintId].tasks[taskIndex][updatedIndex] = data[updatedIndex]
                                }
                            } else {
                                if(taskIndex !== -1) {
                                    state.tasks[pid][sprintId].tasks[taskIndex] = {...state.tasks[pid][sprintId].tasks[taskIndex], ...data};
                                }else{
                                    state.tasks[pid][sprintId].tasks.push(data);
                                }
                            }
                        }
                    } else {
                        if(taskIndex !== -1) {
                            state.tasks[pid][sprintId].tasks[taskIndex] = {...state.tasks[pid][sprintId].tasks[taskIndex], ...data};
                        }else{
                            state.tasks[pid][sprintId].tasks.push(data);
                        }
                    }
                }
            } else if(op === "removed") {
                if(data.isParentTask === false) {
                    const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data.ParentTaskId);
                    if(taskIndex !== -1 && state?.tasks?.[pid]?.[sprintId]?.tasks?.[taskIndex]?.subtaskArray) {                        
                        const subTaskIndex = state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.findIndex((x) => x._id === data._id);
                        state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.splice(subTaskIndex, 1);
                        state.tasks[pid][sprintId].tasks[taskIndex].subTasks = state?.tasks?.[pid]?.[sprintId]?.tasks[taskIndex]?.subtaskArray?.length || 0;
                    }
                } else {
                    const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data._id);
                    if(taskIndex !== -1) {
                        state.tasks[pid][sprintId].tasks.splice(taskIndex, 1);
                    }
                }
            }
            if(data !== null && data.sprintId !== sprintId && updatedFields?.sprintId){
                const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data._id);
                if(taskIndex !== -1) {
                    state.tasks[pid][sprintId].tasks.splice(taskIndex, 1);
                }
            }
            if(data !== null && data.sprintId === sprintId && (updatedFields?.isParentTask === true || updatedFields?.isParentTask === false || updatedFields?.subTasks)){
                if(data.isParentTask === false) {
                    const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data._id);
                    if(taskIndex !== -1) {
                        state.tasks[pid][sprintId].tasks.splice(taskIndex,1);
                    }
                }else{
                    const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data._id);
                    if(taskIndex === -1){
                        state.tasks[pid][sprintId].tasks.push(data)
                    }
                }
            }
        }
    }
}

export const mutateUpdateFirebaseTableTasks = (state, payload) => {
    const {pid, sprintId, op, data} = payload;
    const projectFound = Object.keys(state.tableTasks).includes(pid);

    if(projectFound) {
        const sprintFound = state.tableTasks[pid].sprints.includes(sprintId);
        if(sprintFound) {
            if(op === "added") {
                if(data.isParentTask === false) {
                    const taskIndex = state.tableTasks[pid][sprintId].tasks.findIndex((x) => x.id === data.ParentTaskId);
                    if(taskIndex !== -1) {
                        if(state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray && state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray.length) {
                            const subTaskIndex = state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray.findIndex((x) => x.id === data.id);
                            if(subTaskIndex === -1) {
                                state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray.push(data);
                            } else {
                                state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray[subTaskIndex] = {...state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray[subTaskIndex], ...data};
                            }
                        } else {
                            state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray= [data];
                        }
                    }
                } else {
                    const taskIndex = state.tableTasks[pid][sprintId].tasks.findIndex((x) => x.id === data.id);
                    if(taskIndex === -1) {
                        state.tableTasks[pid][sprintId].tasks.push(data);
                    } else {
                        state.tableTasks[pid][sprintId].tasks[taskIndex] = {...state.tableTasks[pid][sprintId].tasks[taskIndex], ...data};
                    }
                }
            } else if(op === "modified") {
                if(data.isParentTask === false) {
                    const taskIndex = state.tableTasks[pid][sprintId].tasks.findIndex((x) => x.id === data.ParentTaskId);
                    if(taskIndex !== -1) {
                        const subTaskIndex = state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray.findIndex((x) => x.id === data.id);
                        state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray[subTaskIndex] = {...state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray[subTaskIndex], ...data};
                    }
                } else {
                    const taskIndex = state.tableTasks[pid][sprintId].tasks.findIndex((x) => x.id === data.id);
                    if(taskIndex !== -1) {
                        state.tableTasks[pid][sprintId].tasks[taskIndex] = {...state.tableTasks[pid][sprintId].tasks[taskIndex], ...data};
                    }
                }

            } else if(op === "removed") {
                if(data.isParentTask === false) {
                    const taskIndex = state.tableTasks[pid][sprintId].tasks.findIndex((x) => x.id === data.ParentTaskId);
                    if(taskIndex !== -1) {
                        const subTaskIndex = state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray.findIndex((x) => x.id === data.id);
                        state.tableTasks[pid][sprintId].tasks[taskIndex].subtaskArray.splice(subTaskIndex, 1);
                    }
                } else {
                    const taskIndex = state.tableTasks[pid][sprintId].tasks.findIndex((x) => x.id === data.id);
                    if(taskIndex !== -1) {
                        state.tableTasks[pid][sprintId].tasks.splice(taskIndex, 1);
                    }
                }
            }
        }
    }
}

export const removeProjectTaskSnap = (state, payload) => {
    delete state.tasks[payload];
}

export const mutateTypesenseTasks = (state, payload) => {
    const {pid, sprintId, data, nextPage, found = 0} = payload;

    const keys = Object.keys(state.tasks);
    const projectFound = keys.includes(pid);

    if(projectFound) {
        const sprintFound = state.tasks[pid].sprints.includes(sprintId);

        if(sprintFound) {
            state.tasks[pid][sprintId].index = {
                ...state.tasks[pid][sprintId].index,
                ...nextPage
            };
            state.tasks[pid][sprintId].found = {
                ...state.tasks[pid][sprintId].found,
                ...found
            };
            if(!data) return;

            if(data.isParentTask === false) {

                const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data.ParentTaskId);

                if(taskIndex !== -1) {
                    if(state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray) {
                        const subTaskIndex = state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.findIndex((x) => x._id === data._id);

                        if(subTaskIndex !== -1) {
                            state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray[subTaskIndex] = {...data};
                        } else {
                            state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray.push(data);
                        }
                    } else {
                        state.tasks[pid][sprintId].tasks[taskIndex].subtaskArray = [data];
                    }
                }
            } else {
                const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data._id);

                if(taskIndex !== -1) {
                    state.tasks[pid][sprintId].tasks[taskIndex] = {...state.tasks[pid][sprintId].tasks[taskIndex], ...data};
                } else {
                    state.tasks[pid][sprintId].tasks.push(data);
                }
            }
        } else {

            state.tasks[pid].sprints.push(sprintId);
            state.tasks[pid][sprintId]={
                index: {
                    ...nextPage
                },
                found: {
                    ...found
                },
                tasks: [],
                snapshot: null
            };
            if(data) {
                state.tasks[pid][sprintId].tasks = [data];
            }
        }
    } else {

        state.tasks[pid] = {
            projectId: pid,
            [sprintId]: {
                index: {
                    ...nextPage
                },
                found: {
                    ...found
                },
                tasks: [],
                snapshot: null
            },
            sprints: [sprintId]
        };
        if(data) {
            state.tasks[pid][sprintId].tasks = [data];
        }
    }
}


export const projectLocalUpdate = (state,payload) => {
    
    const {itemData,key,subKey='',userId='',projectId=''} = payload;
    if (key == 'ProjectName') {
        let index = state.allProjects.data.findIndex((x)=> x._id === itemData._id);
        if (index!== -1) {
            state.allProjects.data[index][key] = itemData[key];
        }
    } else if (key == 'RemoveProject') {
        let index = state.allProjects.data.findIndex((x)=> x._id === itemData._id);
        if (index!== -1) {
            state.allProjects.data[index] = itemData;
        }
        let index1 = state.searchedProjects.findIndex((x)=> x._id === itemData._id);
        if (index1 !== -1) {
            state.searchedProjects.splice(index1,1);
        }
    } else if (key == 'MarkAsFavourite') {
        let index = state.allProjects.data.findIndex((x)=> x._id === itemData._id);
        if (index!== -1) {
            if (subKey == 'add') {
                if (state.allProjects.data[index].favouriteTasks) {
                    state.allProjects.data[index].favouriteTasks.push({userId: userId});
                } else {
                    state.allProjects.data[index].favouriteTasks = [{userId: userId}];
                }
            } else {
                let ind = state.allProjects.data[index].favouriteTasks.findIndex((x)=> x.userId === userId);
                if (ind !== -1) {
                    state.allProjects.data[index].favouriteTasks.splice(ind,1);    
                }
            }
        }
    } else if (key === 'ProjectIcon') {
        let index = state.allProjects.data.findIndex((x)=> x._id === projectId);
        if (index!== -1) {
            state.allProjects.data[index].projectIcon = itemData;
        }
    } else if (key === 'AssigneeChange') {
        let index = state.allProjects.data.findIndex((x)=> x._id === projectId);
        if (index!== -1) {
            if (subKey == 'add') {
                state.allProjects.data[index].AssigneeUserId.push(userId);
            } else {
                let ind = state.allProjects.data[index].AssigneeUserId.findIndex((x)=> x === userId);
                if (ind !== -1) {
                    state.allProjects.data[index].AssigneeUserId.splice(ind,1);    
                }
                if (state.allProjects.data[index].LeadUserId.includes(userId)) {
                    let inde = state.allProjects.data[index].LeadUserId.findIndex((x)=> x === userId);
                    if (inde !== -1) {
                        state.allProjects.data[index].LeadUserId.splice(inde,1);    
                    }
                }
            }
        }
    } else if (key === 'ProjectWatcher') {
        let index = state.allProjects.data.findIndex((x)=> x._id === projectId);
        if (index!== -1) {
            if (subKey === '$set') {
                
                state.allProjects.data[index].watchers[userId] = itemData.watchType;
            } else {
                delete state.allProjects.data[index].watchers[userId];
            }
        }
    } else if (key === 'ProjectView') {
        let index = state.allProjects.data.findIndex((x)=> x._id === projectId);
        if (index!== -1) {
            if (subKey === 'add') {
                state.allProjects.data[index].ProjectRequiredComponent.push(itemData);
            } else if (subKey === 'edit') {
                let ind = state.allProjects.data[index].ProjectRequiredComponent.findIndex((x)=> x._id === itemData.elementId)
                if (ind !== -1) {
                    state.allProjects.data[index].ProjectRequiredComponent[ind][itemData.field] = itemData.updateValue
                }
            } else if (subKey === 'delete') {
                let ind = state.allProjects.data[index].ProjectRequiredComponent.findIndex((x)=> x._id === itemData._id)
                if (ind !== -1) {
                    state.allProjects.data[index].ProjectRequiredComponent.splice(ind,1);
                }
            }
        }
    } else if (key === 'LeadUserChange') {
        let index = state.allProjects.data.findIndex((x)=> x._id === projectId);
        if (index!== -1) {
            if (subKey == 'add') {
                state.allProjects.data[index].AssigneeUserId.push(userId);
                state.allProjects.data[index].LeadUserId.push(userId);
            } else {
                let ind = state.allProjects.data[index].AssigneeUserId.findIndex((x)=> x === userId);
                if (ind !== -1) {
                    state.allProjects.data[index].AssigneeUserId.splice(ind,1);    
                }
                if (state.allProjects.data[index].LeadUserId.includes(userId)) {
                    let inde = state.allProjects.data[index].LeadUserId.findIndex((x)=> x === userId);
                    if (inde !== -1) {
                        state.allProjects.data[index].LeadUserId.splice(inde,1);    
                    }
                }
            }
        }
    } else if (key === 'ProjectTypeChange') {
        let index = state.allProjects.data.findIndex((x)=> x._id === projectId);
        if (index!== -1) {
            state.allProjects.data[index] = itemData;
        }
    } else if (key === 'ProjectAppChange' || key === 'ProjectTabChange') {
        let index = state.allProjects.data.findIndex((x)=> x._id === projectId);
        if (index!== -1) {
            if (key === 'ProjectAppChange') {
                state.allProjects.data[index].apps = itemData;
            } else {
                state.allProjects.data[index].ProjectRequiredComponent = itemData;  
            }
        }
    } else {
        let index = state.allProjects.data.findIndex((x)=> x._id === itemData._id);
        if (index!== -1) {
            state.allProjects.data[index] = itemData;
        }
    }
}

export const emptyTableTasks = (state, payload) => {
    state.tableTasks = payload
}

export const mutateTypesenseTableTasks = (state, payload) => {
    const {pid, sprintId, data, nextPage, total = 0 } = payload;
    const keys = Object.keys(state.tableTasks);
    const projectFound = keys.includes(pid);
    if(projectFound) {
        const sprintFound = state.tableTasks[pid].sprints.includes(sprintId);
        if(sprintFound) {
            if(!data) return;
                const taskIndex = state.tableTasks[pid][sprintId].tasks.findIndex((x) => x._id === data._id);
                if(taskIndex !== -1) {
                    state.tableTasks[pid][sprintId].tasks[taskIndex] = data;
                } else {
                    state.tableTasks[pid][sprintId].tasks.push(data);
                }
            state.tableTasks[pid][sprintId].index = {
                ...state.tableTasks[pid][sprintId].index,
                ...nextPage
            };
        } else {
            state.tableTasks[pid].sprints.push(sprintId);
            state.tableTasks[pid][sprintId]={
                index: {
                    ...nextPage
                },
                tasks: [],
                total,
                snapshot: null
            };
            if(data) {
                state.tableTasks[pid][sprintId].tasks = [data];
            }
        }
    } else {
        state.tableTasks[pid] = {
            projectId: pid,
            [sprintId]: {
                index: {
                    ...nextPage
                },
                tasks: [],
                total,
                snapshot: null
            },
            sprints: [sprintId]
        };
        if(data) {
            state.tableTasks[pid][sprintId].tasks = [data];
        }
    }
}

export const mutateSearchTask = (state, payload) => {
    let mapTasks = [];
    payload.data.sort((a, b) => a.isParentTask > b.isParentTask ? -1 : 1);

    if(payload.op === "added"){
        payload.data.forEach((task) => {
            if(task.isParentTask) {
                const index = mapTasks.findIndex((x) => x._id === task._id)
    
                if(index !== -1) {
                    mapTasks[index] = {...mapTasks[index], ...task};
                } else {
                    mapTasks.push({...task, subtaskArray: []})
                }
            } else {
                const index = mapTasks.findIndex((x) => x._id === task.ParentTaskId)
    
                if(index !== -1) {
                    mapTasks[index].subtaskArray.push(task);
                }
            }
        })
        state.searchedTasks = mapTasks;
    }else{
        let index = state.searchedTasks.findIndex((x) => x._id === payload.data[0]._id);
        if(index !== -1){
            state.searchedTasks[index] = payload.data[0];
        }
    }
}

export const mutateTaskIndex = (state,payload) => {
    const {pid, sprintId, tasksArray , indexName} = payload;
    tasksArray.forEach((data)=>{
        const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === data._id);
        if (taskIndex!== -1) {
            state.tasks[pid][sprintId].tasks[taskIndex][indexName] = 99999999999999
        }
    })
}

export const mutateTaskForDragAndDrop = (state,payload) => {
    const {pid, sprintId, task} = payload;
    const taskIndex = state.tasks[pid][sprintId].tasks.findIndex((x) => x._id === task._id);
    if (taskIndex!== -1) {
        state.tasks[pid][sprintId].tasks[taskIndex] = task
    }
}

export const mutateprojectTemplate = (state, payload) => {
    if(!payload || !payload.length){
        state.projectTemplate = {};
        return;
    }
    payload.forEach((x) => {
        const {op,data} = x;
        if(op == 'add') {
            if(!Object.keys(state.projectTemplate).length) {
                state.projectTemplate = {
                    data: [data]
                }
            } else {
                const index = state.projectTemplate.data.findIndex((x) => x._id === data._id);
                if(index !== -1) {
                    state.projectTemplate.data[index] = data;
                } else {
                    state.projectTemplate.data.unshift(data);
                }
            }
        } else if (op == 'del') {
            const index = state.projectTemplate.data.findIndex((x) => x.id === data.id);
            if(index !== -1) {
                if(state.projectTemplate.data.length == 1) {
                    state.projectTemplate = {};
                } else {
                    state.projectTemplate.data.splice(index,1);
                }
            }
        }
    })
}
export const mutatedefaultTemplate = (state,payload) =>{
    state.defaultTemplate = payload;
}


export const mutateSprints = (state,payload) => {
    const {op, data} = payload;
    let pId = data?.projectId;
    if(op === "added"){
        let projecIdFound = Object.keys(state.sprints).includes(pId);
        if(projecIdFound){
            const sprintIndex = state.sprints[pId].findIndex((x) => x._id === data._id);
            if(sprintIndex === -1){
                state.sprints[pId].push(data);
            }
        }else{
            state.sprints = {[pId]:[data]}
        }
    }else if(op === "modified"){
        const sprintIndex = state.sprints[pId] && state.sprints[pId].length > 0 && state.sprints[pId]?.findIndex((x) => x._id === data._id);
        if(sprintIndex !== undefined && sprintIndex !== -1) {
            state.sprints[pId][sprintIndex] = {...data};
        }
    }else if(op === "removed"){
        if(state.sprints[pId]){
            const sprintIndex = state.sprints && state.sprints[pId] && state.sprints[pId].length > 0 && state.sprints[pId]?.findIndex((x) => x._id === data.id);
            if(sprintIndex !== -1) {
                state.sprints[pId].splice(sprintIndex, 1);
            }
        }
    }
}

// RELOCATE A SPRINT BETWEEN BUCKETS (root <-> folder) ON THE LIVE PROJECT OBJECT
// payload: { data: <updated sprint from PATCH response>, oldFolderId: <folderId before the move|null> }
// Re-groups the sprint in state.allProjects.data[index] so both the project list (Projects.vue grouping)
// and the sidebar (Item.vue setSprints/setFolders) reflect the move without a refresh.
export const relocateSprint = (state, payload) => {
    const { data, oldFolderId } = payload || {};
    if(!data) return;

    const pId = data?.projectId;
    const projects = state.allProjects && state.allProjects.data;
    if(!pId || !projects || !projects.length) return;

    const index = projects.findIndex((x) => x._id === pId);
    if(index === -1) return;

    const sortObject = (object = {}) => {
        let obj = {};
        Object.values(object || {}).sort((a, b) => a?.createdAt?.seconds > b?.createdAt?.seconds ? -1 : 1).forEach((x) => {
            obj[x.id] = x;
        });
        return obj;
    };

    const project = projects[index];
    const sprintId = data.id || data._id;
    const newFolderId = data.folderId || null;

    // BUILD THE SPRINT AS THE LISTS EXPECT IT (id mirrors _id, carries folderName for the legend)
    const movedSprint = { ...data, id: sprintId, folderId: newFolderId, folderName: newFolderId ? (data.folderName || '') : '' };

    // OMIT A KEY FROM A BUCKET OBJECT WITHOUT MUTATING THE ORIGINAL
    const omitKey = (object = {}, key) => {
        const next = {};
        Object.keys(object || {}).forEach((k) => {
            if(k !== key) {
                next[k] = object[k];
            }
        });
        return next;
    };

    // 1) REMOVE FROM THE CURRENT BUCKET (root or old folder)
    if(oldFolderId) {
        const oldFolder = project.sprintsfolders && project.sprintsfolders[oldFolderId];
        if(oldFolder && oldFolder.sprintsObj && oldFolder.sprintsObj[sprintId]) {
            project.sprintsfolders[oldFolderId] = { ...oldFolder, sprintsObj: omitKey(oldFolder.sprintsObj, sprintId) };
        }
    } else if(project.sprintsObj && project.sprintsObj[sprintId]) {
        project.sprintsObj = omitKey(project.sprintsObj, sprintId);
    }

    // 2) INSERT INTO THE NEW BUCKET (target folder or root)
    if(newFolderId) {
        if(!project.sprintsfolders) {
            project.sprintsfolders = {};
        }
        const targetFolder = project.sprintsfolders[newFolderId] || {};
        project.sprintsfolders[newFolderId] = {
            ...targetFolder,
            sprintsObj: sortObject({ ...(targetFolder.sprintsObj || {}), [sprintId]: movedSprint }),
        };
    } else {
        project.sprintsObj = sortObject({ ...(project.sprintsObj || {}), [sprintId]: movedSprint });
    }

    // RE-ASSIGN THE PROJECT REFERENCE SO DOWNSTREAM WATCHERS (projectData / Item.vue) PICK UP THE CHANGE
    state.allProjects.data[index] = { ...project };

    // CASCADE THE MOVE ONTO ANY ALREADY-LOADED TASKS OF THIS SPRINT (mirrors the server-side cascade in
    // Modules/Sprints/controller.js updateSprintFun). A task carries its folder as `folderObjId` (+
    // `sprintArray.folderId`/`folderName`); breadcrumb + every "open task" route builds `fs/:folderId` from it.
    // Patching the in-memory copies means task-detail / kanban / board navigation uses the right folder
    // immediately after the move, without waiting for a re-fetch.
    const applyFolderToTask = (taskObj) => {
        if(!taskObj) return;
        if(newFolderId) {
            taskObj.folderObjId = newFolderId;
            taskObj.sprintArray = { ...(taskObj.sprintArray || {}), folderId: newFolderId, folderName: movedSprint.folderName || '' };
        } else {
            delete taskObj.folderObjId;
            if(taskObj.sprintArray) {
                const nextSprintArray = { ...taskObj.sprintArray };
                delete nextSprintArray.folderId;
                delete nextSprintArray.folderName;
                taskObj.sprintArray = nextSprintArray;
            }
        }
    };
    const cascadeFolderToTaskBucket = (bucket) => {
        const sprintBucket = bucket && bucket[pId] && bucket[pId][sprintId];
        if(!sprintBucket || !Array.isArray(sprintBucket.tasks)) return;
        sprintBucket.tasks.forEach((taskObj) => {
            applyFolderToTask(taskObj);
            if(Array.isArray(taskObj?.subtaskArray)) {
                taskObj.subtaskArray.forEach((subTask) => applyFolderToTask(subTask));
            }
        });
    };
    cascadeFolderToTaskBucket(state.tasks);
    cascadeFolderToTaskBucket(state.tableTasks);
}

export const mutateFolders = (state,payload) => {
    const {op, data} = payload;
    let pId = data?.projectId;
    if(op === "added"){
        let projecIdFound = Object.keys(state.folders).includes(pId)
        if(projecIdFound){
            const sprintIndex = state.folders[pId].findIndex((x) => x._id === data._id);
            if(sprintIndex === -1){
                state.folders[pId].push(data);
            }
        }else{
            state.folders = {[pId]:[data]}
        }
    }else if(op === "modified"){
        const sprintIndex = state.folders[pId] && state.folders[pId].length > 0 && state.folders[pId]?.findIndex((x) => x._id === data._id);
        if(sprintIndex !== undefined && sprintIndex !== -1) {
            state.folders[pId][sprintIndex] = {...data};
        }
    }else if(op === "removed"){
        const sprintIndex = state.folders[pId] && state.folders[pId].length > 0 && state.folders[pId]?.findIndex((x) => x._id === data._id);
        if(sprintIndex !== -1) {
            state.folders[pId].splice(sprintIndex, 1);
        }
    }
}
export const mutateSearchedProjects = (state,payload) => {
    let searchedProjects = [];
    let searchData = payload.data;
    
    if (payload.searchType !== 'projectName') {
        searchData.forEach((ele)=>{
            let indx = state.allProjects.data.findIndex((x)=>x._id === ele._id);
            if (indx !== -1) {
                if (payload.searchType === 'sprint' || payload.searchType === 'folder' || payload.searchType === 'projectFilter_sprint' || payload.searchType === 'projectFilter_folder') { 
                    let projectObj = {...state.allProjects.data[indx]};
                    const sprintsArray = ele.sprints.filter((x)=> !x.folderId).map((x)=> {return {...x,id: x._id}});
                    const foldersObject = ele.folders?.reduce((acc, folder) => {
                        if (folder.projectId === ele._id) {
                            let folId = folder._id
                            acc[folId] = {
                                folderId: folId,
                                name: folder.name,
                                sprintsObj: {},
                                deletedStatusKey: folder.deletedStatusKey,
                                legacyId : folder?.legacyId ? folder?.legacyId : '',
                                id: folder._id,
                                _id: folder._id,
                                isExpanded: true
                            };
                        }
                        return acc;
                    }, {});
        
                    ele.sprints?.forEach(sprint => {
                        if (sprint.projectId === ele._id && sprint.folderId && foldersObject[sprint.folderId]) {
                            sprint.folderName = foldersObject[sprint.folderId].name;
                            sprint.id = sprint._id;
                            foldersObject[sprint.folderId].sprintsObj[sprint.id] = sprint;
                        }
                    });
                    let sprintFolders = {
                        [ele._id]: {
                            folders: foldersObject,
                            sprints: sprintsArray,
                        }
                    };
                    let allSprints = sprintFolders !== undefined && sprintFolders && sprintFolders[ele._id] ? sprintFolders[ele._id]?.sprints : []
        
                    let allFolders = sprintFolders && sprintFolders[ele._id] ? sprintFolders[ele._id]?.folders : {}
                    
                    const sprintIdToObject = {};
                    allSprints.forEach(item => {sprintIdToObject[item._id] = item;});
                    projectObj.sprintsObj = sprintIdToObject;
                    projectObj.sprintsfolders = allFolders;
                    projectObj.sprintData = sprintFolders;
                    searchedProjects.push(projectObj);
                } else if (payload.searchType === 'projectName' || payload.searchType === 'projectFilter' || payload.searchType === 'projectFilter_projectName') {
                    let projectObj = {...state.allProjects.data[indx]};
                    searchedProjects.push(projectObj);
                }
            }
        })
        
        state.searchedProjects = searchedProjects;
    } else {
        state.searchedProjects = searchData;
    }
}

export const mutateExistingSearchedProjects = (state,payload) => {
    let index = state.searchedProjects.findIndex((x)=> x._id === payload._id);
    if (index !== -1) {
        state.searchedProjects[index] = payload;
    }
}

export const setTaskSnapShotPayload = (state, payload) =>{
    state.getTaskSnapShotPayload = payload;
}

export const setGetPaginatedTasksPayload = (state, payload) =>{
    if (payload.op == 'add') {
        state.getPaginatedTaskPayload.push(payload);
    } else if (payload.op == 'remove') {
        state.getPaginatedTaskPayload = state.getPaginatedTaskPayload.filter(ele => 
            !(ele.data.pid === payload.data.pid && ele.data.sprintId === payload.data.sprintId)
        );
    }
}

export const setGetTableTaskPayload = (state, payload) =>{
    if (payload.op == 'add') {
        state.getTableTaskPayload.push(payload);
    } else if (payload.op == 'remove') {
        state.getTableTaskPayload = state.getTableTaskPayload.filter(ele => 
            !(ele.data.pid === payload.data.pid && ele.data.sprintId === payload.data.sprintId)
        );
    }
}

export const setTaskDetailData = (state, payload) =>{
    state.taskDetailData = payload;
}

export const setTaskdetailPayloadId = (state, payload) =>{
    state.taskDetailPayloadId = payload;
}

export const mutateAllTask = (state,payload) => {
    const  { data , projectIds} = payload;

    if(data.isParentTask === false) {

        const taskIndex = state.allTaskData.findIndex((x) => x._id === data.ParentTaskId);
        if(taskIndex !== -1) {
            if(state.allTaskData[taskIndex].subtaskArray) {
                const subTaskIndex = state.allTaskData[taskIndex].subtaskArray.findIndex((x) => x._id === data._id);

                if(subTaskIndex !== -1) {
                    state.allTaskData[taskIndex].subtaskArray[subTaskIndex] = {...data};
                } else {
                    state.allTaskData[taskIndex].subtaskArray.push(data);
                }
            } else {
                state.allTaskData[taskIndex].subtaskArray = [data];
            }
        }
    } else {
        const taskIndex = state.allTaskData.findIndex((x) => x._id === data._id);

        if(taskIndex !== -1) {
            state.allTaskData[taskIndex] = {...state.allTaskData[taskIndex], ...data};
        } else {
            state.allTaskData.push(data);
        }
    }
    state.allTaskData = state.allTaskData.filter(task => projectIds.includes(task.ProjectID));
}