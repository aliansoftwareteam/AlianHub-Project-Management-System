import { computed, inject, ref } from "vue"
import {useCustomComposable, useGetterFunctions, useMoment} from "@/composable/index"
import { useStore } from "vuex";
import taskClass from "@/utils/TaskOperations"
import { useToast } from "vue-toast-notification";
import {taskDueDateChange, taskDueDateAdd} from "@/utils/NotificationTemplate"
import { i18n } from "@/locales/main";
const t = i18n.global.t;
import * as env from '@/config/env';
import { apiRequest } from '../../services';
import { firstId } from '@/utils/taskOpenProjectId';

const projectsList = ref([]);
const filterdProjects = ref([]);
export function useProjectsHelper() {
    const userId = inject("$userId")
    const {getters, dispatch} = useStore();
    const {checkPermission} = useCustomComposable();
    const projectsGetter = computed(() => getters['projectData/projects'])
    const companyUserDetail = computed(() => getters['settings/companyUserDetail'])
    const searchProjectArray = computed(()=> getters['projectData/searchedProjects'])
    const allProjects = computed(() => getters['projectData/allProjects']);
    const isArchivedFetched = ref(false);
    function projectListFilters(filterOptions = {}) {
        return new Promise((resolve, reject) => {
            try {
                const {
                    projectSearch,
                    folderSearch,
                    sprintSearch,
                    search,
                    filterFavorites,
                    showArchivedProjects,
                    isSearchUpdate,
                    isProjectFilterApplied,
                    ProjectfilterObject
                } = filterOptions;
                let sourceProjects = searchProjectArray.value;
                const allowClosedProjects = (ProjectfilterObject?.query['$and']?.some((x) => x.status?.['$in']?.includes('close')) || ProjectfilterObject?.query['$or']?.some((x) => x.status?.['$in']?.includes('close')));
                if (!allowClosedProjects) {
                    sourceProjects = sourceProjects.filter((x) => x.status !== 'close');
                }
                const sortProjects = (projects) => {
                    if (!Object.keys(ProjectfilterObject.sortByField || {}).length) {
                        return projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                    }
                    return projects;
                };
    
                const filterFavoritesAndSort = (projects) => {
                    const favourites = projects.filter((x) => x.favouriteTasks?.some((y) => y.userId === userId.value));
                    const others = projects.filter((x) => !x.favouriteTasks?.some((y) => y.userId === userId.value));
                    return [...sortProjects(favourites), ...sortProjects(others)];
                };
    
                const processProjects = (projects) => {
                    let filteredProjects;
                    if (filterFavorites && !search.value && !Object.keys(ProjectfilterObject.query || {}).length && !Object.keys(ProjectfilterObject.sortByField || {}).length) {
                        filteredProjects = filterFavoritesAndSort(projects);
                    } else {
                        filteredProjects = sortProjects(projects);
                    }
                    filterdProjects.value = filteredProjects;
                    resolve(filteredProjects);
                };
    
                const searchProjects = (searchType, filterObj) => {
                    dispatch("projectData/searchProjects", {search: search.value, type: searchType, showArchived: showArchivedProjects,...filterObj, fields: '_id',projectList: projectsList.value})
                        .catch((error) => reject(error));
                };
                if (!showArchivedProjects) {
                    if (search.value) {
                        if (projectSearch.value) {
                            isSearchUpdate
                                ? searchProjects(isProjectFilterApplied ? 'projectFilter_projectName' : 'projectName', ProjectfilterObject)
                                : processProjects(sourceProjects);
                        } else if (folderSearch.value) {
                            isSearchUpdate
                                ? searchProjects(isProjectFilterApplied ? 'projectFilter_folder' : 'folder', ProjectfilterObject)
                                : processProjects(sourceProjects);
                        } else if (sprintSearch.value) {
                            isSearchUpdate
                                ? searchProjects(isProjectFilterApplied ? 'projectFilter_sprint' : 'sprint', ProjectfilterObject)
                                : processProjects(sourceProjects);
                        }
                    } else {
                        if (isProjectFilterApplied) {
                            processProjects(sourceProjects.length ? sourceProjects : []);
                        } else {
                            processProjects(projectsList.value || []);
                        }
                    }
                }
            } catch (error) {
                filterdProjects.value = [];
                reject(error);
            }
        });
    }
    

    function filterSprints(object = null, showArchived, filterFavorites) {
        if(!object) return {};

        let sprints = {};
        let folders = {};

        if(object.sprintsObj && Object.keys(object.sprintsObj).length) {
            Object.values(object.sprintsObj).forEach((sprint) => {
                if(sprint.deletedStatusKey !== 1 && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2) || (!sprint?.private || sprint?.AssigneeUserId?.includes(userId.value))) {
                    if(!showArchived) {
                        if(!sprint.deletedStatusKey && sprint._id) {
                            sprints[sprint.id || sprint._id] = sprint;
                        }
                    } else {
                        if(sprint.deletedStatusKey !== 1 && (sprint.deletedStatusKey === 2 || sprint.archiveTaskCount) && sprint._id) {
                            sprints[sprint.id || sprint._id] = sprint;
                        }
                    }
                }
            })

            let tmp = {};
            if(filterFavorites) {
                const favourites = Object.values(sprints).filter(x => x.favouriteTasks?.length && x.favouriteTasks.filter((y) => y.userId === userId.value).length).sort((a,b) => new Date(a?.createdAt) > new Date(b?.createdAt) ? -1 : 1)
                const others = Object.values(sprints).filter(x => !x.favouriteTasks?.length || !x.favouriteTasks.filter((y) => y.userId === userId.value).length).sort((a,b) => new Date(a?.createdAt) > new Date(b?.createdAt) ? -1 : 1)
                let arr = [...favourites, ...others]
                arr.forEach((sprint) => {
                    tmp[sprint.id || sprint._id] = sprint;
                })
            } else {
                tmp = sprints;
            }

            object.sprintsObj = tmp;
        }
        if(object.sprintsfolders && Object.keys(object.sprintsfolders).length) {
            Object.keys(object.sprintsfolders).forEach((key) => {
                const archived = object.sprintsfolders[key].deletedStatusKey === 2;
                const tmpObj = object.sprintsfolders[key];

                object.sprintsfolders[key] = !showArchived && archived ? filterSprints(tmpObj, showArchived) : tmpObj;
                let folder = object.sprintsfolders[key];

                let tmp = {};
                if(filterFavorites && folder?.sprintsObj) {
                    const favourites = Object.values(folder.sprintsObj).filter(x => x.favouriteTasks?.length && x.favouriteTasks.filter((y) => y.userId === userId.value).length).sort((a,b) => a?.createdAt?.seconds > b?.createdAt?.seconds ? -1 : 1)
                    const others = Object.values(folder.sprintsObj).filter(x => !x.favouriteTasks?.length || !x.favouriteTasks.filter((y) => y.userId === userId.value).length).sort((a,b) => a?.createdAt?.seconds > b?.createdAt?.seconds ? -1 : 1)
                    let arr = [...favourites, ...others]
                    arr.forEach((sprint) => {
                        tmp[sprint.id || sprint._id] = sprint;
                    })
                } else {
                    tmp = folder.sprintsObj;
                }
                folder.sprintsObj = tmp;

                if(!showArchived) {
                    if(!folder.deletedStatusKey && folder._id) {
                        folders[key] = folder;
                    }
                } else {
                    if(folder.deletedStatusKey === 2 && folder._id) {
                        folder.archivedSprintList = JSON.parse(JSON.stringify(folder.sprintsObj))
                        folder.sprintsObj = {};
                    }
                    if(folder.deletedStatusKey !== 1 && (folder.deletedStatusKey === 2 || (folder.sprintsObj && Object.keys(folder.sprintsObj).length)) && folder._id) {
                        folders[key] = folder;
                    }
                }
            })
            object.sprintsfolders = folders;
        }
        return object;
    }

    function setFinalSprint (sprintArray)  {
        let projectWiseSprint = [];
        sprintArray.forEach((ele)=> {
            if (projectWiseSprint.find((x)=> x.id === ele.projectId)) {
                projectWiseSprint.find((x)=> x.id === ele.projectId).sprints.push(ele)
            } else {
                projectWiseSprint.push({
                    id : ele.projectId,
                    sprints: [ele]
                })
            }
        })
        return projectWiseSprint
    }

    function setFinalFolders (sprints,folders) {
        let folderSprints = sprints.filter((x)=> x.folderData.length)
        let foldersWithSprint = [];
        folderSprints.forEach((x)=>{
            if (foldersWithSprint.find((y)=> y._id === x?.folderId)) {
                let sprints = x;
                delete sprints.folderData;
                const folder = foldersWithSprint.find(y => y._id === x?.folderId);
                if (folder) {
                    if (!folder.sprintsObj) {
                        folder.sprintsObj = {};
                    }
                    folder.sprintsObj[sprints._id] = sprints;
                }
            } else {
                let folder = x.folderData[0];
                if (folder) {
                    delete x.folderData
                    let obj = {
                        ...folder,
                        sprintsObj: {
                            [x._id]: x
                        }
                    }
                    foldersWithSprint.push(obj)
                }
            }
        })
        let archivedFolders = folders.map((x)=> {return {...x, sprints: []}});
        archivedFolders.forEach((x)=> {
            if (!foldersWithSprint.find((y)=> y._id === x?._id)) {
                foldersWithSprint.push({...x, sprints: []})
            }
        })
        let projectWiseFolder = [];
        foldersWithSprint.forEach((x)=>{
            if (projectWiseFolder.find((z)=> z.id === x.projectId)) {
                projectWiseFolder.find((z)=> z.id === x.projectId).folders.push({...x});
            } else {
                projectWiseFolder.push({
                    id: x.projectId,
                    folders: [x]
                })
            }
        })
        
        return projectWiseFolder
    }

    function setArchivedProjects(projects,sprints,folders) {
        let finalPro = projects.filter((x)=> x.statusType !== 'close')
        let final = finalPro.filter((x)=> x.deletedStatusKey === 2);
        sprints.forEach((x)=>{
            if (final.find((z)=> z._id === x.id)) {
                let obj = {};
                x.sprints.forEach((q)=>{
                    obj[q._id] = q 
                })
                final.find((z)=> z._id === x.id).sprintsObj = obj;
            } else {
                let proj = finalPro.find((z)=> z._id === x.id)
                if (proj) {
                    let obj = {};
                    x.sprints.forEach((q)=>{
                        obj[q._id] = q 
                    })
                    proj.sprintsObj = obj;
                    final.push(proj)
                }
            }
        })
        folders.forEach((x)=>{
            if (final.find((z)=> z._id === x.id)) {
                let obj = {};
                x.folders.forEach((q)=>{
                    obj[q._id] = q 
                })
                final.find((z)=> z._id === x.id).sprintsfolders = obj;
            } else {
                let proj = finalPro.find((z)=> z._id === x.id)
                if (proj) {
                    let obj = {};
                    x.folders.forEach((q)=>{
                        obj[q._id] = q 
                    })
                    proj.sprintsfolders = obj;
                    final.push(proj)
                }
            }
        })
        return final
    }

    function filteredProjects(projects = [], showArchived = false, filterFavorites = false) {
        return new Promise((resolve, reject) => {
            try {
                if (!showArchived) {
                    const tmp = ref([]);

                    projects.forEach((project) => {
                        project = filterSprints(project, showArchived, filterFavorites);
                        if(!showArchived) {
                            if(!project.deletedStatusKey) {
                                tmp.value.push(project);
                            }
                        } else {
                            if(project.deletedStatusKey === 2 || (project.sprintsObj && (Object.keys(project.sprintsObj).length)|| (project.sprintsfolders && Object.keys(project.sprintsfolders).length))) {
                                tmp.value.push(project);
                            }
                        }
                    })
    
                    if(filterFavorites) {
                        const favourites = tmp.value.filter(x => x.favouriteTasks?.length && x.favouriteTasks.filter((y) => y.userId === userId.value).length)?.sort((a,b) => new Date(a.createdAt).getTime() > new Date(b.createdAt).getTime() ? -1 : 1)
                        const others = tmp.value.filter(x => !x.favouriteTasks?.length || !x.favouriteTasks.filter((y) => y.userId === userId.value).length)?.sort((a,b) => new Date(a.createdAt).getTime() > new Date(b.createdAt).getTime() ? -1 : 1)
                        tmp.value = [...favourites, ...others];
                    } else {
                        tmp.value = tmp.value.sort((a, b) => new Date(a?.createdAt).getTime() > new Date(b?.createdAt).getTime() ? -1 : 1);
                    }

                    if(!projectsList.value.length) {
                        filterdProjects.value = tmp.value;
                    }
                    projectsList.value = tmp.value;
                    isArchivedFetched.value = false;
                    resolve(tmp.value);
                } else {
                    if (!isArchivedFetched.value) {
                        projectsList.value = [];
                        filterdProjects.value = [];
                        apiRequest("post", `${env.PROJECTSEARCH}`, { search: "", type:'showArchiveOnly', showArchived: showArchived }).then(async(response)=>{
                            let assignedProjects = allProjects.value.data.map((x)=> x._id);
                            let sprintData = response?.data?.[0]?.matchedDocuments || [];
                            let onlyFolderArchived = response.data[0].additionalFolders || [];
                            let filteredSprints = sprintData.filter((x)=> assignedProjects.includes(x.projectId));
                            let filteredFolder = onlyFolderArchived.filter((x)=> assignedProjects.includes(x.projectId));
                            let withoutFolderSprints = filteredSprints.filter((x)=> !x.folderData.length);
                            let finalSprints = await setFinalSprint(withoutFolderSprints)
                            let finalFolders = await setFinalFolders(filteredSprints,filteredFolder);
                            let finalProjects = await setArchivedProjects(JSON.parse(JSON.stringify(allProjects.value.data)),finalSprints,finalFolders);
                            if(!projectsList.value.length) {
                                filterdProjects.value = finalProjects;
                            }
                            projectsList.value = finalProjects;
                            isArchivedFetched.value = true;
                            resolve(finalProjects)
                        }).catch((error)=>{
                            reject(error)
                        })
                    }
                }
            } catch (error) {
                console.error("ERROR: ", error);
                reject(error);
            }
        })
    }

    function getTeamsData() {
        return new Promise((resolve) =>{
            try {
                if(getters["settings/teams"] && getters["settings/teams"].length === 0){
                    dispatch("settings/setTeams").then((response) => {
                        resolve(response);
                    })
                }else{
                    resolve(getters["settings/teams"]);
                }
            } catch (error) {
                console.error(error,"settings");
            }
        })
    }

    function dispatchProjects() {
        return new Promise((resolve, reject) => {
            try {
                if(!projectsGetter.value || !Object.keys(projectsGetter.value).length) {
                    getTeamsData().then((teams) => {
                        const uid = companyUserDetail.value.userId;
                        if(getters["settings/teams"] && getters["settings/teams"].length === 0){
                            dispatch("settings/setTeams").then((response) => {
                                teams = response;
                            })
                        }else{
                            teams = getters["settings/teams"];
                        }
                        const filterteam = teams.filter((x) => x.assigneeUsersArray.indexOf(uid) !== -1);
                        const teamIds = filterteam.map((x) => 'tId_'+x._id);
                        let publicQuery = {
                            isPrivateSpace:false
                        }
                        if(companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2 && !getters["settings/rules"].toggle?.showAllProjects) {
                            publicQuery.AssigneeUserId = {
                                $in:[uid]
                            }
                            if (teamIds && teamIds.length) {
                                publicQuery.AssigneeUserId.$in = [...publicQuery.AssigneeUserId.$in.concat(teamIds)]
                            }
                        }
                        
                        const privatePermission = checkPermission("project.private_projects");

                        let privateQuery = {
                            isPrivateSpace:true
                        }
                        if(companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2) {
                            if (privatePermission === 1) { 
                                    privateQuery.AssigneeUserId = {
                                    $in: [uid]
                                }
                                if (teamIds && teamIds.length) {
                                    privateQuery.AssigneeUserId.$in = [...privateQuery.AssigneeUserId.$in.concat(teamIds)];
                                }
                            } else if (privatePermission === null) {
                                privateQuery = {};
                            }
                        }
                        const roleType = companyUserDetail.value.roleType;
    
                        if(checkPermission('project.project_list') !== null) {
                            dispatch("projectData/setProjects",{
                                ...(checkPermission("project.public_projects") === true ? publicQuery : {}),
                                restrictPublic: checkPermission("project.public_projects") !== true,
                                privateQuery,
                                roleType,
                                uid
                            })
                            .then(() => {
                                resolve(projectsGetter.value);
                            })
                            .catch((error) => {
                                reject(error);
                                console.error("ERROR in setProjects: ", error);
                            })
                        }
                    }).catch((error) => {
                        console.error(error,"ERROR IN GET TEAMS DATA");
                    })
                } else {
                    resolve(projectsGetter.value);
                }
            } catch (err) {
                reject(err);
            }
        })
    }

    return {
        projects: projectsList,
        filterdProjects,
        filteredProjects,
        projectListFilters,
        dispatchProjects,
    }
}

