/*
*
*************************************************************************************************
* IMPORT ALL REQUIRED DEFAULT DATA WHEN NEW COMPANY PROFILE WILL REGISTERED
*************************************************************************************************
*
*/
const currency  = require('../utils/currency.json') ;
const TaskStatus  = require('../utils/Tempates/task_status') ;
const TaskType  = require('../utils/Tempates/task_type') ;
const ProjectStatus = require('../utils/Tempates/project_status')
const { settingsCollectionDocs } = require('../Config/collections');
const logger = require("../Config/loggerConfig");
const { MongoDbCrudOpration } = require("./mongo-handler/mongoQueries");
const { SCHEMA_TYPE } = require("../Config/schemaType");
const {defaultCustomFields} = require("../utils/Tempates/customFields");
const {defaultProjectTours} = require("../utils/Tempates/projectTours");
const { addSprintFun } = require('../Modules/Sprints/controller');
const { updateMainChat } = require('../Modules/MainChats/controller');
const { toSlug } = require('../Modules/settings/ProjectSkills/skillRules');

// Safe to hardcode here and nowhere else: importCompanyRoles below is what creates role key 3 as
// "Member", so at seed time the number and the role are the same thing. Runtime code must never
// assume it — a company can rename or add roles afterwards.
const MEMBER_ROLE_TYPE = 3;

// What a brand-new company gives the Member role. Before this existed the rules were seeded with
// empty role lists, so an invited teammate saw a product with almost everything hidden and the
// owner had to set ~100 switches by hand before anyone could work.
//
// These are not invented. Two established companies were read and compared: where both owners had
// independently made the same choice, that choice is the default; where they differed, the more
// restrictive of the two is used, never below Read if both allowed at least Read. Keys absent from
// this map get nothing, so anything unlisted or newly added fails closed.
//
// false = Read, true = Read & Write, a number = the "Own (1) / Everyone (2)" selection fields.
const MEMBER_DEFAULT_PERMISSIONS = {
    // Sections. `settings` and `artificial_intelligence` are deliberately absent.
    project: false,
    task: true,
    chat: true,
    sheet_settings: false,

    // Projects: members work inside them, they do not administer them.
    project_list: false,
    public_projects: false,
    private_projects: 1,
    project_details: false,

    // Tasks: the day-to-day job, so this group is open.
    task_list: true,
    task_create: true,
    sub_task_create: true,
    task_name_edit: true,
    task_total_estimate: true,
    task_status: true,
    task_assignee: true,
    task_priority: true,
    task_due_date: true,
    task_start_date: true,
    task_description: true,
    task_checklist: true,
    task_checklist_assign_remove: true,
    task_attachments: true,
    task_tag: true,
    task_type: true,
    task_comment: true,
    task_details: true,
    task_duplicate: true,
    task_move: true,
    task_merge: true,
    task_archive: true,
    task_delete: true,
    task_convert_to_list: true,
    task_convert_to_subtask: true,
    convert_to_task: true,
    task_activity_log: false,
    task_estimated_hours: 1,
    show_tasks: 1,
    queue_list: true,
    list_view_column: true,
    advance_search: true,

    // Chat.
    one_to_one_chat: true,
    chat_category: true,
    chat_channel: true,

    // Timesheets: their own only.
    user_timesheet: 1,
};

