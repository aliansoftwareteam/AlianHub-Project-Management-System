import * as actions from "./actions.js";
import * as mutations from './mutations.js';
export default {
    namespaced: true,
    state: {
        allProjects: [],
        tasks: {},
        tableTasks:{},
        estimates: [],
        closeProjects:[],
        items: [],
        currentProjectDetails: {},
        searchedTasks: [],
        searchedProjects: [],
        projectTemplate : [],
        defaultTemplate : [],
        mongoUpdatedTask: {},
        sprints: {},
        folders: {},
        getTaskSnapShotPayload: {},
        getPaginatedTaskPayload: [],
        getTableTaskPayload: [],
        taskDetailData: {},
        taskDetailPayloadId: {},
        allTaskData: []
    },
    getters: {
        mongoUpdatedTask: state => state.mongoUpdatedTask,
        allProjects: state => state.allProjects,
        personalProject: (state) => (state.allProjects?.data || []).find((x) => x.isPersonal === true) || null,
        projects: (state) => {
            if(state.allProjects && state.allProjects.data) {
                return {...state.allProjects, data: state.allProjects.data.filter((x) => x.statusType !== "close" && !x.isPersonal)}
            } else {
                return [];
            }
        },
        closeProject: (state) => {
            if(state.allProjects && state.allProjects.data) {
                return {...state.allProjects, data: state.allProjects.data.filter((x) => x.statusType == "close" && !x.isPersonal)}
            } else {
                return [];
            }
        },
        assignproject: (state) => {
            if(state.allProjects && state.allProjects.data) {
                return {...state.allProjects, data: state.allProjects.data.filter((x) => x.statusType !== "close" && !x.isPersonal && x.AssigneeUserId.includes(localStorage.getItem("userId")))}
            } else {
                return [];
            }
        },
        onlyActiveProjects: (state) => {
            if(state.allProjects && state.allProjects.data) {
                return {...state.allProjects, data: state.allProjects.data.filter((x) => x.statusType !== "close" && !x?.deletedStatusKey && !x.isPersonal)}
            } else {
                return [];
            }
        },
        tasks: state => state.tasks,
        tableTasks : state => state.tableTasks, 
        estimates: state => state.estimates,
        projectTasks: state => state.items,
        currentProjectDetails: state => state.currentProjectDetails,
        searchedTasks: state => state.searchedTasks,
        projectTemplate : state => state.projectTemplate,
        defaultTemplate : state => state.defaultTemplate,
        customFieldList: state => state.customFieldList,
        sprints: state => JSON.parse(JSON.stringify(state.sprints)),
        folders: state => JSON.parse(JSON.stringify(state.folders)),
        searchedProjects : state => state.searchedProjects,
        paginatedTaskPayload: state => state.getPaginatedTaskPayload,
        tableTaskPayload: state => state.getTableTaskPayload,
        gettaskDetailData: state => state.taskDetailData,
        getTaskDetailPayloadId: state => state.taskDetailPayloadId,
        alltasks: state => state.allTaskData
    },
    mutations: mutations,
    actions: actions
}