export function useUpdateTasks() {
    const $toast = useToast();
    const {getTaskStatus, getUser, getPriority, getTaskType} = useGetterFunctions();
    const {changeDateFormate} = useMoment();
    const {getWasabiImageLink} = useCustomComposable();
    const userId = inject("$userId");
    const companyId = inject("$companyId")
    const dateFormat = inject('$dateFormat');
    const projectData = inject("selectedProject");

    function returnMethodByGroupType(groupType) {
        switch (groupType) {
            case 0:
                return updateStatus;
            case 1:
                return updateAssignee;
            case 2:
                return updatePriority;
            case 3:
                return updateDueDate;
            case 4:
                return updateTaskType;
        }
    }

    function updateTaskByGroup(task, updateTo, groupType, assigneeType = null ,isUpdateTask = true) {
        return new Promise((resolve, reject) => {
            try {
                if(groupType === undefined || groupType === null) return reject(new Error(`No group type found`));
                returnMethodByGroupType(groupType)(task, updateTo, assigneeType,isUpdateTask)
                .then(() => {
                    resolve(true);
                })
                .catch((error) => {
                    reject(error);
                })
            } catch (error) {
                reject(error);
            }
        })
    }

    function getUserData() {
        let user = getUser(userId.value);
        return {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: user.companyOwnerId,
        };
    }

    const updateStatus = (task, newStatusValue,assigneeType,isUpdateTask) => {
        return new Promise((resolve, reject) => {
            try {
                let prevStatus = getTaskStatus(task.statusKey)
                const userData = getUserData();
                let prevStatusObj = {
                    'backColor': prevStatus.bgColor,
                    'color': prevStatus.textColor,
                    'statusName': prevStatus.name,
                    'taskName': task.TaskName,
                    'bgColor': newStatusValue.bgColor,
                    'textColor': newStatusValue.textColor,
                    'taskId': task._id,
                    'updatedTaskName': newStatusValue.name,
                }
                const updatedStatus = {
                    'text': newStatusValue.name,
                    'key': newStatusValue.key,
                    'type': newStatusValue.type,
                }
                const newStatus = {
                    status: updatedStatus,
                    'statusType': newStatusValue.type,
                    'statusKey': newStatusValue.key
                }
                const project = {
                    _id: projectData.value._id,
                    CompanyId: projectData.value.CompanyId,
                    lastTaskId: projectData.value.lastTaskId,
                    ProjectName: projectData.value.ProjectName,
                    ProjectCode: projectData.value.ProjectCode
                }
                taskClass.updateStatus({ newStatus, prevStatus: prevStatusObj, projectData: project, task: task, userData , isUpdateTask : isUpdateTask})
                .then(() => {
                    $toast.success(t(`Toast.Status_changed_successfully`), {position: "top-right"})
                    resolve();
                })
                .catch((error) => {
                    console.error("ERROR in changeStatus: ", error);
                    reject(error);
                })
            } catch (error) {
                reject(error);
            }
        })
    }
    const updatePriority = (task, newPriority,assigneeType,isUpdateTask) => {
        return new Promise((resolve, reject) => {
            (async () => {  
                try {
                    const userData = getUserData();
    
                    let updateObj = {
                        Task_Priority : newPriority.value
                    }
    
                    let project = {
                        '_id': projectData.value._id ? projectData.value._id : "",
                        'ProjectName' : projectData.value.ProjectName,
                        "CompanyId": companyId.value,
                    }
    
                    const priority = getPriority(task.Task_Priority)
                    let priorityObj = {
                        'statusImage' : await getWasabiImageLink(projectData.value.CompanyId,priority.image),
                        'priorityName' : priority.value,
                        'taskId': task._id,
                        'taskName': task.TaskName,
                        'userName' : userData.Employee_Name,
                        'newStatusImage' : await getWasabiImageLink(projectData.value.CompanyId,newPriority.image),
                        'newPriorityName' : newPriority.value
                    }
    
                    taskClass.updatePriority({firebaseObj: updateObj, projectData: project, taskData: task, priorityObj, userData, isUpdateTask : isUpdateTask})
                    .then(() => {
                        $toast.success(t(`Toast.Task_updated_successfully`), {position: "top-right"})
                        resolve();
                    })
                    .catch((error) => {
                        console.error("ERROR in update priority: ", error);
                        reject(error);
                    })
                } catch (error) {
                    reject(error);
                }
            })();
        })
    }
    const updateDueDate = (task, newDueDate,assigneeType,isUpdateTask) => {
        return new Promise((resolve, reject) => {
            try {
                const userData = getUserData();
                let newdueDateDeadLine = [];
                if(task.dueDateDeadLine.length > 0) {
                    task.dueDateDeadLine.forEach((date) => {
                        newdueDateDeadLine.push({ date: new Date(date.date.seconds * 1000) })
                    })
                    newdueDateDeadLine.push({ date: new Date(newDueDate.seconds*1000)});
                } else {
                    newdueDateDeadLine.push({ date: new Date(newDueDate.seconds*1000)});
                }
                let typesenseDeadLine = JSON.parse(JSON.stringify(newdueDateDeadLine));
                typesenseDeadLine.forEach(day => {
                    day.date = new Date(day.date).getTime()/1000
                })
                const updateobj = {
                    DueDate: new Date(newDueDate.seconds*1000),
                    dueDateDeadLine: newdueDateDeadLine
                }
                const typesensObj = {
                    DueDate: newDueDate.seconds,
                    dueDateDeadLine: typesenseDeadLine.map((x) => JSON.stringify(x))
                }
                let notificationObj = {
                    key: "task_due_date",
                    projectId: task.ProjectID,
                    taskId: task._id,
                    sprintId: task.sprintId
                }
                let obj = {
                    'ProjectName' : projectData.value.ProjectName || "",
                    'TaskName' : task.TaskName,
                }
                if(task.dueDateDeadLine.length > 0 ) {
                    obj.previousDate = changeDateFormate(new Date(task.dueDateDeadLine[task.dueDateDeadLine.length - 1].date.seconds * 1000))
                    obj.changedDate = changeDateFormate(new Date(newDueDate.seconds*1000))
                    notificationObj.message = taskDueDateChange(obj);
                } else  {
                    obj.lastDate = changeDateFormate(new Date(newDueDate.seconds*1000))
                    notificationObj.message = taskDueDateAdd(obj);
                }
                const project = {
                    _id: projectData.value._id,
                    CompanyId: projectData.value.CompanyId,
                    lastTaskId: projectData.value.lastTaskId,
                    ProjectName: projectData.value.ProjectName,
                    ProjectCode: projectData.value.ProjectCode
                }

                let object = {
                    commonDateFormatString: dateFormat.value,
                    firebaseObj: updateobj,
                    typesenseObj: typesensObj,
                    project: project,
                    task: task,
                    obj: notificationObj,
                    userData,
                    isUpdateTask: isUpdateTask
                }

                taskClass.updateDueDate(object).then(() => {
                    $toast.success(t(`Toast.Due_date_updated_successfully`), {position: "top-right"})
                    resolve();
                }).catch((error) => {
                    console.error("ERROR in updateDueDate: ", error);
                    reject(error);
                })
            } catch (error) {
                reject(error);
            }
        })
    }
    const updateAssignee = (task, newAssignee, assigneeType,isUpdateTask) => {
        return new Promise((resolve, reject) => {
            try {
                const userData = getUserData();
                let assignUsers = newAssignee.value !== '' ? newAssignee.value.split("_") : [];
                let employeeName = [];
                if (assignUsers.length) {
                    assignUsers.forEach((ele)=>{
                        employeeName.push(getUser(ele).Employee_Name)
                    })
                } else {
                    task.AssigneeUserId.forEach((ele)=>{
                        employeeName.push(getUser(ele).Employee_Name)
                    })
                }
                let updateObject = {
                    AssigneeUserId : assignUsers
                }

                const project = {
                    _id: projectData.value._id,
                    CompanyId: projectData.value.CompanyId,
                    lastTaskId: projectData.value.lastTaskId,
                    ProjectName: projectData.value.ProjectName,
                    ProjectCode: projectData.value.ProjectCode
                }

                taskClass.updateAssignee({
                    firebaseObj: updateObject,
                    projectData: project,
                    taskData: task,
                    employeeName: employeeName,
                    type: assigneeType ? assigneeType : "replace",
                    userData,
                    isUpdateTask
                })
                .then(() => {
                    $toast.success(t(`Toast.Assignee_changed_successfully`), {position: "top-right"})
                    resolve();
                })
                .catch((error) => {
                    console.error("ERROR in changeAssignee: ", error);
                    reject(error);
                })
            } catch (error) {
                reject(error);
            }
        })
    }
 /* eslint-disable */
    const updateTaskType = (task, newTaskType, type,isUpdateTask) => {
        return new Promise(async(resolve, reject) => {
            try {
                let prevStatus = getTaskType(task.TaskTypeKey)
                const userData = getUserData()
                let newTaskTypeImage = await getWasabiImageLink(projectData.value.CompanyId,newTaskType.taskImage);
                let oldTaskTypeImage = await getWasabiImageLink(projectData.value.CompanyId,prevStatus.taskImage);
                let updatedTaskType = {
                    TaskType:newTaskType.value,
                    TaskTypeKey:newTaskType.key,
                    taskTypeImage: newTaskType.taskImage.startsWith('http') ? newTaskType.taskImage : newTaskTypeImage,
                    oldTaskTypeImage: newTaskType.taskImage.startsWith('http') ? prevStatus.taskImage : oldTaskTypeImage,
                    taskTypeName: newTaskType.name
                }
                taskClass.updateTaskType({firebaseObj: updatedTaskType, projectData: projectData.value, taskData: task, prevStatus, userData, isUpdateTask : isUpdateTask})
                .then(() => {
                    $toast.success(t(`Toast.Task_updated_successfully`), {position: "top-right"})
                    resolve();
                })
                .catch((error) => {
                    console.error("ERROR in update priority: ", error);
                    reject(error);
                })
            } catch (error) {
                console.error(error);
                reject(error);
            }
        })
    }

    return {
        updateTaskByGroup
    }
}

