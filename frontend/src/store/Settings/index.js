import * as actions from "./actions"
import * as mutations from "./mutations"

export default {
    namespaced: true,

    state: {
        companies: [],
        roles: [],
        rawRules: [],
        withoutOwnerRoles: [],
        rules: [],
        companyUserStatus: [],
        fileExtentions: [],
        status: [
            {
                key: 1,
                name: "Pending"
            }, {
                key: 2,
                name: "Accepted"
            }, {
                key: 3,
                name: "Rejected"
            }
        ],
        permissions: [
            {
                key: null,
                name: "None"
            },  {
                key: false,
                name: "Read"
            }, {
                key: true,
                name: "Read & Write"
            }
        ],
        designations: [],
        projectSkills: [],
        companyUserDetail: {},
        companyOwnerDetail: {},
        companyUsers: [],
        projectMilestone:[],
        projectTabComponents:[],
        companyPriority: [],
        companyDateFormat: {},
        notificationSettings: {},
        taskType : [],
        category:[],
        milestoneweeklyrange:[],
        taskStatus : [],
        teams : [],
        customFields: [],
        restrictedExtensions:[],
        finalCustomFields: [],
        TimeTracker:[],
        TaskStatusArray:[],
        projectStatusArray:[],
        currencyArray:[],
        projectStaus:[],
        taskTypeArray:[],
        projectRules: [],
        projectRawRules : [],
        selectedCompanyId : '',
        planFeatureDisplay: [],
        socketInstance: {},
        projectTaskType : [],
        projectStatusStore : [],
        projectTaskStatus : []
    },

    getters: {
        fileExtentions: state => state.fileExtentions,
        companies: state => state.companies,
        status: state => state.status,
        roles: state => state.roles, 
        withoutOwnerRoles: state => state.withoutOwnerRoles, 
        rules: state => state.rules, 
        rawRules: state => JSON.parse(JSON.stringify(state.rawRules)), 
        companyUserStatus: state => state.companyUserStatus, 
        permissions: state => state.permissions, 
        designations: state => state.designations,
        projectSkills: state => state.projectSkills,
        companyUserDetail: state => state.companyUserDetail,
        companyOwnerDetail: state => state.companyOwnerDetail,
        companyUsers: state => state.companyUsers,
        projectMilestoneStatus: state => state.projectMilestone,
        projectTabComponents: state => state.projectTabComponents,
        companyPriority: state => state.companyPriority,
        companyDateFormat: state => state.companyDateFormat,
        notificationSettings: state => state.notificationSettings,
        taskType: state => JSON.parse(JSON.stringify(state.taskType)),
        category: state => state.category,
        milestoneweeklyrange:state => state.milestoneweeklyrange,
        taskStatus: state => JSON.parse(JSON.stringify(state.taskStatus)),
        teams: state => state.teams,
        customFields: state => state.customFields,
        restrictedExtensions:state=>state.restrictedExtensions,
        finalCustomFields:state => state.finalCustomFields,
        TimeTracker:state => state.TimeTracker,
        AllTaskStatus:state => JSON.parse(JSON.stringify(state.TaskStatusArray)),
        AllProjectStatus:state => state.projectStatusArray,
        allCurrencyArray:state => state.currencyArray,
        projectStaus: state => JSON.parse(JSON.stringify(state.projectStaus)),
        AllTaskType: state => state.taskTypeArray,
        projectRules: state => state.projectRules,
        projectRawRules: state => JSON.parse(JSON.stringify(state.projectRawRules)), 
        selectedCompany: state => state.companies.filter((cmp) => cmp._id === state.selectedCompanyId)[0] || {},
        planFeatureDisplay: state => state.planFeatureDisplay,
        getSocketInstance: state => state.socketInstance,
        projectTaskType: state => JSON.parse(JSON.stringify(state.projectTaskType)),
        projectStatusStore: state => JSON.parse(JSON.stringify(state.projectStatusStore)),
        projectTaskStatus: state => JSON.parse(JSON.stringify(state.projectTaskStatus))
    },

    mutations,

    actions
}