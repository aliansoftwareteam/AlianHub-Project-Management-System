import { isOwnTabUpdate, ownEditsInFlight } from '@/utils/taskUpdateMarker';
import { useCustomComposable } from '@/composable/index.js';
import { isOwnerOrAdmin } from "@/utils/roles";
import { locate, placeRow, removeRow, treeOf } from "./taskTree";
import { isStranger, leftList, otherHolders, shownInList, touchesOtherProjects } from "./listMembership";
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
            const index = (state.allProjects?.data || []).findIndex((x) => x._id === data._id);
            if(index !== -1) {
                if (!data.sprintsfolders) {
                    data.sprintsfolders = {};
                }
                if(isOwnerOrAdmin(roleType) || checkPermission('project.private_projects') === 2) {
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
            }
        } else if(op === "removed") {
            const index = (state.allProjects?.data || []).findIndex((x) => x._id === data._id);
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

const GROUP_FIELDS = { 0: ["statusKey"], 1: ["AssigneeUserId"], 2: ["Task_Priority"], 3: ["DueDate"] };
const MEMBERSHIP_FIELDS = ["deletedStatusKey", "sprintId", "isParentTask", "extraLists"];

/* Whether an event from the server can have changed how many tasks a group holds. The
   arithmetic below only knows the group a task left when the store holds that task, and it
   covers neither removals nor a team assignee or grouping by custom field, so the List asks the
   server for the counts after any of these. Local, optimistic writes are left out: the
   server may not have stored them yet. */
function changesGroupCounts(groupBy, op, data, updatedFields) {
    if(data?.isParentTask === false && !("isParentTask" in (updatedFields || {}))) return false;
    if(op === "removed" || op === "added") return true;
    if(op !== "modified") return false;
    const fields = Object.keys(updatedFields || {});
    if(!fields.length) return true;
    const grouping = GROUP_FIELDS[groupBy.type];
    return fields.some((field) => MEMBERSHIP_FIELDS.includes(field) || (grouping ? grouping.includes(field) : field.startsWith("customField")));
}

/* A value a group total adds was changed on the server. A group that is only partly loaded cannot add it up itself. */
function changesGroupTotals(op, data, updatedFields) {
    if(op !== "modified" || data?.isParentTask === false) return false;
    return Object.keys(updatedFields || {}).some((field) => field === "points" || field.startsWith("customField"));
}

/* The sort key of the last row a page brought for a group: where its next page starts. */
export const mutatePageFrontier = (state, payload) => {
    const {pid, sprintId, key, row} = payload;
    if(!state.tasks?.[pid]?.sprints?.includes(sprintId)) return;
    state.tasks[pid][sprintId].frontier = {...state.tasks[pid][sprintId].frontier, [key]: row};
}

export const mutateGroupCounts = (state, payload) => {
    const {pid, sprintId, found, totals} = payload;
    if(!state.tasks?.[pid]?.sprints?.includes(sprintId)) return;
    state.tasks[pid][sprintId].found = {...state.tasks[pid][sprintId].found, ...found};
    if(totals) state.tasks[pid][sprintId].totals = {...state.tasks[pid][sprintId].totals, ...totals};
}

export const mutateTableGroupCounts = (state, payload) => {
    const {pid, sprintId, found, totals} = payload;
    const held = state.tableGroupCounts[pid]?.[sprintId];
    state.tableGroupCounts = {
        ...state.tableGroupCounts,
        [pid]: {
            ...state.tableGroupCounts[pid],
            [sprintId]: {found: {...held?.found, ...found}, totals: totals ? {...held?.totals, ...totals} : held?.totals}
        }
    };
}

// HANDLE TASK
/* A reorder this tab made comes back from the server with its own marker. The row already
   holds the new place, so an echo that is not newer only confirms the index it carries. */
function keepsOwnReorder(bucket, data, updatedFields) {
    if(data.isParentTask === false || data.islocalSnapStop !== true || !isOwnTabUpdate(data.updateToken)) return false;
    const row = bucket.tasks.find((x) => x._id === data._id);
    if(!(row?.updateTimeStamp <= updatedFields?.updateToken?.timeStamp)) return false;
    const updatedIndex = Object.keys(updatedFields).find((x) => ['groupByDueDateIndex','groupByPriorityIndex','groupByAssigneeIndex','groupByStatusIndex'].includes(x));
    if(updatedIndex) {
        row[updatedIndex] = data[updatedIndex];
    }
    return true;
}

/* An event from the server while this tab's edit of the same task is unanswered: the fields
   that edit holds stay as the person left them, and are not counted as a move. */
function keepOwnEdits({data, updatedFields}) {
    const held = data ? ownEditsInFlight(data._id) : {};
    const fields = Object.keys(held);
    if(!fields.length) return {data, updatedFields};
    return {
        data: {...data, ...held},
        updatedFields: Object.fromEntries(Object.entries(updatedFields || {}).filter(([field]) => !fields.includes(field)))
    };
}

/* Grouped by assignee a task sits in the group of each person it names, or in Unassigned. A
   team is left to the server's count: it puts the task in the group of every member. */
function assigneeCountMoves(tasks, groupBy, updatedFields, taskId) {
    const next = updatedFields?.AssigneeUserId;
    const row = tasks?.find((x) => x._id === taskId);
    if(groupBy.type !== 1 || !row || !Array.isArray(next)) return [];
    const previous = row.AssigneeUserId || [];
    if([...previous, ...next].some((id) => String(id).startsWith("tId_"))) return [];
    const keyOf = (id) => groupBy.items?.find((x) => (id === null ? x.value === "[]" : Array.isArray(x.value) && x.value[0] === id))?.key;
    const groupsOf = (ids) => (ids.length ? ids : [null]);
    const before = groupsOf(previous);
    const after = groupsOf(next);
    return [
        ...after.filter((id) => !before.includes(id)).map((id) => [keyOf(id), 1]),
        ...before.filter((id) => !after.includes(id)).map((id) => [keyOf(id), -1])
    ].filter(([key]) => key);
}

function groupKeyOf(groupBy, row) {
    const field = GROUP_FIELDS[groupBy.type]?.[0];
    if(!field || groupBy.type === 1) return undefined;
    return returnItemCountDetails([], groupBy, {[field]: row[field]}, row._id).addKey;
}

function movesHome(updatedFields) {
    return "sprintId" in (updatedFields || {});
}

/* A task counts once, in the group of the list it lives in. A server event that changes its home
   list moves one from the group it left to the group it entered, in every list the store holds,
   whichever room the event came through. The same event can arrive through two rooms, so a list
   remembers the tasks it has counted in. */
function moveHomeCounts(state, payload) {
    const {pid, op, data, updatedFields, snap} = payload;
    const project = state.tasks?.[pid];
    if(!snap || op !== "modified" || !project?.groupBy || !data?._id || data.isParentTask === false || !movesHome(updatedFields)) return;
    const home = String(data.sprintId);
    project.sprints.forEach((sprintId) => {
        const bucket = project[sprintId];
        const row = locate(bucket, data._id)?.row;
        const wasHome = Boolean(row) && String(row.sprintId) === sprintId;
        const entered = bucket.homeEntries || {};
        if(sprintId !== home) {
            if(entered[data._id]) delete entered[data._id];
            if(!wasHome) return;
            const key = groupKeyOf(project.groupBy, row);
            if(key) bucket.found[key] = Math.max(0, (bucket.found[key] || 0) - 1);
        } else {
            if(wasHome || entered[data._id]) return;
            const key = groupKeyOf(project.groupBy, data);
            if(key) bucket.found[key] = (bucket.found[key] || 0) + 1;
            bucket.homeEntries = {...entered, [data._id]: true};
        }
        bucket.countsStale = (bucket.countsStale || 0) + 1;
    });
}

function applyTaskChange(state, payload, sprintId) {
    const {pid, op, snap, dragDropcheck, groupBy: payloadGroupBy} = payload;
    const {data, updatedFields} = snap && op === "modified" ? keepOwnEdits(payload) : payload;

    const projectFound = Object.keys(state.tasks).includes(pid);

    if(projectFound) {
        const {groupBy} = state.tasks[pid];
        const sprintFound = state.tasks[pid].sprints.includes(sprintId);
        if(sprintFound) {
            if(data && data._id && isStranger(state.tasks[pid][sprintId], data, pid, sprintId)) return;
            if(groupBy) {
                if(snap && changesGroupCounts(groupBy, op, data, payload.updatedFields)) {
                    state.tasks[pid][sprintId].countsStale = (state.tasks[pid][sprintId].countsStale || 0) + 1;
                }
                if(snap && changesGroupTotals(op, data, payload.updatedFields)) {
                    state.tasks[pid][sprintId].totalsStale = (state.tasks[pid][sprintId].totalsStale || 0) + 1;
                }
                if(["modified", "added"]?.includes(op) && data.isParentTask && !(op === "modified" && movesHome(updatedFields))) {
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
                    if(op === "modified") {
                        const found = state.tasks[pid][sprintId].found;
                        assigneeCountMoves(state.tasks[pid][sprintId].tasks, groupBy, updatedFields, data._id).forEach(([key, step]) => {
                            found[key] = Math.max(0, (found[key] || 0) + step);
                        });
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
            const bucket = state.tasks[pid][sprintId];
            if(op === "inital") {
                if(!bucket.snapshot) {
                    bucket.snapshot = snap
                }
                state.tasks[pid].groupBy = payloadGroupBy;
            } else if(op === "added") {
                placeRow(bucket, data);
            } else if(op === "modified") {
                if(!keepsOwnReorder(bucket, data, updatedFields)) {
                    const parent = placeRow(bucket, data);
                    if(parent && dragDropcheck === true) {
                        parent.subTasks = (Number(parent.subTasks) || 0) + 1;
                    }
                }
            } else if(op === "removed") {
                const parent = removeRow(bucket, data._id);
                if(parent) {
                    parent.subTasks = Math.max(0, (Number(parent.subTasks) || 0) - 1);
                }
            }
            if(data !== null && leftList(data, pid, sprintId, updatedFields)){
                removeRow(bucket, data._id);
            }
        }
    }
}

export const mutateUpdateFirebaseTasks = (state, payload) => {
    const {pid, sprintId, op, data} = payload;
    /* Rows of another project's tasks are not kept here: a list reads them on its own, and reads them again when this rises. */
    if(touchesOtherProjects(data, pid, op === "modified" ? payload.updatedFields : null)) state.otherProjectChanges = (state.otherProjectChanges || 0) + 1;
    moveHomeCounts(state, payload);
    applyTaskChange(state, payload, sprintId);
    if(!data?._id || !["modified", "removed"].includes(op)) return;
    otherHolders(state.tasks[pid], data, pid, sprintId).forEach((holder) => {
        if(holder.shown) applyTaskChange(state, payload, holder.sprintId);
        else removeRow(state.tasks[pid][holder.sprintId], data._id);
    });
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

            placeRow(state.tasks[pid][sprintId], data);
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
                placeRow(state.tasks[pid][sprintId], data);
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
            placeRow(state.tasks[pid][sprintId], data);
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
    const {pid, sprintId, data, nextPage, total = 0, op } = payload;
    const keys = Object.keys(state.tableTasks);
    const projectFound = keys.includes(pid);
    /* An event, unlike a page the Table asked for, can be about a task this list does not show (any more). */
    if(op && data && !shownInList(data, pid, sprintId)) {
        const held = projectFound ? state.tableTasks[pid][sprintId]?.tasks : null;
        const at = held ? held.findIndex((x) => x._id === data._id) : -1;
        if(at !== -1) held.splice(at, 1);
        return;
    }
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
    if(payload.op === "added"){
        state.searchedTasks = treeOf(payload.data);
        return;
    }
    const found = locate({ tasks: state.searchedTasks }, payload.data[0]._id);
    if(found){
        found.siblings[found.index] = payload.data[0];
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

export const replaceFolders = (state, { projectId, folders }) => {
    state.folders = { ...state.folders, [projectId]: folders };
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
                                parentFolderId: folder.parentFolderId || null,
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