export function taskListHelper() {
    const userId = inject("$userId")
    const companyId = inject("$companyId")
    const {
        getters,
        dispatch
    } = useStore();
    const {getUser} = useGetterFunctions();
    const {checkPermission} = useCustomComposable();
    // const groupedTasks = ref([]);
    const indexKey= ref("");
    const expandedSprint = ref("");
    const priorities = computed(() => getters["settings/companyPriority"])
    const weekDays= ref(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
    const project = inject('selectedProject');
    const permit = checkPermission("task.show_tasks",project?.value?.isGlobalPermission);
    function getSprintTasks({projectId, sprintId, item, fetchNew = false, projectData ,indexName,parentId = '',groupType,resetTable}) {
        return new Promise((resolve, reject) => {
            try {
                if(permit === null && projectData.isGlobalPermission === false) {
                    resolve();
                    return;
                }
                if(groupType && groupType === 'table') {
                    dispatch("projectData/setTableTasksFromTypesense", {
                        cid: companyId.value,
                        pid: firstId(projectId),
                        sprintId: firstId(sprintId),
                        item,
                        fetchNew,
                        userId: userId.value,
                        showAllTasks: projectData.isGlobalPermission === false ? permit : true,
                        isFirst : false,
                        resetTable:resetTable
                    })
                    .then(() => {
                        resolve();
                    })
                    .catch((error) => {
                        reject(error);
                        console.error(`ERROR in get tasks > ${projectId} > ${sprintId}: `, error);
                    })
                } else {
                    dispatch("projectData/getPaginatedTasks", {
                        cid: companyId.value,
                        pid: firstId(projectId),
                        sprintId: firstId(sprintId),
                        item,
                        fetchNew,
                        userId: userId.value,
                        showAllTasks: projectData.isGlobalPermission === false ? permit : true,
                        indexName: indexName,
                        parentId : parentId
                    })
                    .then(() => {
                        resolve();
                    })
                    .catch((error) => {
                        reject(error);
                        console.error(`ERROR in get tasks > ${projectId} > ${sprintId}: `, error);
                    })
                }
            } catch (error) {
                console.error("ERROR: ", error);
            }
        })
    }
    function refetchSprintBoardTasks({ projectId, sprintId }) {
        return new Promise((resolve, reject) => {
            try {
                dispatch("projectData/getPaginatedTasks", {
                    cid: companyId.value,
                    pid: firstId(projectId),
                    sprintId: firstId(sprintId),
                    item: { searchKey: 'all', searchValue: 'all', indexName: 'kanbanIndex', conditions: [] },
                    fetchNew: true,
                    unfiltered: true,
                    resetCursor: true,
                    userId: userId.value,
                    showAllTasks: true,
                    indexName: 'kanbanIndex',
                    parentId: '',
                })
                .then(resolve)
                .catch((error) => {
                    console.error(`ERROR in get tasks > ${projectId} > ${sprintId}: `, error);
                    reject(error);
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    // FIREBASE
    function getMongoDBUpdate({projectId, sprintId,projectData, groupBy: groupByValue, currentView})
    {
        if(permit === null && projectData.isGlobalPermission === false) {
            return;
        }
        dispatch("projectData/getTasksFromMongoDB", {
            cid: companyId.value,
            pid: firstId(projectId),
            sprintId: firstId(sprintId),
            userId: userId.value,
            showAllTasks: projectData.isGlobalPermission === false ? permit : true,
            groupBy:groupByValue,
            currentView
        })
        .catch((error) => {
            console.error(`ERROR in get tasks > ${projectId} > ${sprintId}: `, error);
        })
    }

    function updateTaskKanbanIndex() {
        return;
    }

    async function groupBy(type, refetch = false,project,sprintData,groupedTasks,isBoard,lView='list',resetTable=false,fetchTask = true,cb) {
        try {
            if(!project || !Object.keys(project).length) {
                cb([])
                return
            }

            let arr = [];
            let tasks = [];

            let sprints = JSON.parse(JSON.stringify(sprintData)).filter((x) => x);

            if(type === 0) {
                arr = Array.isArray(project.taskStatusData) ? project.taskStatusData : [];
                if (!arr.length) {
                    arr = [{ name: 'Tasks', key: '', textColor: '', bgColor: '' }];
                }

                indexKey.value = "kanbanIndex";

                sprints.forEach((sprint, index) => {
                    // sprint.isExpanded = false;
                    let tmp = []
                    arr.forEach((x, arrIndex) => {
                        tmp.push({
                            key: `${index}_${arrIndex}_${x.name}`,
                            ...x,
                            isExpanded: true,
                            textColor: x.textColor,
                            bgColor: x.bgColor,
                            tasksArray: [],

                            conditions: x.key ? [
                                {
                                    statusKey: {$eq: x.key}
                                }
                            ] : [],

                            searchKey: "statusKey",
                            indexName: "groupByStatusIndex",
                            searchCondition: ":=",
                            searchValue: x.key
                        });
                    })

                    sprint.items = tmp;
                })
            } else if(type === 1) {
                indexKey.value = "assigneeIndex";

                // await getCollectionData({
                //     collectionName: `${companyId.value}_${dbCollections.TASKS}`,
                //     search: {
                //         q:"*",
                //         "group_by": "AssigneeUserId",
                //         "filter_by": `ProjectID:=${project.value._id}`,
                //         "group_limit": 1,
                //         "per_page": 250
                //     }
                // })
                // .then((result) => {
                    let assigneeGroups = [].grouped_hits.map((x) => x.group_key[0]).map((x) => x.sort((a,b) => a > b ? 1 : -1));
                    assigneeGroups.forEach((group => {
                        let assignees = group.sort((a,b) => a > b ? 1 : -1)
                        if(!arr.filter((x) => x.value === assignees.join("_")).length) {
                            arr.push({
                                isExpanded: true,
                                name: "Assignee",
                                users: assignees.length ? assignees.map((x) => getUser(x)) : [],
                                value: assignees.join("_")
                            })
                        }
                    }))

                    if(!arr.length) {
                        arr.push({
                            isExpanded: true,
                            name: "Assignee",
                            users: [],
                            value: ""
                        })
                    }

                    arr = arr.sort((a,b) => a.users.length < b.users.length ? 1 : -1)

                    sprints.forEach((sprint, index) => {
                        sprint.isExpanded = false;
                        let tmp = []
                        arr.forEach((x, arrIndex) => {
                            tmp.push({
                                key: `${index}_${arrIndex}_${x.name}`,
                                ...x,
                                tasksArray: tasks,

                                conditions: [
                                    {
                                        AssigneeUserId: {$in: x.users}
                                    }
                                ],

                                searchKey: "AssigneeUserId",
                                indexName: "groupByAssigneeIndex",
                                searchCondition: ":",
                                searchValue: x.value.length ? x.value.split("_") : '[]'
                            });
                        })

                        // sprint.items = tmp.filter((x) => x.tasksArray.length || !x.users.length).sort((a, b) => a.users.length < b.users.length ? 1 : -1);
                        sprint.items = tmp;
                    })
                    return;
                // })
                // .catch((error) => {
                //     console.error("ERROR in get groups: ", error);
                //     return;
                // })
            } else if(type === 2) {
                // PRIOTITIES
                indexKey.value = "priorityIndex";
                arr = priorities.value.map((x) => ({...x, isExpanded: true, image: x.statusImage}));
    
                sprints.forEach((sprint, index) => {
                    sprint.isExpanded = false;
                    let tmp = []
                    arr.forEach((x, arrIndex) => {
                        tmp.push({
                            key: `${index}_${arrIndex}_${x.name}`,
                            ...x,
                            image: x.statusImage,
                            tasksArray: tasks,
                            conditions: [
                                {
                                    Task_Priority: {$eq: x.value}
                                }
                            ],

                            searchKey: "Task_Priority",
                            indexName: "groupByPriorityIndex",
                            searchCondition: ":=",
                            searchValue: x.value
                        });
                    })

                    sprint.items = tmp;
                })
            } else if(type === 3) {
                // DUE DATE
                indexKey.value = "dueDateIndex";
                let dt = new Date();
                let todayS = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() / 1000;
                let currentDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getDay();
                let daysRemaining = 6 - currentDay
                let dayHrs = 24 * 60 * 60 * 1000;
    
                let items = [];
    
                for (let i = 0; i <= daysRemaining; i++) {
                    let dateSeconds = (todayS * 1000) + (i * dayHrs);
                    let dayName = (dateSeconds/1000) === todayS ? "Today" : weekDays.value[new Date(dateSeconds).getDay()];
    
                    items.push({
                        name: dayName,
                        value: dayName.toUpperCase(),
                        operation: "eq",
                        searchCondition: ":=",
                        isExpanded: true,
                        seconds: dateSeconds / 1000
                    })
                }
    
                items.splice(1, 0, {
                    name: "Overdue",
                    textColor: "red",
                    value: "OVERDUE",
                    operation: "lt",
                    searchCondition: ":>",
                    isExpanded: true,
                    seconds: todayS-1
                });
    
                items = [
                    ...items,
                    {
                        name: "Next",
                        value: "NEXT",
                        operation: "gt",
                        searchCondition: ":<",
                        isExpanded: true,
                        seconds: ((todayS * 1000) + ((daysRemaining + 1) * dayHrs)) / 1000
                    },
                    {
                        name: "No Due Date",
                        value: "NO_DUE_DATE",
                        operation: "non",
                        searchCondition: ":=",
                        isExpanded: true,
                        seconds: 0
                    }
                ]

                arr = items;

                let checkCase = (op, key, seconds, dateFormat = false) => {
                    switch(op) {
                        case "eq":
                            if (dateFormat) {
                                return {
                                    [key]: {
                                        dbDate: {
                                            $gte: new Date(seconds * 1000),
                                            $lte: new Date(new Date(seconds * 1000).setHours(23,59,59))
                                        }
                                    }
                                }
                            } else {
                                return {
                                    [key]: {
                                        dbDate: {
                                            $gte: seconds,
                                            $lte: seconds + dayHrs
                                        }
                                    }
                                }
                            }
                            // return `${key} :>= ${seconds} && ${key} :<= ${seconds + dayHrs}`

                        case "lt":
                            if (dateFormat) {
                                return {
                                    [key]: {
                                        dbDate: {
                                            $lte: seconds,
                                        }
                                    }
                                }
                            } else {
                                return {
                                    [key]: {
                                        dbDate: {
                                            $$lte: seconds,
                                        }
                                    }
                                }
                            }
                            // return `${key} :<= ${seconds + dayHrs}`

                        case "gt":
                            if (dateFormat) {
                                return {
                                    [key]: {
                                        dbDate: {
                                            $gte: seconds,
                                        }
                                    }
                                }
                            } else {
                                return {
                                    [key]: {
                                        dbDate: {
                                            $gte: seconds,
                                        }
                                    }
                                }
                            }
                            // return `${key} :>= ${seconds}`

                        default:
                            return {[key]: null}
                    }
                }

                sprints.forEach((sprint, index) => {
                    sprint.isExpanded = false;
                    let tmp = [];
                    arr.forEach((x, arrIndex) => {
                        let conditions = [checkCase(x.operation, "DueDate", x.seconds)].filter((x) => x);
                        let mongoConditions = [checkCase(x.operation, "DueDate", x.seconds, true)].filter((x) => x);
                        let obj = {
                            key: `${index}_${arrIndex}_${x.name}`,
                            ...x,
                            tasksArray: tasks,
    
                            searchKey: "DueDate",
                            indexName: "groupByDueDateIndex",
                            searchValue: x.value === "NO_DUE_DATE" ? 0 : x.seconds,
                        }
                        if(conditions?.length) {
                            obj.conditions = conditions;
                            obj.mongoConditions = mongoConditions;
                        }
                        tmp.push({...obj})
                    })
    
                    sprint.items = tmp;
                })
            }

            // MAINTAIN PREVIOUSLY EXPANDED
            if (!isBoard) {
                sprints.forEach((sprint) => {
                    groupedTasks.value.forEach((sprint2) => {
                        if(sprint.id === sprint2.id) {
                            sprint.isExpanded = false;
                            sprint.items.forEach((item) => {
                                sprint2.items.forEach((item2) => {
                                    if(item.name === item2.name) {
                                        item.isExpanded = item2.isExpanded;
    
                                        item.tasksArray = item.tasksArray.sort((x, y) => x[indexKey.value] > y[indexKey.value] ? 1 : -1);
                                        item.tasksArray.forEach((task, index) => {
                                            if(task[indexKey.value] === undefined) {
                                                task[indexKey.value] = index;
                                                updateTaskKanbanIndex(indexKey.value ,task, index);
                                            }
                                            item2.tasksArray.forEach((task2) => {
                                                if(task.id === task2.id) {
                                                    task.isExpanded = task2.isExpanded;
    
                                                    task.subtaskArray = task.subtaskArray.sort((x, y) => x[indexKey.value] > y[indexKey.value] ? 1 : -1);
                                                    task.subtaskArray.forEach((subTask, index2) => {
                                                        if(subTask[indexKey.value] === undefined) {
                                                            subTask[indexKey.value] = index2;
                                                            updateTaskKanbanIndex(indexKey.value ,subTask, index2);
                                                        }
                                                    })
                                                }
                                            })
                                        })
                                    }
                                })
                            })
    
                        }
                    })
                })
            }

            if(sprints && sprints.length) {
                if((sprints[0].deletedStatusKey === undefined || sprints[0].deletedStatusKey === 0) && fetchTask === true) {
                    sprints[0].isExpanded = true;
                    expandedSprint.value = sprints[0].id;
                }

                if(refetch === true && fetchTask === true) {
                    let promises = [];
                    sprints[0].items.forEach((item) => {
                        promises.push(
                            getSprintTasks({projectId: firstId(project._id), sprintId: firstId(sprints[0]?.id, sprints[0]?._id), item, fetchNew: lView == 'table' ? refetch : true,projectData: project, indexName: item.indexName, groupType: lView,resetTable:resetTable})
                        )
                    })
                    Promise.allSettled(promises)
                    .then(() => {
                        groupedTasks.value = sprints;
                        cb(groupedTasks.value)
                        // getTaskArray();

                        const sprintData = sprints[0];

                        getMongoDBUpdate({
                            projectId: project._id,
                            sprintId: sprintData.id ? sprintData.id : sprintData._id,
                            projectData: project,
                            groupBy: {type: type,items: sprintData.items?.map((x) => ({key: `${x.searchKey}_${x.searchValue}`, value: x.searchValue, name: x.name}))},
                            currentView: lView == 'table' ? 'tableTasks' : 'tasks'
                        });
                    })
                    .catch((error) => {
                        groupedTasks.value = sprints;
                        cb(groupedTasks.value)
                        console.error("ERROR in toggleSprints > Promise.allSettled: ", error);
                    })
                } else {
                    groupedTasks.value = sprints;
                    cb(groupedTasks.value)
                    // getTaskArray();
                }
            } else {
                cb([])
            }
        } catch (error) {
            cb([])
            console.error('groupBy Error: ',error);
        }
    }

    function checkCase(op, todayS, seconds) {
        const dayHrs = 24 * 60 * 60 * 1000;

        switch(op) {
            case "eq":
                return todayS <= seconds && (((todayS * 1000) + dayHrs)/1000) > seconds;
            case "lt":
                return todayS > seconds; // compared second less than todayS
            case "gt":
                return todayS < seconds; // compared second greater than todayS
        }
    }

    function searchMongoDBTasks({filterQuery,searchStr,query_by,filterUsers,projectData,showArchived}) {
        if(permit === null && projectData.isGlobalPermission === false){
            return;
        }
        dispatch("projectData/searchTask",
            [
                {
                    $match: {
                        $and: [
                            {
                                $and:[
                                    {ProjectID: {objId: {$in : [projectData._id]}}},
                                    {deletedStatusKey: { $in: [showArchived ? 2 : 0] }}
                                ]
                            },
                            {...filterQuery},
                            {
                                ...(searchStr && searchStr?.length && {
                                    ...query_by
                                }),
                            },
                            {
                                ...(filterUsers && filterUsers.length ?  {AssigneeUserId:{$in:filterUsers}} : {}),
                            },
                            {
                                ...((permit === undefined || permit === true || permit === 2) ? {} : {AssigneeUserId: {$in: [userId.value]}})
                            }
                        ],
                    }
                }
            ]
        )
        .catch((error) => {
            console.error("ERROR in search tasks: ", error);
        })
    }


    return {
        groupBy,
        checkCase,
        getSprintTasks,
        getMongoDBUpdate,
        searchMongoDBTasks,
        refetchSprintBoardTasks,
    }
}

export const clearFilterSignal = ref(0);

