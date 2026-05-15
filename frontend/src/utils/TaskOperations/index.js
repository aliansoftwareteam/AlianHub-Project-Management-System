import * as env from '@/config/env';
import { apiRequest } from "../../services";
import Store from '@/store/index'

class Task {
    create({ data, user, projectData ,indexObj = {}, groupBy}) {
        return new Promise((resolve,reject) => {
            try {
                apiRequest("post", env.V2_TASKS, {
                    data,
                    user: {
                        "Employee_Name": user.Employee_Name,
                        "id": user.id,
                        "companyOwnerId": user.companyOwnerId
                    },
                    projectData,
                    indexObj
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task created successfully", id: response.data.id});
                        Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "added", pid:data.ProjectID, sprintId: data.sprintId, data: {...data, _id: response.data.id}, updatedFields:{...data, _id: response.data.id}, groupBy})
                    }else if(response.data.isUpgrade) {
                        resolve(response.data);
                    } 
                    else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    console.error("error:", error);
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        });
    }

    /* -------------- UPDATE KANBAN INDEX FUNCTION FOR TASK -----------------*/

    updateIndex({ indexType, indexValue, project, taskId}) {
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", "/api/v2/tasks", {action: "updateIndex", indexType, indexValue, project, taskId})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task index updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- UPDATE DUE DATE FUNCTION FOR TASK -----------------*/

    updateDueDate({firebaseObj, project, task, obj,userData, commonDateFormatString,isUpdateTask}) {
        return new Promise((resolve,reject) => {
            try {
                const {sprintId,ProjectID} = task;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...task,...firebaseObj},updatedFields:{...firebaseObj}})
                apiRequest("patch", env.V2_TASKS, {
                    action: "updateDueDate",
                    commonDateFormatString,
                    firebaseObj,
                    project,
                    task,
                    obj,
                    userData: {
                        "Employee_Name": userData.Employee_Name,
                        "id": userData.id,
                        "companyOwnerId": userData.companyOwnerId
                    },
                    isUpdateTask
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task due date updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- UPDATE START DATE FUNCTION FOR TASK -----------------*/

    updateStartDate({firebaseObj, project, task, obj,userData, commonDateFormatString,isUpdateTask = true}) {
        return new Promise((resolve,reject) => {
            try {
                const {sprintId,ProjectID} = task;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...task,...firebaseObj},updatedFields:{...firebaseObj}});
                apiRequest("patch", env.V2_TASKS, {
                    action: "updateStartDate",
                    commonDateFormatString,
                    firebaseObj,
                    project,
                    task,
                    obj,
                    userData: {
                        "Employee_Name": userData.Employee_Name,
                        "id": userData.id,
                        "companyOwnerId": userData.companyOwnerId
                    },
                    isUpdateTask
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task due date updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- UPDATE STATUS FUNCTION FOR TASK -----------------*/

    updateStatus({ newStatus, prevStatus, projectData, task, userData , isUpdateTask = true}) {
        return new Promise((resolve,reject) => {
            try {
                const {sprintId,ProjectID} = task;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...task, ...newStatus},updatedFields:{...newStatus}});
                apiRequest("patch", env.V2_TASKS, {
                    action: "updateStatus",
                    newStatus,
                    prevStatus,
                    projectData,
                    task,
                    isUpdateTask,
                    userData: {
                        "Employee_Name": userData.Employee_Name,
                        "id": userData.id,
                        "companyOwnerId": userData.companyOwnerId
                    }
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task status updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- UPDATE PRIORITY FUNCTION FOR TASK -----------------*/

    updatePriority({ firebaseObj ,projectData ,taskData ,priorityObj, userData,isUpdateTask = true}) {
        return new Promise((resolve,reject) => {
            try {
                const {sprintId,ProjectID} = taskData;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...taskData, ...firebaseObj},updatedFields:{...firebaseObj}});
                apiRequest("patch", env.V2_TASKS, {
                    action: "updatePriority",
                    firebaseObj,
                    projectData,
                    taskData,
                    priorityObj,
                    isUpdateTask,
                    userData: {
                        "Employee_Name": userData.Employee_Name,
                        "id": userData.id,
                        "companyOwnerId": userData.companyOwnerId
                    }
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task priority updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- UPDATE TASK NAME FUNCTION -----------------*/

    updateTaskName({ firebaseObj,projectData ,taskData ,obj, userData}) {
        return new Promise((resolve,reject) => {
            try {
                const {sprintId,ProjectID} = taskData;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...taskData, ...firebaseObj},updatedFields:{...firebaseObj}});
                apiRequest("patch", env.V2_TASKS, {
                    action: "updateTaskName",
                    firebaseObj,
                    projectData,
                    taskData,
                    obj,
                    userData: {
                        "Employee_Name": userData.Employee_Name,
                        "id": userData.id,
                        "companyOwnerId": userData.companyOwnerId
                    }
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task name updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    } 

      updateTotalEstimatedTime({ firebaseObj,projectData ,taskData ,obj, userData}) {
        return new Promise((resolve,reject) => {
            try {
                const {sprintId,ProjectID} = taskData;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...taskData, ...firebaseObj},updatedFields:{...firebaseObj}});
                apiRequest("patch", env.V2_TASKS, {
                    action: "updateTaskTotalEstimate",
                    firebaseObj,
                    projectData,
                    taskData,
                    obj,
                    userData: {
                        "Employee_Name": userData.Employee_Name,
                        "id": userData.id,
                        "companyOwnerId": userData.companyOwnerId
                    }
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task total estimate update successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    } 

    /* -------------- UPDATE ASSIGNEE ADD OR ASSIGNEE REMOVE FUNCTION FOR TASK -----------------*/

    updateAssignee({ firebaseObj,projectData ,taskData,employeeName,type,userData,isUpdateTask = true}) {
        return new Promise((resolve,reject) => {
            try {
                let assignee = taskData.AssigneeUserId;
                const uid = firebaseObj.AssigneeUserId;
                if(type === 'assigneeAdd'){
                    assignee.push(uid);
                    assignee = Array.from(new Set(assignee));
                }else{
                    assignee = assignee.filter((id) => id!== uid);
                }

                const {sprintId,ProjectID} = taskData;

                Store.commit('projectData/mutateUpdateFirebaseTasks', { 
                    snap: null,
                    op: "modified",
                    pid: ProjectID,
                    sprintId,
                    data: { ...taskData, AssigneeUserId: assignee }, updatedFields: { ...firebaseObj }
                });

                apiRequest("patch", env.V2_TASKS, {
                    action: "updateAssignee",
                    firebaseObj,
                    projectData,
                    taskData,
                    employeeName,
                    type,
                    isUpdateTask,
                    userData: {
                        "Employee_Name": userData.Employee_Name,
                        "id": userData.id,
                        "companyOwnerId": userData.companyOwnerId
                    }
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task assignee updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- UPDATE TASK LEADER (CREATED BY) -----------------*/

    updateTaskLeader({ firebaseObj, projectData, taskData, employeeName, userData, isUpdateTask = true }) {
        return new Promise((resolve, reject) => {
            try {
                const newLeaderId = firebaseObj && firebaseObj.Task_Leader;
                if (!newLeaderId) {
                    reject({ status: false, error: new Error("Task_Leader is required") });
                    return;
                }

                const { sprintId, ProjectID } = taskData;

                // Optimistic UI: mirror what updateAssignee does for AssigneeUserId
                Store.commit('projectData/mutateUpdateFirebaseTasks', {
                    snap: null,
                    op: "modified",
                    pid: ProjectID,
                    sprintId,
                    data: { ...taskData, Task_Leader: newLeaderId },
                    updatedFields: { ...firebaseObj }
                });

                apiRequest("patch", env.V2_TASKS, {
                    action: "updateTaskLeader",
                    firebaseObj,
                    projectData,
                    taskData,
                    employeeName,
                    isUpdateTask,
                    userData: {
                        "Employee_Name": userData.Employee_Name,
                        "id": userData.id,
                        "companyOwnerId": userData.companyOwnerId
                    }
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({ status: true, statusText: "Task leader updated successfully" });
                    } else {
                        reject({ status: false, error: response.data.error });
                    }
                })
                .catch((error) => {
                    reject({ status: false, error: error });
                });
            } catch (error) {
                reject({ status: false, error: error });
            }
        });
    }

    /* -------------- UPDATE TASK WATCHER -----------------*/
    updateWatcher({companyId, projectId, sprintId, taskId, userId, add,userData,employeeName, watchers: watchersArr}) {
        return new Promise((resolve,reject) => {
            try {
                let watchers = watchersArr;
                if(add){
                    watchers.push(userId);
                    watchers = Array.from(new Set(watchers));
                }else{
                    watchers = watchers.filter((id) => id!== userId);
                }
                
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:projectId, sprintId, data: {_id: taskId, watchers: watchers},updatedFields:{watchers}});
                apiRequest("patch", env.V2_TASKS, {action: "updateWatcher", companyId, projectId, sprintId, taskId, userId, add,userData,employeeName})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task watcher updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- UPDATE TAGS -----------------*/
    updateTags({companyId, projectId, sprintId, taskId, tagsArray, tagId, operation}) {
        return new Promise((resolve,reject) => {
            try {
                let tags = tagsArray;
                
                if(operation === 'add'){
                    tags.push(tagId);
                    tags = Array.from(new Set(tags));
                }else{
                    tags = tags.filter((id) => id!== tagId);
                }
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:projectId, sprintId, data: {_id: taskId, tagsArray: tags},updatedFields:{tagsArray: tags}});
                apiRequest("patch", env.V2_TASKS, {action: "updateTags", companyId, projectId, sprintId, taskId, tagId, operation})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task tags updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- UPDATE CHECKLISTS -----------------*/
    // This function handles all MongoDB update queries
    updateChecklistsv2({data, projectId,taskId,historyObj,sprintId,companyId,ops,taskData,localUpdateArray}){
        return new Promise((resolve, reject) => {
            Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:projectId, sprintId, data: {_id: taskId, checklistArray: localUpdateArray},updatedFields:{checklistArray: localUpdateArray}});
            apiRequest("patch", env.V2_TASKS, {action: "updateChecklists", companyId, projectId, sprintId, taskId, data, operation:ops,historyObj,taskData})
            .then((response) => {
                if (response.data.status) {
                    resolve({status: true, statusText: "Checklist updated successfully"});
                } else {
                    reject({status: false, error: response.data.error})
                }
            })
            .catch((error) => {
                reject({status: false, error: error})
            })
        })
    }

    /* -------------- UPDATE ATTACHMENTS -----------------*/
    updateAttachments({companyId, sprintId, taskId, taskData, id = "", operation, data = {}, userData,projectData }) {
        return new Promise((resolve,reject) => {
            try {
                let attachments = taskData.attachments;

                const index = attachments.findIndex((x) => x.id === id);
                if(operation === 'add'){
                    if(index === -1) {
                        attachments.push(data);
                    }
                }else{
                    attachments.splice(index, 1);
                }
                
                const {ProjectID} = taskData;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...taskData, attachments},updatedFields:{attachments}});
                apiRequest("patch", env.V2_TASKS, {action: "updateAttachments", companyId, sprintId, taskId, taskData, id, operation, data, userData,projectData})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task attachments updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- UPDATE DESCRIPTION -----------------*/
    updateDescription({companyId, projectData, sprintId, task = {}, userData, text = ""}) {
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", env.V2_TASKS, {action: "updateDescription", companyId, projectData, sprintId, task, userData, text})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task description updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    /* -------------- MARK AS FAVOURITE -----------------*/
    markAsFavourite({companyId,taskData, userId}) {
        return new Promise((resolve, reject) => {
            try {
                const index = taskData && taskData.favouriteTasks ? taskData.favouriteTasks.findIndex((item) => item === userId) : -1;
                let favouriteTasks = taskData.favouriteTasks;
                let type = "";
                let updateFavouriteTasks;

                if(index === -1) {
                    type = "add";
                    updateFavouriteTasks = userId;
                    favouriteTasks.push(userId);
                    favouriteTasks = Array.from(new Set(favouriteTasks));
                } else {
                    type = "remove";
                    updateFavouriteTasks = taskData.favouriteTasks[index];
                    favouriteTasks = favouriteTasks.filter((id) => id!== userId);
                }
                
                const {sprintId,ProjectID} = taskData;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...taskData, favouriteTasks: favouriteTasks},updatedFields:{favouriteTasks}});

                apiRequest("patch", env.V2_TASKS, {action: "updateMarkAsFavourite",companyId,taskId:taskData._id,updateDetail:updateFavouriteTasks,type})
                .then((response) => {
                    if(response.status === 200){
                        resolve({status: response.status, statusText: `${type === "add" ? "Added to" : "Removed from"} favorite`});
                    }else{
                        resolve({status: response.status});
                    }
                })
                .catch((error) => {
                    reject(error)
                    console.error("ERROR in update task watcher: ", error.message);
                })
            } catch (error) {
                reject(error)
            }
        });
    }

    /* -------------- UPDATE ARV+CHIEVE/DELETE/RESTORE -----------------*/
    updateArchiveDelete({companyId, projectData, sprintId, task = {}, userData, deletedStatusKey = 0}) {
        return new Promise((resolve,reject) => {
            try {
                const {ProjectID} = task;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...task, deletedStatusKey},updatedFields:{deletedStatusKey}});
                apiRequest("patch", env.V2_TASKS, {action: "updateArchiveDelete", companyId, projectData, sprintId, task, userData, deletedStatusKey})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Task description updated successfully"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    convertToSubTask({companyId, projectData, sprintId, selectedTaskId,taskId,oldProject,isSubTask,userData}) {
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", "/api/v2/tasks", {action: "convertToSubTask", companyId, projectData, sprintId, selectedTaskId,taskId,oldProject,isSubTask,userData})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "converted",data:response.data.data});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    moveTask({companyId, projectData, sprintObj, moveTaskId,oldSprintObj,oldProject,isSubTask,assignee,watcher,userData}) {
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", "/api/v2/tasks", {action: "moveTask", companyId, projectData, sprintObj, moveTaskId, oldSprintObj,oldProject,isSubTask,assignee,watcher,userData})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "moved",data:response.data.data});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    convertToList({companyId, projectData, taskId, userData, folderData, sprintObj,isSubTask}) {
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", "/api/v2/tasks", {action: "convertToList", companyId, projectData, taskId, userData, folderData, sprintObj,isSubTask})
                .then((response) => {
                    if (response.data.status) {
                        Store.commit('projectData/mutateSprints', {op: "added", data: response.data.data});
                        resolve({status: true, statusText: "convert To List",data:response.data.data});
                    } else {
                        reject({status: false, error: response.data.error});
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error});
                })
            } catch (error) {
                reject({status: false, error: error});
            }
        });
    }

    mergeTask({companyId, projectData, taskId, mergeTaskId,oldProject,isSubTask,userData}) {
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", "/api/v2/tasks", {action: "mergeTask", companyId, projectData, taskId, mergeTaskId,oldProject,isSubTask,userData})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "merge",data:response.data.data});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                }) 
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    duplicateTask({companyId, projectData, sprintObj, selectedTaskId,oldProject,userData,isSubTask,duplicateData,assignee,watcher,taskName,oldSprintObj}) {
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", "/api/v2/tasks", {action: "duplicateTask", companyId, projectData, sprintObj, selectedTaskId,oldProject,userData,isSubTask,duplicateData,assignee,watcher,taskName,oldSprintObj})
                .then((response) => {
                    if (response.data.data.status) {
                        resolve(response.data);
                    } 
                    else if(response.data.data.isUpgrade) {
                        resolve(response.data);
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                }) 
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }
    updateQueueList({CompanyId, projectId, sprintId, taskId,userId,actionType,taskName,userData, queueListArray: queueList}) {
        return new Promise((resolve,reject) => {
            try {
                let axiosData = {
                    CompanyId : CompanyId,
                    projectId : projectId,
                    action: "updateQueueList",
                    sprintId:sprintId,
                    taskId:taskId,
                    userId:userId,
                    actionType:actionType,
                    taskName:taskName,
                    userData:userData
                }

                let queueListArray = queueList;
                if(actionType === 'add'){
                    queueListArray.push(userId);
                    queueListArray = Array.from(new Set(queueListArray));
                }else{
                    queueListArray = queueListArray.filter((id) => id!== userId);
                }

                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:projectId, sprintId, data: {_id: taskId, queueListArray},updatedFields:{queueListArray}});
                
                apiRequest("patch", env.V2_TASKS, axiosData)
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "updateQueueList",taskId: response.data.data.taskId});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                }) 
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    convertToTask({companyId, projectData, taskId, sprintObj,parentTaskId,oldSprintObj,oldProject}) {
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", "/api/v2/tasks", {action: "convertToTask", companyId, projectData, taskId, sprintObj,parentTaskId,oldSprintObj,oldProject})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "convertToTask"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                }) 
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    createSubTaskWithAi({companyId,userId,subTitles,sprintObj,projectData,userData,parentTask,type}){
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", "/api/v2/tasks", {action: "createSubTaskWithAi", companyId,userId,subTitles,sprintObj,projectData,userData,parentTask,type})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Created",data : response.data.data});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                }) 
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    updateTaskCustomField({companyId,taskId,updateDetail,customFieldId,taskObj}){
        return new Promise((resolve,reject) => {
            try {
                const updateTask = taskObj;
                updateTask.customField = {...updateTask?.customField,[updateDetail._id]:{
                    fieldValue:updateDetail.fieldValue,
                    _id:updateDetail._id
                }}
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:updateTask.ProjectID || '', sprintId:updateTask?.sprintId || '', data: {...updateTask},updatedFields:{...updateTask}});
                apiRequest("patch", env.V2_TASKS, {action: "updateTaskCustomField", companyId,taskId,updateDetail,customFieldId})
                .then((response) => {
                    if (response.data.status && response?.data?.data?.data && Object.keys(response?.data?.data?.data)?.length) {
                        resolve({status: true, statusText: "Created",data : response.data.data});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                }) 
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    updateLastMessageTime({ companyId, taskId, msgObj }) {
        return new Promise((resolve, reject) => {
            try {
                apiRequest("patch", env.V2_TASKS, { action: "updateLastMessageTime", companyId, taskId, msgObj }).then(() => {
                    resolve({ status: true, statusText: "updateLastMessageTime updated successfully" });
                })
                .catch((error) => {
                    reject({ status: false, error: error })
                })
            } catch (error) {
                reject({ status: false, error: error })
            }
        })
    }

    updateAiChecklist({companyId,taskId,checklistArray,userData,sprintId,projectId}){
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", env.V2_TASKS, {action: "AddAiChecklist", companyId,taskId,checklistArray,userData,sprintId,projectId})
                .then((response) => {
                    Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:projectId, sprintId, data: {_id: taskId, checklistArray: checklistArray},updatedFields:{checklistArray: checklistArray}});
                    if (response.data.status === 200) {
                        resolve({status: true, statusText: "Created",data : response.data.data});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                }) 
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    updateTaskType({firebaseObj,projectData,taskData,prevStatus,userData,isUpdateTask}){
        return new Promise((resolve, reject) => {
            try {
                const {sprintId,ProjectID} = taskData;
                Store.commit('projectData/mutateUpdateFirebaseTasks', {snap:null, op: "modified", pid:ProjectID, sprintId, data: {...taskData, ...firebaseObj},updatedFields:{...firebaseObj}});
                apiRequest("patch", env.V2_TASKS, {
                    action: "updateTaskType",
                    newStatus:firebaseObj,
                    prevStatus,
                    projectData,
                    taskData,
                    isUpdateTask,
                    userData: {
                        "Employee_Name": userData.Employee_Name,
                        "id": userData.id,
                        "companyOwnerId": userData.companyOwnerId
                    }
                })
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "updateTaskType"});
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                })
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }

    createMultipleTasks({tasks, userData, projectData, indexObj, statusArray, sprint, eventId}){
        return new Promise((resolve,reject) => {
            try {
                apiRequest("patch", env.V1_TASKS_IMPORT, {action: "createMultipleTasks", tasks, userData, projectData, indexObj, statusArray, sprint, eventId})
                .then((response) => {
                    if (response.data.status) {
                        resolve({status: true, statusText: "Created All Tasks",data : response.data.createdTasks});
                        response.data.data.customFields.forEach((field) => {
                            Store.commit("settings/mutateFinalCustomFields", {data: field || {},op: "added"});
                        })
                    } else {
                        reject({status: false, error: response.data.error})
                    }
                })
                .catch((error) => {
                    reject({status: false, error: error})
                }) 
            } catch (error) {
                reject({status: false, error: error})
            }
        })
    }
}

export default new Task();