//IMPORT CURRENCY
exports.importCurrency = (companyName) => {
    return new Promise(async(resolve, reject) => {
        try {
            const type = SCHEMA_TYPE.CURRENCY_LIST;
            let promises = [];
            await MongoDbCrudOpration(companyName, {
                type: type,data:[{}]
            }, "deleteMany");
            const dataObj = {
                type : type,
                data: [currency]
            }
            promises.push(MongoDbCrudOpration(companyName, dataObj, "insertMany"))
            Promise.allSettled(promises)
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

//IMPORT PROJECT CATEGORIES SETTING
exports.importProjectCategories = (companyName) => {
    const dataArray = [
        'Fixed Price',
        'Hourly Price',
        'In House'
    ]
    let dataObj = {
        name: settingsCollectionDocs.PROJECT_CATEGORY,
        settings :dataArray
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.PROJECT_CATEGORY},
            {
                $set: { ...dataObj },
            },
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

//IMPORT HOURLY MILSTONE RANGE
exports.importHourlyMilestoneRange = (companyName) => {
    const dataArray = [
        'Monthly',
        'Weekly'
    ]
    let dataObj = {
        name: settingsCollectionDocs.HOURLY_MILESTONE_RANGE,
        settings :dataArray
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.HOURLY_MILESTONE_RANGE},
            {
                $set: { ...dataObj },
            },
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

//IMPORT HOURLY MILSTONE RANGE
exports.importHourlyMilestoneWeeklyRange = (companyName) => {
    let dataObj = {
        name: settingsCollectionDocs.HOURLY_MILESTONE_WEEKLY_RANGE,
        settings :['Mon - Sun']
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.HOURLY_MILESTONE_WEEKLY_RANGE},
            {
                $set: { ...dataObj },
            },
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

//IMPORT PROJECT PRIORITIES SETTING
exports.importProjectPriorities = (companyName) => {
    const dataArray = [
        {
            'name': "High",
            'value': "HIGH",
            "image": 'taskPriorities/priority_high.png',
            'statusImage': 'taskPriorities/priority_high.png',
            'isDeleted': false
        },
        {
            'name': "Medium",
            'value': "MEDIUM",
            "image": 'taskPriorities/priority_medium.png',
            'statusImage': 'taskPriorities/priority_medium.png',
            'isDeleted': false
        },
        {
            'name': "Low",
            'value': "LOW",
            "image":'taskPriorities/priority_low.png',
            'statusImage': 'taskPriorities/priority_low.png',
            'isDeleted': false
        }
    ]
    let dataObj = {
        name: settingsCollectionDocs.TASK_PRIORITIES,
        settings :dataArray
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.TASK_PRIORITIES},
            {
                $set: { ...dataObj },
            },
            { upsert: true }
        ]
    }

    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

//IMPORT PROJECT MILESTONE SETTING
exports.importProjectMilestone = (companyName) => {
    const dataArray = [
        {
            'backgroundColor': "#ff9600",
            'textColor': "#ffffff",
            'name': "Not Funded",
            'value': "NOT_FUNDED",
            'isDefault': false,
            'isDeleted': false,
            'isFuture': false,
            'isPast': true,
            'milestoneStatusDate': new Date(),
            'isCount' : 0
        },
        {
            'backgroundColor': "#18bbd0",
            'textColor': "#ffffff",
            'name': "Funded",
            'value': "FUNDED",
            'isDefault': true,
            'isDeleted': false,
            'isFuture': false,
            'isPast': true,
            'milestoneStatusDate': new Date(),
            'isCount' : 0
        },
        {
            'backgroundColor': "#1a78bc",
            'textColor': "#ffffff",
            'name': "Estimated Release",
            'value': "ESTIMATED_RELEASE",
            'isDefault': false,
            'isDeleted': false,
            'isFuture': true,
            'isPast': false,
            'milestoneStatusDate': new Date(),
            'isCount' : 0
        },
        {
            'backgroundColor': "#8e7bff",
            'textColor': "#ffffff",
            'name': "Release Request Sent",
            'value': "RELEASE_REQUEST_SENT",
            'isDefault': false,
            'isDeleted': false,
            'isFuture': false,
            'isPast': true,
            'milestoneStatusDate': new Date(),
            'isCount' : 0
        },
        {
            'backgroundColor': "#28c76f",
            'textColor': "#ffffff",
            'name': "Released",
            'value': "RELEASED",
            'isDefault': true,
            'isDeleted': false,
            'isFuture': true,
            'isPast': true,
            'milestoneStatusDate': new Date(),
            'isCount' : 0
        },
        {
            'backgroundColor': "#ff5252",
            'textColor': "#ffffff",
            'name': "Cancelled",
            'value': "CANCELLED",
            'isDefault': true,
            'isDeleted': false,
            'isFuture': false,
            'isPast': true,
            'milestoneStatusDate': new Date(),
            'isCount' : 0
        },
        {
            'backgroundColor': "#e329d1",
            'textColor': "#ffffff",
            'name': "Refunded",
            'value': "REFUNDED",
            'isDefault': true,
            'isDeleted': false,
            'isFuture': false,
            'isPast': true,
            'milestoneStatusDate': new Date(),
            'isCount' : 0
        }
    ]
    let dataObj = {
        name: settingsCollectionDocs.PROJECT_MILESTONE_STATUS,
        settings :dataArray,
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.PROJECT_MILESTONE_STATUS},
            {$set: { ...dataObj }},
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

//IMPORT DEFAULT DATE FORMAT
exports.importCommonDateFormat = (companyName) => {
    let dataObj = {
        name: settingsCollectionDocs.COMMON_DATE_FORMAT,
        settings : [{
            'dateFormat' : 'DD/MM/YYYY'
        }]
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.COMMON_DATE_FORMAT},
            {$set: { ...dataObj }},
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

// IMPORT FILE EXTENSIONS
exports.importCommonExtension = (companyName) => {
    const extensionsArray = [
        '.docm', '.dotm', '.xlsm', '.xltm', '.xlam', '.pptm', '.potm', '.ppam', '.ppsm', '.sldm', '.doc', '.docx', '.dot', '.dotx', '.rtf', '.wiz',
        '.pot', '.potx', '.ppa', '.pps', '.ppsx', '.ppt', '.pptx', '.pwz', '.xla', '.xlb', '.xlcxlk', '.xls', '.xlsb', '.xlsx', '.xlt', '.xltx', '.xlw',
        '.cal', '.frm', '.mbx', '.mif', '.mpc', '.mpd', '.mpp', '.mpt', '.mpv', '.win', '.wmf', '.arj', '.bz2', '.cab', '.gz', '.gzip', '.lha', '.lzh', 
        '.rar', '.rpm', '.tar', '.tgz', '.z', '.zip', '.cfm', '.css', '.htc', '.htm', '.html', '.htt', '.htx', '.idc', '.nsf', '.plg', '.txt', '.ulx', 
        '.cmp', '.eps', '.prn', '.ps', '.abf', '.atm', '.awe', '.fdf', '.ofm', '.p65', '.pdd', '.pdf', '.a3m', '.a4m', '.bin', '.hqx', '.rs',
        '.aff', '.affc', '.aif', '.aiff', '.aiffc', '.au', '.m3u', '.mid', '.mod', '.mp3', '.ra', '.rmi', '.snd', '.voc', '.wav', '.vcf', '.xml', '.xsf',
        '.asf', '.asx', '.avi', '.lsf', '.lsx', '.m1v', '.mmm', '.mov', '.movie', '.mp2', '.mp4', '.mpa', '.mpe', '.mpeg', '.mpg', '.mpv2', '.qt', '.vdo',
        '.art', '.bmp', '.dib', '.gif', '.ico', '.jfif', '.jpe', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.xbm', '.csv', '.psd', '.mkv', '.json', '.xd', '.cdr'
    ]
    let dataArray = extensionsArray.map((item) => {
        let res = {
            'name': item, 
            'systemGenerated': true 
        }
        return res;
    })

    let dataObj = {
        name: settingsCollectionDocs.ALLOWED_FILE_EXTENSION,
        settings :dataArray,
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.ALLOWED_FILE_EXTENSION},
            {$set: { ...dataObj }},
            { upsert: true }
        ]
    }

    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

// IMPORT COMPANY USER STATUS
exports.importCompanyUserStatus = (companyName) => {
    let status = [
        {
            name: "Pending",
            key: 1,
        },
        {
            name: "Accepted",
            key: 2,
        },
        {
            name: "Rejected",
            key: 3,
        }
    ];
    let dataObj = {
        name: settingsCollectionDocs.COMPANY_USER_STATUS,
        settings :status,
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.COMPANY_USER_STATUS},
            {$set: { ...dataObj }},
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

// IMPORT COMPANY RULES 88888888
exports.importCompanyRules = async(companyName,type,projectId) => {
    // let id = "";
    let globalRulesMap = {};
    let rules = [
        {
            name: "Project",
            key: "project",
            desc: "",
            isParent: true,
            roles: [],
            createAt: new Date(),
            updateAt: new Date()
        }, {
            name: "Task",
            key: "task",
            desc: "",
            isParent: true,
            parentId: "",
            roles: [],
            createAt: new Date(),
            updateAt: new Date()
        }, {
            name: "Company Settings",
            key: "settings",
            desc: "",
            isParent: true,
            parentId: "",
            roles: [],
            createAt: new Date(),
            updateAt: new Date()
        }, {
            name: "Sheet Settings",
            key: "sheet_settings",
            desc: "",
            isParent: true,
            parentId: "",
            roles: [],
            createAt: new Date(),
            updateAt: new Date()
        },
        {
            name: "Artificial Intelligence",
            key: "artificial_intelligence",
            desc: "",
            isParent: true,
            parentId: "",
            roles: [],
            createAt: new Date(),
            updateAt: new Date()
        },
        {
            name: "Chat",
            key: "chat",
            desc: "",
            isParent: true,
            parentId: "",
            roles: [],
            createAt: new Date(),
            updateAt: new Date()
        },
    ];

    let obj = {
        desc: "",
        isParent: false,
        parentId: "",
        roles: [],
    }

    let subProjectRules = [
        {
            name: "Project List",
            key: "project_list",
            dependency: "project",
            desc: ""
        }, {
            name: "Public Project List",
            key: "public_projects",
            dependency: "project",
            desc: ""
        }, {
            name: "Private Project List",
            key: "private_projects",
            dependency: "project",
            desc: "",
            selectionField: true
        }, {
            name: "Project Create",
            key: "project_create",
            dependency: "project_list",
            desc: ""
        }, {
            name: "Project Name Edit",
            key: "project_name_edit",
            dependency: "project_list",
            desc: ""
        }, {
            name: "Project Sprint Create",
            key: "project_sprint_create",
            dependency: "project_list",
            desc: ""
        }, {
            name: "Project Folder Create",
            key: "project_folder_create",
            dependency: "project_list",
            desc: ""
        }, {
            name: "Project Folder Name Edit",
            key: "project_folder_name_edit",
            dependency: "project_list",
            desc: ""
        }, {
            name: "Project Sprint Name Edit",
            key: "project_sprint_name_edit",
            dependency: "project_list",
            desc: ""
        },
        {
            name: "Project Delete",
            key: "project_delete",
            dependency: "project_list",
            desc: ""
        },
        {
            name: "Folder Archive",
            key: "folder_archive",
            dependency: "project_list",
            desc: ""
        },
        {
            name: "Folder Delete",
            key: "folder_delete",
            dependency: "project_list",
            desc: ""
        },
        {
            name: "Folder Restore",
            key: "folder_restore",
            dependency: "project_list",
            desc: ""
        },
        {
            name: "Sprint Archive",
            key: "sprint_archive",
            dependency: "project_list",
            desc: ""
        },
        {
            name: "Sprint Delete",
            key: "sprint_delete",
            dependency: "project_list",
            desc: ""
        },
        {
            name: "Sprint Restore",
            key: "sprint_restore",
            dependency: "project_list",
            desc: ""
        },
        {
            name: "Sprint Type Change",
            key: "sprint_type_change",
            dependency: "project_list",
            desc: ""
        },

        {
            name: "Project Details",
            key: "project_details",
            dependency: "project_list",
            desc: ""
        }, {
            name: "Project Status Change",
            key: "project_status_change",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Assignee",
            key: "project_assignee",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Category",
            key: "project_category",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Source",
            key: "project_source",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Type",
            key: "project_type",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Currency",
            key: "project_currency",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Amount",
            key: "project_amount",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Start Date",
            key: "project_start_date",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project End Date",
            key: "project_end_date",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Due Date",
            key: "project_due_date",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Close",
            key: "project_close",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Description",
            key: "project_description",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Checklist",
            key: "project_checklist",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Checklist Assign/Remove",
            key: "project_checklist_assign_remove",
            dependency: "project_details",
            desc: ""
        }, {
            name: "Project Attachments",
            key: "project_attachments",
            dependency: "project_details",
            desc: ""
        },
        {
            name: "Project Milestone",
            key: "project_milestone",
            dependency: "project_details",
            desc: ""
        },
        {
            name: "View List",
            key: "view_list",
            dependency: "project_details",
            desc: ""
        },
        {
            name: "Custom Field",
            key: "project_custom_field",
            dependency: "project_details",
            desc: ""
        }
    ];

    let taskRules = [
        {
            name: "Task List",
            key: "task_list",
            dependency: "task",
            desc: ""
        }, {
            name: "Task Create",
            key: "task_create",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Sub Task Create",
            key: "sub_task_create",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Task Name Edit",
            key: "task_name_edit",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Task Total Estimate",
            key: "task_total_estimate",
            dependency: "task_list",
            desc: ""
        },  {
            name: "Task Status",
            key: "task_status",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Task Assignee",
            key: "task_assignee",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Task Priority",
            key: "task_priority",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Task Due Date",
            key: "task_due_date",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Task Estimated Hours",
            key: "task_estimated_hours",
            dependency: "task_list",
            desc: "",
            selectionField: true
        }, {
            name: "Task Description",
            key: "task_description",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Task Checklist",
            key: "task_checklist",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Task Checklist Assign/Remove",
            key: "task_checklist_assign_remove",
            dependency: "task_list",
            desc: ""
        }, {
            name: "Task Attachments",
            key: "task_attachments",
            dependency: "task_list",
            desc: ""
        },
        {
            name: "Show Tasks",
            key: "show_tasks",
            dependency: "task",
            desc: "",
            selectionField: true
        }, {
            name: "Custom Field",
            key: "task_custom_field",
            dependency: "task_list",
            desc: ""
        },
        {
            name: "Task Tag",
            key: "task_tag",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Start Date",
            key: "task_start_date",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Activity Log",
            key: "task_activity_log",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Convert to List",
            key: "task_convert_to_list",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Convert to Subtask",
            key: "task_convert_to_subtask",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Duplicate",
            key: "task_duplicate",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Merge",
            key: "task_merge",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Move",
            key: "task_move",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Archive",
            key: "task_archive",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Delete",
            key: "task_delete",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Comment",
            key: "task_comment",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Detail",
            key: "task_details",
            dependency: "task",
            desc: ""
        },
        {
            name: "Queue List",
            key: "queue_list",
            dependency: "task",
            desc: ""
        },
        {
            name: "Advance Search",
            key: "advance_search",
            dependency: "task",
            desc: ""
        },
        {
            name: "List View Column",
            key: "list_view_column",
            dependency: "task",
            desc: ""
        },
        {
            name: "Task Type",
            key: "task_type",
            dependency: "task",
            desc: ""
        },
        {
            name: "Convert to Task",
            key: "convert_to_task",
            dependency: "task",
            desc: ""
        }
    ];

    let settingRules = [
        {
            name: "Edit Company",
            key: "settings_edit_company",
            dependency: "settings",
            desc: ""
        }, {
            name: "Task Priority",
            key: "settings_task_priority",
            dependency: "settings",
            desc: ""
        }, {
            name: "File Extensions",
            key: "settings_file_extensions",
            dependency: "settings",
            desc: ""
        }, {
            name: "Project Milestone Status",
            key: "settings_project_milestone_status",
            dependency: "settings",
            desc: ""
        }, {
            name: "Invite Member",
            key: "settings_invite_member",
            dependency: "settings",
            desc: ""
        }, {
            name: "Member List",
            key: "settings_member_list",
            dependency: "settings",
            desc: ""
        }, {
            name: "Create Team",
            key: "settings_create_team",
            dependency: "settings",
            desc: ""
        }, {
            name: "Team List",
            key: "settings_team_list",
            dependency: "settings",
            desc: ""
        }, {
            name: "Project List",
            key: "settings_project_list",
            dependency: "settings",
            desc: ""
        }, {
            name: "Security & Permissions",
            key: "settings_security_permissions",
            dependency: "settings",
            desc: ""
        }, {
            name: "Role Management",
            key: "settings_role_management",
            dependency: "settings",
            desc: ""
        }, {
            name: "Designation",
            key: "settings_designation",
            dependency: "settings",
            desc: ""
        }, {
            name: "Milestone Weekly Range",
            key: "milestone_weekly_range",
            dependency: "settings",
            desc: ""
        }, {
            name: "Custom Field",
            key: "settings_custom_field",
            dependency: "settings",
            desc: ""
        }
    ];

    let sheet_settings= [
        {
            name: "User Timesheet",
            key: "user_timesheet",
            dependency: "sheet_settings",
            desc: "",
            selectionField: true
        }, {
            name: "Project Timesheet",
            key: "project_timesheet",
            dependency: "sheet_settings",
            desc: "",
            selectionField: true
        }, {
            name: "Workload Timesheet",
            key: "workload_timesheet",
            dependency: "sheet_settings",
            desc: "",
            selectionField: true
        }, {
            name: "Tracker Timesheet",
            key: "tracker_timesheet",
            dependency: "sheet_settings",
            desc: "",
            selectionField: true
        }, {
            name: "Milestone Report",
            key: "milestone_report",
            dependency: "sheet_settings",
            desc: ""
        },
    ]

    let chat_settings = [
        {
            name: "One To One Chat",
            key: "one_to_one_chat",
            dependency: "chat",
            desc: ""
        },
        {
            name: "Chat Category",
            key: "chat_category",
            dependency: "chat",
            desc: ""
        },
        {
            name: "Chat Channel",
            key: "chat_channel",
            dependency: "chat",
            desc: ""
        }
    ]

    let toggleRules = {
        name: "Toggle",
        isParent: true,
        key: "toggle",
        allowAdminForPrivateSpace: true,
        showAllProjects: true,
        showAllTasks: true,
    }

    let aiRules = [
        {
            name: "Per User Token Limit",
            key: "per_user_generate_limit",
            dependency: "artificial_intelligence",
            desc: "",
            selectionField: true
        }
    ]

    if(type === 'project'){
        subProjectRules = subProjectRules.filter((x) => x.key !== 'project_list' &&  x.key !== 'project_create' && x.key !== 'public_projects' && x.key !== 'private_projects');
        let dbType = SCHEMA_TYPE.RULES;
        let findObj = {
            type: dbType,
            data: [
                { projectId: { $exists: false } }
            ]
        };

        try {
            const globalQuerySnapshot = await MongoDbCrudOpration(companyName, findObj, "find");
            // Process and map global rules by key for efficient lookup
            if(globalQuerySnapshot && globalQuerySnapshot?.length){
                globalQuerySnapshot.forEach((doc) => {
                    globalRulesMap[doc.key] = doc;
                });
            } else {
                globalRulesMap = {};    
            }
        } catch (error) {
            logger.error(`Error in getting global rules: ${error.message}`);
            globalRulesMap = {};
        }
    }

    // UPDATE COMPANY DATABASE
    return new Promise( async (resolve, reject) => {
        try {
            let dbType = type === 'project' ? SCHEMA_TYPE.PROJECT_RULES : SCHEMA_TYPE.RULES
            let findObj = {
                type : dbType,
                data : [
                    { projectId: { $exists: false } }
                ]
            }
            let deletePromise;
            await MongoDbCrudOpration(companyName, findObj, "find")
            .then((querySnapshot) => {
                try {
                    let promises = []
                    querySnapshot.forEach((doc) => {
                        let ind = rules.findIndex((x) => x.key === doc.key);
                        if(ind > -1) {
                            rules[ind].roles = doc.roles;
                        } else {
                            ind = subProjectRules.findIndex((x) => x.key === doc.key);
                            if(ind > -1) {
                                subProjectRules[ind].roles = doc.roles;
                            } else {
                                ind = taskRules.findIndex((x) => x.key === doc.key);
                                if(ind > -1) {
                                    taskRules[ind].roles = doc.roles;
                                }
                                else {
                                    ind = settingRules.findIndex((x) => x.key === doc.key);
                                    if(ind > -1) {
                                        settingRules[ind].roles = doc.roles;
                                    } else {
                                        ind = sheet_settings.findIndex((x) => x.key === doc.key);
                                        if(ind > -1) {
                                            sheet_settings[ind].roles = doc.roles;
                                        }else{
                                            ind = aiRules.findIndex((x) => x.key === doc.key);
                                            if(ind > -1) {
                                                aiRules[ind].roles = doc.roles;
                                            } else {
                                                ind = chat_settings.findIndex((x) => x.key === doc.key);
                                                if(ind > -1) {
                                                    chat_settings[ind].roles = doc.roles;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
    
                        if(doc.key === "toggle") {
                            toggleRules = {...toggleRules, ...doc};
                        }
                        promises.push(MongoDbCrudOpration(companyName, {type: dbType,data:[{}]}, "deleteMany"))
                    })
                    deletePromise = Promise.allSettled(promises)
                    .then(() => {
                        return;
                    })
                    .catch((error) => {
                        console.error("ERROR in delete rules: ", error);
                        return;
                    })
                } catch (error) {
                    console.error("ERROR in delete rules: ", error);
                    return;
                }
            })

            deletePromise.then(() => {
                let promises = [];
                let selectionFieldRules = [...subProjectRules]?.filter((x) => x.selectionField)?.map((x) => x.key)

                const applyDefaultRoles = (rule) => {
                    let roles = rule.roles || []
                    let guest = roles.find((y) => y.key === 0) || null
                    let member = roles.find((y) => y.key === MEMBER_ROLE_TYPE) || null
                    const filterRole = globalRulesMap && Object?.keys(globalRulesMap)?.length ? globalRulesMap?.[rule?.key] || null : null;
                    if (filterRole && Object?.keys(filterRole)?.length) {
                        const globalRule = filterRole;
                        if(globalRule){
                            try {
                                roles = JSON.parse(JSON.stringify(globalRule.roles));
                                roles = roles.map(role => {
                                    // Destructuring assignment with rest operator:
                                    // - Extracts 'disabled' property separately  
                                    // - Collects all other properties into 'cleanRole' object using spread operator (...)
                                    // This effectively removes the 'disabled' property while keeping everything else
                                    const { ...cleanRole } = role;
                                    return cleanRole;
                                });
                            } catch (error) {
                                roles = rule.roles || [];
                            }
                        }
                    } else if(!guest) {
                        if(roles.length) {
                            roles.push({
                                key: 0,
                                permission: selectionFieldRules.includes(rule.key) ? 1 : false,
                            })
                        } else {
                            roles = [
                                {
                                    key: 0,
                                    permission: selectionFieldRules.includes(rule.key) ? 1 : false,
                                }
                            ]
                        }
                    }
                    // Only ever ADDS a Member entry. A company that has configured its own already
                    // has a key-3 row here, so re-seeding can never overwrite what an owner chose.
                    if (!member && MEMBER_DEFAULT_PERMISSIONS[rule.key] !== undefined) {
                        roles.push({
                            key: MEMBER_ROLE_TYPE,
                            permission: MEMBER_DEFAULT_PERMISSIONS[rule.key],
                        })
                    }
                    return roles;
                }

                let checkRules = type === 'project' ? rules.filter((x) => x.key === 'project' || x.key === 'task') : rules
                checkRules.forEach((rule) => {
                    rule.roles = applyDefaultRoles(rule);
                    if(type === 'project'){
                        rule.projectId =  projectId
                    }
                })
                const dataObj = {
                    type : dbType,
                    data: [checkRules]
                }
                promises.push(MongoDbCrudOpration(companyName, dataObj, "insertMany"))
                Promise.allSettled(promises)
                .then(async(result) => {
                    promises = [];
                    let dbRules = result.filter((x) => x.status === 'fulfilled').map((x) => x.value);
                    const allData = dbRules[0] || [];
                    if(type !== 'project'){
                        subProjectRules.forEach((rule, index) => {
                            rule.roles = applyDefaultRoles(rule);
                            if(type === 'project'){
                                rule.projectId =  projectId
                            }
                            const subProjectRulesObj = {
                                type : dbType,
                                data : [
                                    {key : rule.key},
                                    {$set: {...obj, ...rule, priorityIndex: index, parentId: dbRules[0].filter((x) => x.key === "project")[0]._id}},
                                    { upsert: true }
                                ]
                            }
                            promises.push(MongoDbCrudOpration(companyName, subProjectRulesObj, "findOneAndUpdate"));
                        })
                        taskRules.forEach((rule, index) => {
                            rule.roles = applyDefaultRoles(rule);
                            if(type === 'project'){
                                rule.projectId =  projectId
                            }
                            const taskRulesObj = {
                                type : dbType,
                                data : [
                                    {key : rule.key},
                                    {$set: {...obj, ...rule, priorityIndex: index, parentId: dbRules[0].filter((x) => x.key === "task")[0]?._id}},
                                    { upsert: true }
                                ]
                            }
                            promises.push(MongoDbCrudOpration(companyName, taskRulesObj, "findOneAndUpdate"));
                        })
                    
                        settingRules.forEach((rule, index) => {
                            rule.roles = applyDefaultRoles(rule);
                            if(type === 'project'){
                                rule.projectId =  projectId
                            }
                            const settingRulesObj = {
                                type : dbType,
                                data : [
                                    {key : rule.key},
                                    {$set: {...obj, ...rule, priorityIndex: index, parentId: dbRules[0].filter((x) => x.key === "settings")[0]?._id}},
                                    { upsert: true }
                                ]
                            }
                            promises.push(MongoDbCrudOpration(companyName, settingRulesObj, "findOneAndUpdate"));
                        })
                        sheet_settings.forEach((rule, index) => {
                            rule.roles = applyDefaultRoles(rule);
                            if(type === 'project'){
                                rule.projectId =  projectId
                            }
                            const sheet_settings_obj = {
                                type : dbType,
                                data : [
                                    {key : rule.key},
                                    {$set: {...obj, ...rule, priorityIndex: index, parentId: dbRules[0].filter((x) => x.key === "sheet_settings")[0]?._id}},
                                    { upsert: true }
                                ]
                            }
                            promises.push(MongoDbCrudOpration(companyName, sheet_settings_obj, "findOneAndUpdate"));
                        })

                        aiRules.forEach((rule, index) => {
                            rule.roles = applyDefaultRoles(rule);
                            if(type === 'project'){
                                rule.projectId =  projectId
                            }
                            const aiRuleObj = {
                                type : dbType,
                                data : [
                                    {key : rule.key},
                                    {$set: {...obj, ...rule, priorityIndex: index, parentId: dbRules[0].filter((x) => x.key === "artificial_intelligence")[0]?._id}},
                                    { upsert: true }
                                ]
                            }
                            promises.push(MongoDbCrudOpration(companyName, aiRuleObj, "findOneAndUpdate"));
                        })
                        chat_settings.forEach((rule, index) => {
                            rule.roles = applyDefaultRoles(rule);
                            if(type === 'project'){
                                rule.projectId =  projectId
                            }
                            const chatRuleObj = {
                                type : dbType,
                                data : [
                                    {key : rule.key},
                                    {$set: {...obj, ...rule, priorityIndex: index, parentId: dbRules[0].filter((x) => x.key === "chat")[0]?._id}},
                                    { upsert: true }
                                ]
                            }
                            promises.push(MongoDbCrudOpration(companyName, chatRuleObj, "findOneAndUpdate"));
                        })
                        const toggleObj = {
                            type : dbType,
                                data : [
                                    {key : toggleRules.key},
                                    {$set: {...toggleRules}},
                                    { upsert: true }
                                ]
                        }
                        promises.push( MongoDbCrudOpration(companyName, toggleObj, "findOneAndUpdate"));
                    }else{
                        subProjectRules.forEach((rule, index) => {
                            rule.roles = applyDefaultRoles(rule);
                            if(type === 'project'){
                                rule.projectId =  projectId
                            }
                            let ruleoBj = [];
                            ruleoBj.push({...obj, ...rule, priorityIndex: index, parentId: dbRules[0].filter((x) => x.key === "project")[0]._id})
                            const subProjectRulesObj = {
                                type : dbType,
                                data : [ruleoBj]
                            }
                            promises.push(MongoDbCrudOpration(companyName, subProjectRulesObj, "insertMany").then((resp) => {
                                allData.push(resp[0]);
                            }))
                        })
                        taskRules.forEach((rule, index) => {
                            rule.roles = applyDefaultRoles(rule);
                            if(type === 'project'){
                                rule.projectId =  projectId
                            }
                            let ruleoBj = [];
                            ruleoBj.push({...obj, ...rule, priorityIndex: index, parentId: dbRules[0].filter((x) => x.key === "task")[0]?._id})
                            const taskRulesObj = {
                                type : dbType,
                                data : [ruleoBj]
                            }
                            promises.push(MongoDbCrudOpration(companyName, taskRulesObj, "insertMany").then((resp) => {
                                allData.push(resp[0]);
                            }));
                        })
                        aiRules.forEach((rule, index) => {
                            rule.roles = applyDefaultRoles(rule);
                            if(type === 'project'){
                                rule.projectId =  projectId
                            }
                            const aiRuleObj = {
                                type : dbType,
                                data : [
                                    {key : rule.key},
                                    {$set: {...obj, ...rule, priorityIndex: index, parentId: dbRules?.[0]?.filter((x) => x?.key === "artificial_intelligence")?.[0]?._id || ''}},
                                    { 
                                        upsert: true,
                                        returnDocument : 'after'
                                    }
                                ]
                            }
                            promises.push(MongoDbCrudOpration(companyName, aiRuleObj, "findOneAndUpdate").then((resp) => {
                                allData.push(resp);
                            }));
                        })
                    }
                    Promise.allSettled(promises)
                    .then(() => {
                        resolve(allData);
                    })
                    .catch((error) => {
                        reject(error);
                    })
                })
                .catch((error) => {
                    console.error("ERROR in add parent rules: ", error);
                })
            })
        } catch (error) {
            reject(error);
        }
    });
}

// IMPORT COMPANY OWNER
exports.importCompanyUserOwner = (companyName, obj) => {
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

// IMPORT COMPANY ROLES
exports.importCompanyRoles = (companyName) => {
    let roles = [
        {
            name: "Guest",
            key: 0,
        },
        {
            name: "Owner",
            key: 1,
        },
        {
            name: "Admin",
            key: 2,
        },
        {
            name: "Member",
            key: 3,
        }
    ];
    let dataObj = {
        name: settingsCollectionDocs.ROLES,
        settings :roles,
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.ROLES},
            {$set: { ...dataObj }},
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Import default notifications settings for user for perticular company 88888888
 * @param {String} companyName 
 */
exports.importUserNotifications = async (companyName, uid) => {

    // Project related notification
    let project = {
        key: "project",
        sectionName: "Project",
        items: [
            {
                name: "Project Create",
                email: false,
                browser: true,
                mobile: true,
                key: "project_create",
            },
            {
                name: "Project Name",
                email: false,
                browser: true,
                mobile: true,
                key: "project_name",
            },
            {
                name: "Project Status Change",
                email: false,
                browser: true,
                mobile: true,
                key: "project_status_change"
            },
            {
                name: "Project Assignee",
                email: false,
                browser: true,
                mobile: true,
                key: "project_assignee"
            },
            {
                name: "Project Lead",
                email: false,
                browser: true,
                mobile: true,
                key: "project_lead"
            },
            {
                name: "Project Category",
                email: false,
                browser: true,
                mobile: true,
                key: "project_category"
            },
            {
                name: "Project Source",
                email: false,
                browser: true,
                mobile: true,
                key: "project_source"
            },
            {
                name: "Project Type",
                email: false,
                browser: true,
                mobile: true,
                key: "project_type"
            },
            {
                name: "Project Currency",
                email: false,
                browser: true,
                mobile: true,
                key: "project_currency"
            },
            {
                name: "Project Amount",
                email: false,
                browser: true,
                mobile: true,
                key: "project_amount"
            },
            {
                name: "Project Start Date",
                email: false,
                browser: true,
                mobile: true,
                key: "project_start_date"
            },
            {
                name: "Project End Date",
                email: false,
                browser: true,
                mobile: true,
                key: "project_end_date"
            },
            {
                name: "Project Due Date",
                email: false,
                browser: true,
                mobile: true,
                key: "project_due_date"
            },
            {
                name: "Project Close",
                email: false,
                browser: true,
                mobile: true,
                key: "project_close"
            },
            // {
            //     name: "Project Description",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "project_description"
            // },
            // {
            //     name: "Project Checklist",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "project_checklist"
            // },
            // {
            //     name: "Project Checklist Assign",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "project_checklist_assign"
            // },
            // {
            //     name: "Project Checklist Remove",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "project_checklist_remove"
            // },
            {
                name: "Project Attachments",
                email: false,
                browser: true,
                mobile: true,
                key: "project_attachments"
            },
            {
                name: "Project Milestone",
                email: false,
                browser: true,
                mobile: true,
                key: "project_milestone"
            },
            {
                name: "Project Milestone Status Change",
                email: false,
                browser: true,
                mobile: true,
                key: "project_milestone_status_change"
            },
            {
                name: "Project Sprint Create",
                email: false,
                browser: true,
                mobile: true,
                key: "project_sprint_create"
            },
            {
                name: "Project Folder Create",
                email: false,
                browser: true,
                mobile: true,
                key: "project_folder_create"
            },
            {
                name: "Comments I'm @mentioned In",
                email: false,
                browser: true,
                mobile: true,
                key: "comments_I'm_@mentioned_in"
            }
        ]
    }
    // Task related notification
    let tasks = {
        key: "tasks",
        sectionName: "Tasks",
        items: [
            {
                name: "Task Notification",
                email: false,
                browser: true,
                mobile: true,
                notifyFor: "assigned_to_me",
                notifySelection: true,
                key: "task_notification"
            },
            {
                name: "Task Create",
                email: false,
                browser: true,
                mobile: true,
                key: "task_create"
            },
            {
                name: "Task Edit",
                email: false,
                browser: true,
                mobile: true,
                key: "task_edit"
            },
            {
                name: "Task Status",
                email: false,
                browser: true,
                mobile: true,
                key: "task_status"
            },
            {
                name: "Task Assignee",
                email: false,
                browser: true,
                mobile: true,
                key: "task_assignee"
            },
            {
                name: "Task Priority",
                email: false,
                browser: true,
                mobile: true,
                key: "task_priority"
            },
            {
                name: "Task Type",
                email: false,
                browser: true,
                mobile: true,
                key: "task_type"
            },
            {
                name: "Task Due Date",
                email: false,
                browser: true,
                mobile: true,
                key: "task_due_date"
            },
            // {
            //     name: "Task Description",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "task_description"
            // },
            // {
            //     name: "Task Checklist",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "task_checklist"
            // },
            // {
            //     name: "Task Checklist Assign",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "task_checklist_assign"
            // },
            // {
            //     name: "Task Checklist Remove",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "task_checklist_remove"
            // },
            {
                name: "Task Attachments",
                email: false,
                browser: true,
                mobile: true,
                key: "task_attachments"
            },
            {
                name: "Comments I'm @mentioned In",
                email: false,
                browser: true,
                mobile: true,
                key: "comments_I'm_@mentioned_in"
            },
            // {
            //     name: "Logged Hours Notification",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "logged_hours_notification"
            // },
            // {
            //     name: "After 3 hours Today Pending Hours Log Notification",
            //     email: false,
            //     browser: true,
            //     mobile: true,
            //     key: "after_3_hours_today_pending_hours"
            // },
            {
                name: "Task Estimated Hours",
                email: false,
                browser: true,
                mobile: true,
                key: "task_estimated_hours"
            }
        ]
    }

    // Chat related notification
    let chat = {
        key: "chat",
        sectionName: "Chat",
        items: [
            {
                name: "Message Create",
                email: false,
                browser: true,
                mobile: true,
                key: "message_create",
            },
            {
                name: "Comments I'm @mentioned In",
                email: false,
                browser: true,
                mobile: true,
                key: "comments_I'm_@mentioned_in"
            }
        ]
    }
    let obj = {
        type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS,
        data: [
            {userId : uid},
            {
                $set: { [project.key]: project,
                    [tasks.key]: tasks,
                    [chat.key]:chat,
                    userId: uid }
            },
            { upsert: true }
        ]
    }

    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
            .catch((error) => {
                reject(error);
                console.error("ERROR in notification settings import: ", error);
            });
        } catch (error) {
            reject(error);
        }
    });
}

// PROJECT DEFAULT TAB COMPONENT 88888888
exports.importProjectTabComponents = (companyName) => {
    let data = [
        {
            name: "List",
            sortIndex: 1,
            keyName: "ProjectListView",
            value: "list",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Board",
            sortIndex: 2,
            keyName: "ProjectKanban",
            value: "ProjectKanban",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Project Details",
            sortIndex: 3,
            keyName: "ProjectDetail",
            value: "projectDetails",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Comments",
            sortIndex: 4,
            keyName: "Comments",
            value: "comments",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Calendar",
            sortIndex: 5,
            keyName: "Calendar",
            value: "calendar",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Activity",
            sortIndex: 6,
            keyName: "ActivityLog",
            value: "activitylog",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Workload",
            sortIndex: 7,
            keyName: "Workload",
            value: "workload",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Dashboard",
            sortIndex: 8,
            keyName: "ProjectDashboard",
            value: "dashboard",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Table",
            sortIndex: 9,
            keyName: "TableView",
            value: "TableView",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Embed",
            sortIndex: 11,
            keyName: "Embed",
            value: "embed",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Reports",
            sortIndex: 12,
            keyName: "Reports",
            value: "reports",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Gantt View",
            sortIndex: 12,
            keyName: "GanttView",
            value: "ganttview",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Recurring Tasks",
            sortIndex: 12,
            keyName: "RecurringTasks",
            value: "recurringtasks",
            setAsDefault: false,
            viewStatus: false
        },       
        {
            name: "Timeline View",
            sortIndex: 12,
            keyName: "TimelineView",
            value: "timelineview",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Mind Map View",
            sortIndex: 13,
            keyName: "MindMapView",
            value: "mindmapview",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Whiteboard View",
            sortIndex: 14,
            keyName: "WhiteboardView",
            value: "whiteboardview",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Canvas View",
            sortIndex: 15,
            keyName: "CanvasView",
            value: "canvasview",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Map View",
            sortIndex: 16,
            keyName: "MapView",
            value: "mapview",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Docs",
            sortIndex: 17,
            keyName: "DocsView",
            value: "docsview",
            setAsDefault: false,
            viewStatus: false
        },
        {
            name: "Forms",
            sortIndex: 20,
            keyName: "FormsView",
            value: "formsview",
            setAsDefault: false,
            viewStatus: false
        }
    ];
    return new Promise(async (resolve, reject) => {
        try {
            await MongoDbCrudOpration(companyName, {
                type: SCHEMA_TYPE.PROJECT_TAB_COMPONENTS,data:[{}]
            }, "deleteMany");

            // Add new data after removing old data
            const savePromises = data.map(async (item) => {
                try {
                    let obj = {
                        data : {
                            ...item,
                            default: true
                        },
                        type : SCHEMA_TYPE.PROJECT_TAB_COMPONENTS
                    }
                    await MongoDbCrudOpration(companyName, obj, "save");
                } catch (error) {
                    console.log(error,"error");
                }
            });

            await Promise.allSettled(savePromises).then(() => {
                resolve();
            }).catch((error) => {
                reject(error);
            });

        } catch (error) {
            console.error("ERROR in importProjectStatusTemplate:", error);
        }
    });
}

// PROJECT DEFAULT TAB COMPONENT 88888888
exports.importProjectApps = (companyName) => {
    let data = [
        {
            name: "Priority",
            key: "Priority",
            beforeIcon: "setting-icons/apps/flaggrey.png",
            afterIcon: "setting-icons/apps/flagblue.png",
            appStatus: true,
            sortIndex: 1
        },
        {
            name: "Multiple Assignees",
            key: "MultipleAssignees",
            beforeIcon: "setting-icons/apps/mutiplegrey.png",
            afterIcon: "setting-icons/apps/mutipleblue.png",
            appStatus: true,
            sortIndex: 2
        },
        {
            name: "Time Estimate",
            key: "TimeEstimates",
            beforeIcon: "setting-icons/apps/timegrey.png",
            afterIcon: "setting-icons/apps/timeBlue.png",
            appStatus: true,
            sortIndex: 3
        },
        {
            name: "Milestones",
            key: "Milestones",
            beforeIcon: "setting-icons/apps/checkflaggrey.png",
            afterIcon: "setting-icons/apps/checkflagblue.png",
            appStatus: true,
            sortIndex: 4
        },
        {
            name: "Tags",
            key: "tags",
            beforeIcon: "setting-icons/apps/tagsgrey.png",
            afterIcon: "setting-icons/apps/tagsblue.png",
            appStatus: false,
            sortIndex: 5
        },
        {
            name: "Custom Fields",
            key: "CustomFields",
            beforeIcon: "setting-icons/apps/editgrey.png",
            afterIcon: "setting-icons/apps/editblue.png",
            appStatus: false,
            sortIndex: 6
        },
        {
            name: "Time Tracking",
            key: "TimeTracking",
            beforeIcon: "setting-icons/apps/timetracking.png",
            afterIcon: "setting-icons/apps/timevalueblue.png",
            appStatus: false,
            sortIndex: 7
        },
        {
            name: "AI",
            key: "AI",
            beforeIcon: "setting-icons/apps/aiGrey.png",
            afterIcon: "setting-icons/apps/aiBlue.png",
            appStatus: false,
            sortIndex: 9
        }
    ];

    return new Promise(async (resolve, reject) => {
        try {
            await MongoDbCrudOpration(companyName, {
                type: SCHEMA_TYPE.APPS,data:[{}]
            }, "deleteMany");

            // Add new data after removing old data
            const savePromises = data.map(async (item) => {
                try {
                    let obj = {
                        data : {
                            ...item,
                            default: true
                        },
                        type : SCHEMA_TYPE.APPS
                    }
                    await MongoDbCrudOpration(companyName, obj, "save");
                } catch (error) {
                    console.log(error,"ERROR IN IMPORT PROJECT APPS");
                }
            });

            await Promise.allSettled(savePromises).then(() => {
                resolve();
            }).catch((error) => {
                console.log("ERROR IN APPS",error);
                reject(error);
            });

        } catch (error) {
            console.error("ERROR in importProjectStatusTemplate:", error);
        }
    });
}

// IMPORT TASK STATUS TEMPLATE 88888888
exports.importTaskStatusTemplate = (companyName) => {
    return new Promise(async (resolve, reject) => {
        try {
            await MongoDbCrudOpration(companyName, {
                type: SCHEMA_TYPE.TASK_STATUS_TEMPLATES,data:[{}]
            }, "deleteMany");

            // Add new data after removing old data
            const data = TaskStatus.TemplateData();
            const savePromises = data.map(async (item) => {
                try {
                    let obj = {
                        data : {
                            ...item,
                            // Respect the template's own flag. Forcing true here marked EVERY template as
                            // the default, so nothing could tell them apart and "the default one" meant
                            // whichever row the database happened to return first.
                            default: item.default === true
                        },
                        type : SCHEMA_TYPE.TASK_STATUS_TEMPLATES
                    }
                    await MongoDbCrudOpration(companyName, obj, "save");
                } catch (error) {
                    console.log(error,"error");
                }
            });

            await Promise.allSettled(savePromises).then(() => {
                resolve();
            }).catch((error) => {
                console.log("ERROR IN IMPORT TASK STATUS TEMPLATE");
                reject(error);
            });

        } catch (error) {
            console.error("ERROR in importProjectStatusTemplate:", error);
        }
    });
}

// IMPORT TASK TYPE TEMPLATE
exports.importTaskTypeTemplate = (companyName) => {
    return new Promise(async (resolve, reject) => {
        try {
            await MongoDbCrudOpration(companyName, {
                type: SCHEMA_TYPE.TASK_TYPE_TEMPLATES,data:[{}]
            }, "deleteMany");

            // Add new data after removing old data
            const data = TaskType.TemplateData();
            const savePromises = data.map(async (item) => {
                try {
                    let obj = {
                        data : {
                            ...item,
                            // Respect the template's own flag. Forcing true here marked EVERY template as
                            // the default, so nothing could tell them apart and "the default one" meant
                            // whichever row the database happened to return first.
                            default: item.default === true
                        },
                        type : SCHEMA_TYPE.TASK_TYPE_TEMPLATES
                    }
                    await MongoDbCrudOpration(companyName, obj, "save");
                } catch (error) {
                    console.log(error,"error");
                }
            });

            await Promise.allSettled(savePromises).then(() => {
                resolve();
            }).catch((error) => {
                console.log("ERROR IN IMPORT TASK TYPE TEMPLATE");
                reject(error);
            });

        } catch (error) {
            console.error("ERROR in importProjectStatusTemplate:", error);
        }
    });
}

exports.importSettingTemplate = (templates, cb) =>{
    try {
        let path = `${SCHEMA_TYPE.PROJECT_TEMPLATES}`;
        let promisesArray = [];
        templates.forEach((item) => {
            item.Updated_At = new Date();
            item.Created_At = new Date();
            let obj = {
                 type : path,
                 data : item
            }
            promisesArray.push(
                new Promise((resolve2, reject2) => {
                    try {
                        MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
                        .then(() => {
                            resolve2();
                        })
                    } catch (error) {
                        logger.error(`Send Catch Error 1: ${error.messge}`);
                        reject2.send({status: false, statusText: error.message});
                        reject2(error);
                    }
                })
            )
        })
        Promise.allSettled(promisesArray)
        .then(() => {
            cb({
                status: true
            });
        })
        .catch((error) => {
            logger.error(`Send Catch Error 2: ${error.messge}`);
            cb({
                status: false,
                error: error
            });
        })

    }
    catch(error){
        logger.error(`Send Catch Error 3: ${error.messge}`);
        cb({
            status: false,
            error: error
        });
    }
}

exports.createDefaultMainChats = (companyId) => {
    return new Promise((resolve, reject) => {
        try {
            let oneToOne = {
                ProjectName: "one to one",
                ProjectCode: "oto",
                default: true,
                Created_At: new Date(),
                Updated_At: new Date(),
                taskTypeCounts: [
                    {
                        default: true,
                        key: 0,
                        name: "Task",
                        value: "task",
                        taskCount: 0,
                        taskImage: ""
                    }
                ],
                taskStatusData: [
                    {
                        bgColor: "#ff960035",
                        key: 1,
                        name: "To Do",
                        textColor: "#ff9600",
                        type: "default_active",
                        value: "to_do"
                    }
                ],
                name: 'one to one'
            }

            let channelProject = {
                ...oneToOne,
                ProjectName: "CHANNELS",
                ProjectCode: "C",
                default: false,
            }

            delete channelProject.sprintsObj;

            let promises = [];
            let promises1 = [];
            promises.push(
                new Promise((resolve2, reject2) => {
                    try {
                        let obj = [
                                {ProjectName : channelProject.ProjectName},
                                {$set: { ...channelProject }},
                                { upsert: true }
                            ]
                        
                        updateMainChat(companyId, obj)
                        .then(() => {
                            resolve2("UPDATE DEFAULT")
                        })
                        .catch((error) => {
                            reject2(error);
                        })
                    } catch(error) {
                        reject2(error);
                    }
                })
            )
            promises1.push(
                new Promise((resolve3, reject3) => {
                    try {
                        let obj = [
                                {ProjectName : oneToOne.ProjectName},
                                {$set: { ...oneToOne }},
                                { upsert: true, new: true }
                            ]
                        
                        updateMainChat(companyId, obj)
                        .then((result) => JSON.parse(JSON.stringify(result)))
                        .then((result) => {
                            const addObj = {
                                body: {
                                    companyId: companyId,
                                    projectId: result._id,
                                    sprintName: 'defaultSprint',
                                    userData:{},
                                    projectName: oneToOne.ProjectName,
                                    isPreCompany: true
                                }
                            }
                            addSprintFun(addObj).catch((err)=>{
                                logger.error('Create Sprint Error',err)
                            });
                            resolve3("UPDATE 1 to 1");
                        })
                        .catch((error) => {
                            reject3(error);
                        })
                    } catch(error) {
                        reject3(error);
                    }
                })
            )
            Promise.allSettled([promises,promises1])
            .then(()=> {
                resolve(true)
            })
            .catch((error) => {
                console.log("ERROR: ", error);
                reject(error)
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.importTaskDefaultStatus = (companyId) => {
    const dataArray = [
        { key: 1, name: "To Do", bgColor: "#ff960035", textColor: "#ff9600", isDeleted: false },
        { key: 2, name: "Complete", bgColor: "#6BC95035", textColor: "#6BC950", isDeleted: false},
        { key: 3, name: "In Progress", bgColor: "#6473e835", textColor: "#6473e8", isDeleted: false  },
        { key: 4, name: "In Review", bgColor: "#9759c035", textColor: "#9759c0",  isDeleted: false},
        { key: 5, name: "Backlog", bgColor: "#ec414135", textColor: "#ec4141", isDeleted: false },
        { key: 6, name: "Done", bgColor: "#24c11035", textColor: "#24c110",  isDeleted: false },
        { key: 7, name: "On Hold", bgColor: "#cedb1f35", textColor: "#cedb1f",  isDeleted: false },
        { key: 8, name: "Ready For Production", bgColor: "#55eb3735", textColor: "#55eb37",  isDeleted: false },
        { key: 9, name: "Code Review", bgColor: "#324e3135", textColor: "#324e31", isDeleted: false },
    ];
    let dataObj = {
        name: settingsCollectionDocs.TASK_STATUS,
        settings :dataArray,
        'totalStatus' : dataArray.length
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.TASK_STATUS},
            {$set: { ...dataObj }},
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyId, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

//IMPORT PROJECT STATUS
exports.importProjectStatus = (companyName) => {
    let dataObj = {
        name: settingsCollectionDocs.PROJECT_STATUS,
        settings :[{
            "backgroundColor": "#E3E1FC35",
            "textColor": "#7367F0",
            "name": "Open",
            "value": "open",
            "isDeleted": false,
            "key":1
        },
        {
            "backgroundColor": "#ED514535",
            "textColor": "#ED5145",
            "name": "Close",
            "value": "close",
            "isDeleted": false,
            "key":2
        },
        {
            "backgroundColor": "#68c21e35",
            "textColor": "#68c21e",
            "name": "Done",
            "value": "done",
            "isDeleted": false,
            "key":3
        },
        {
            "backgroundColor": "#c6b45d35",
            "textColor": "#c6b45d",
            "name": "On Hold",
            "value": "on_hold",
            "isDeleted": false,
            "key":4
        },
        {
            "backgroundColor": "#1aee1735",
            "textColor": "#1aee17",
            "name": "Completed",
            "value": "completed",
            "isDeleted": false,
            "key":5
        },
        {
            "backgroundColor": "#ff880035",
            "textColor": "#ff8800",
            "name": "In Process",
            "value": "in_process",
            "isDeleted": false,
            "key":6
        },
        {
            "backgroundColor": "#E62CE935",
            "textColor": "#E62CE9",
            "name": "Backlog",
            "value": "backlog",
            "isDeleted": false,
            "key":7
        }],
        'createdAt':new Date(),
        'updatedAt':new Date(),
        'id':'project_status',
        'totalStatus':7,
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.PROJECT_STATUS},
            {$set: { ...dataObj }},
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

// IMPORT STATUS TYPE
exports.importStatusType = (companyName) => {

    let dataObj = {
        name: settingsCollectionDocs.TASK_TYPE,
        settings :[{
            "name": "Task",
            "isDeleted": false,
            "value": "task",
            "key":1,
            "taskImage": "setting/task_type/task.png"
        },
        {
            "name": "Bug",
            "isDeleted": false,
            "value": "bug",
            "key":2,
            "taskImage": "setting/task_type/bug.png"
        },
        {
            "name": "Sub Task",
            "isDeleted": false,
            "value": "sub_task",
            "key":3,
            "taskImage": "setting/task_type/subtask.png"
        },
        {
            "name": "Design",
            "isDeleted": false,
            "value": "design",
            "key":4,
            "taskImage": "setting/task_type/design.png"
        }],
        'createdAt':new Date(),
        'updatedAt':new Date(),
        'totalStatus':4,
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.TASK_TYPE},
            {$set: { ...dataObj }},
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            console.error("ERROR IN IMPORT STATUS TYPE",error);
            reject(error);
        }
    });
}

// IMPORT PROJECT STATUS TEMPLATE
exports.importProjectStatusTemplate = async (companyName) => {
    return new Promise(async (resolve, reject) => {
        try {
            await MongoDbCrudOpration(companyName, {
                type: SCHEMA_TYPE.PROJECT_STATUS_TEMPLATES,data:[{}]
            }, "deleteMany");

            // Add new data after removing old data
            const data = ProjectStatus.TemplateData();
            const savePromises = data.map(async (item) => {
                try {
                    let obj = {
                        data : {
                            ...item,
                            // Respect the template's own flag. Forcing true here marked EVERY template as
                            // the default, so nothing could tell them apart and "the default one" meant
                            // whichever row the database happened to return first.
                            default: item.default === true
                        },
                        type : SCHEMA_TYPE.PROJECT_STATUS_TEMPLATES
                    }
                    await MongoDbCrudOpration(companyName, obj, "save");
                } catch (error) {
                    console.error(error,"error");
                }
            });

            Promise.allSettled(savePromises).then(() => {
                resolve();
            }).catch((error) => {
                console.error("ERROR IN IMPORT PROJECT STATUS TEMPLATE");
                reject(error);
            });

        } catch (error) {
            console.error("ERROR in importProjectStatusTemplate:", error);
        }
    })
};


exports.importRestrictedExtensions = (companyName) => {
    return new Promise(async (resolve, reject) => {
        try {
            await MongoDbCrudOpration(companyName, {
                type: SCHEMA_TYPE.RESTRICTED_EXTENSIONS,data:[{}]
            }, "deleteMany");

            const extensions = [".cdx", ".ida", ".ins", ".mdb", ".mdt", ".mdz", ".msh", ".msh1", ".msh1xml", ".msh2", ".msh2xml", ".mshxml", ".pst", ".rem", ".cpl", ".dll", ".hlp", ".its", ".lnk", ".msc", ".msp", ".mst", ".reg", ".scf", ".scr", ".app", ".bat", ".cmd", ".com", ".exe", ".hta", ".ksh", ".mam", ".pif", ".prg", ".sct", ".shb", ".vbe", ".vbs", ".ws", ".wsf", ".wsh", ".soap", ".bas", ".class", ".config", " .jse", " .vb", ".wsc", ".mde", ".mda", ".asa", ".asmx", ".asp", ".cer", ".chm", ".crt", ".idc", ".shtm", ".shtml", ".stm", ".url", ".code"]

            // Add new data after removing old data
            const data = {extensions};
            let obj = {
                data : {
                    ...data,
                },
                type : SCHEMA_TYPE.RESTRICTED_EXTENSIONS
            }
            MongoDbCrudOpration(companyName, obj, "save")
            .then((res) => {
                resolve(res);
            }).catch((error) => {
                console.log("ERROR IN IMPORT RESTRICTED EXTENSIONS");
                reject(error);
            });

        } catch (error) {
            console.error("ERROR in importRestrictedExtensions:", error);
        }
    })
}


exports.importCustomFields = (companyName) => {
    return new Promise(async (resolve, reject) => {
        try {
            await MongoDbCrudOpration(companyName, {
                type: SCHEMA_TYPE.GLOBAL_CUSTOM_FIELDS,data:[{}]
            }, "deleteMany");

            const customFields = defaultCustomFields;

            const promises = [];
            customFields.forEach((field) => {
                // Add new data after removing old data
                let obj = {
                    data : {
                        ...field,
                    },
                    type : SCHEMA_TYPE.GLOBAL_CUSTOM_FIELDS
                }
                promises.push(
                    MongoDbCrudOpration(companyName, obj, "save")
                )
            })

            Promise.allSettled(promises)
            .then((res) => {
                resolve(res);
            }).catch((error) => {
                console.log("ERROR IN IMPORT CUSTOM FIELDS");
                reject(error);
            });

        } catch (error) {
            console.error("ERROR in importCustomFields:", error);
        }
    })
};

exports.importTours = (companyName) => {
    return new Promise(async (resolve, reject) => {
        try {
            await MongoDbCrudOpration(companyName, {
                type: SCHEMA_TYPE.TOURS,data:[{}]
            }, "deleteMany");

            const toursFields = defaultProjectTours;

            const promises = [];
            toursFields.forEach((field) => {
                // Add new data after removing old data
                let obj = {
                    data : {
                        ...field,
                    },
                    type : SCHEMA_TYPE.TOURS
                }
                promises.push(
                    MongoDbCrudOpration(companyName, obj, "save")
                )
            })

            Promise.allSettled(promises)
            .then((res) => {
                resolve(res);
            }).catch((error) => {
                console.log("ERROR IN IMPORT TOURS FIELDS");
                reject(error);
            });

        } catch (error) {
            console.error("ERROR in importTours:", error);
        }
    })
};

// IMPORT COMPANY DESIGNATIONS
exports.importCompanyDesignations = (companyName) => {
    let designations = [
        {
            name: "Owner",
            key: 0,
        },
        {
            name: "CEO",
            key: 1,
        },
        {
            name: "CFO",
            key: 2,
        },
        {
            name: "Manager",
            key: 3,
        },
        {
            name: "Marketing Executive",
            key: 4,
        },
        {
            name: "HR Executive",
            key: 5,
        },
        {
            name: "IT Administrator",
            key: 6,
        },
        {
            name: "Software Engineer",
            key: 7,
        },
        {
            name: "Operations Executive",
            key: 8,
        }
    ];
    let dataObj = {
        name: settingsCollectionDocs.DESIGNATIONS,
        settings :designations,
    }
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.DESIGNATIONS},
            {$set: { ...dataObj }},
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Vendor-neutral starter skills for a new company. Slugs match the strings the
 * central dashboard groups bids by, so per-tech reporting lines up without a
 * mapping table. `totalStatus` is the key allocator, as in the other lists.
 */
exports.importProjectSkills = (companyName) => {
    const names = [
        "Shopify","Shopify App Development","WordPress","Webflow",
        "React","Vue.js","Angular","Node.js","Laravel","PHP","Python",
        "Django",".NET","React Native","Flutter","iOS","Android",
        "UI/UX Design","Web Design","Graphic Design","AI/ML","Data Engineering",
        "DevOps","QA/Testing","Next.js","Nuxt.js","Electron","Payment Gateway Integration",
        "AWS","Azure","Google Cloud","Firebase","MongoDB","MySQL","PostgreSQL","Redis",
        "Docker","CI/CD","Headless CMS","SEO","Astro.js","JavaScript","TypeScript",
        "Jquery","AI Integration","Monolithic Architecture","Microservices Architecture",
        "Serverless Architecture"
    ];
    const skills = names.map((name, index) => ({
        key: index + 1,
        name,
        slug: toSlug(name),
        active: true
    }));
    // $setOnInsert, not $set: this also gets run by hand to backfill older
    // companies, and a re-run must not flatten an edited list.
    const obj = {
        type : SCHEMA_TYPE.SETTINGS,
        data: [
            {name : settingsCollectionDocs.PROJECT_SKILLS},
            {
                $setOnInsert: {
                    name: settingsCollectionDocs.PROJECT_SKILLS,
                    settings: skills,
                    totalStatus: skills.length
                }
            },
            { upsert: true }
        ]
    }
    return new Promise((resolve, reject) => {
        try {
            MongoDbCrudOpration(companyName, obj, "findOneAndUpdate")
            .then(() => {
                resolve();
            })
            .catch((error) => reject(error));
        } catch (error) {
            reject(error);
        }
    });
}
