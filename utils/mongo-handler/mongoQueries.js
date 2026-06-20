const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { handleConnection } = require("../../middlewares/mongoConnector/mongoConnection")
const {
    timeSheetSchema,
    historySchema,
    userIdSchema,
    usersSchema,
    adminDetailSchema,
    wasabicredentials,
    ProjectTemplate,
    timeTrackerDownload,
    companies,
    companyProjectTemplate,
    proejctTabComponents,
    projectStatusTemplate,
    taskTypeTemplates,
    taskStatusTemplates,
    temsManagment,
    companyUserSchema,
    rulesSchema,
    estimatedTimeSchema,
    currencyListSchema,
    projectsSchema,
    settingsSchema,
    milestone,
    appsSchema,
    notificationsSchema,
    notificationsSettingsSchema,
    mentionsSchema,
    taskSchema,
    commentSchema,
    mainChatSchema,
    projectRulesSchema,
    subscriptionPlanSchema,
    subscriptionsSchema,
    planFeatureSchema,
    planFeatureDisplaySchema,
    invoiceSchema,
    globalCustomFieldsSchema,
    customFieldsSchema,
    creditNoteSchema,
    sprints,
    folders,
    restrictedExtensions,
    tours,
    preCompaniesSchema,
    bucketSchema,
    globalFilterSchema,
    userAuthSchema,
    resetAttemptSchema,
    sessionsSchema,
    userDashboard,
    referCodeSchema,
    refferalmapping,
    globalSettingsSchema,
    webhooksSchema,
    webhookLogsSchema,
    recentVisitsSchema,
    stickiesSchema,
    apiTokensSchema,
    apiActivityLogsSchema,
    exportJobsSchema,
    importJobsSchema,
    epicsSchema,
    pagesSchema,
    pageVersionsSchema,
    publicSharesSchema,
    intakeItemsSchema,
    publicShareIndexSchema,
    recurringTasksSchema,
    timesheetApprovalSchema,
    billingRatesSchema,
    ssoConfigsSchema,
    auditLogsSchema
} = require('./createSchema');


exports.checkType = (type) => {
    switch (type) {
        case SCHEMA_TYPE.TASKS:
            return taskSchema
        case SCHEMA_TYPE.TIMESHEET:
            return timeSheetSchema
        case SCHEMA_TYPE.HISTORY:
            return historySchema
        case SCHEMA_TYPE.USERID:
            return userIdSchema
        case SCHEMA_TYPE.USERS:
            return usersSchema
        case SCHEMA_TYPE.ADMIN_DETAIL:
            return adminDetailSchema
        case SCHEMA_TYPE.WASABICREDENTIALS:
            return wasabicredentials
        case SCHEMA_TYPE.PROJECT_MAIN_TEMPLATES:
            return ProjectTemplate
        case SCHEMA_TYPE.TIMETRACKER_DOWNLOAD:
            return timeTrackerDownload
        case SCHEMA_TYPE.COMPANIES:
            return companies
        case SCHEMA_TYPE.PROJECT_TEMPLATES:
            return companyProjectTemplate
        case SCHEMA_TYPE.PROJECT_TAB_COMPONENTS:
            return proejctTabComponents
        case SCHEMA_TYPE.PROJECT_STATUS_TEMPLATES:
            return projectStatusTemplate
        case SCHEMA_TYPE.TASK_TYPE_TEMPLATES:
            return taskTypeTemplates
        case SCHEMA_TYPE.TASK_STATUS_TEMPLATES:
            return taskStatusTemplates
        case SCHEMA_TYPE.TEAMS_MANAGEMENT:
            return temsManagment
        case SCHEMA_TYPE.COMPANY_USERS:
            return companyUserSchema
        case SCHEMA_TYPE.RULES:
            return rulesSchema
        case SCHEMA_TYPE.ESTIMATES_TIME:
            return estimatedTimeSchema
        case SCHEMA_TYPE.CURRENCY_LIST:
            return currencyListSchema
        case SCHEMA_TYPE.PROJECTS:
            return projectsSchema
        case SCHEMA_TYPE.MAIN_CHATS:
            return mainChatSchema
        case SCHEMA_TYPE.SETTINGS:
            return settingsSchema
        case SCHEMA_TYPE.MILESTONE:
            return milestone
        case SCHEMA_TYPE.APPS:
            return appsSchema
        case SCHEMA_TYPE.NOTIFICATIONS:
            return notificationsSchema
        case SCHEMA_TYPE.NOTIFICATIONS_SETTINGS:
            return notificationsSettingsSchema
        case SCHEMA_TYPE.MENTIONS:
            return mentionsSchema
        case SCHEMA_TYPE.COMMON:
            return notificationsSchema
        case SCHEMA_TYPE.COMMENTS:
            return commentSchema
        case SCHEMA_TYPE.PROJECT_RULES:
            return projectRulesSchema
        case SCHEMA_TYPE.SUBSCRIPTIONPLAN:
            return subscriptionPlanSchema
        case SCHEMA_TYPE.PLANFEATURE:
            return planFeatureSchema
        case SCHEMA_TYPE.PLANFEATUREDISPLAY:
            return planFeatureDisplaySchema
        case SCHEMA_TYPE.SUBSCRIPTIONS:
            return subscriptionsSchema
        case SCHEMA_TYPE.INVOICES:
            return invoiceSchema
        case SCHEMA_TYPE.GLOBAL_CUSTOM_FIELDS:
            return globalCustomFieldsSchema
        case SCHEMA_TYPE.CUSTOM_FIELDS:
            return customFieldsSchema
        case SCHEMA_TYPE.CREDITNOTES:
                return creditNoteSchema
        case SCHEMA_TYPE.SPRINTS:
            return sprints
        case SCHEMA_TYPE.FOLDERS:
            return folders
        case SCHEMA_TYPE.RESTRICTED_EXTENSIONS:
            return restrictedExtensions
        case SCHEMA_TYPE.TOURS:
            return tours
        case SCHEMA_TYPE.PRECOMPANIES:
            return preCompaniesSchema
        case SCHEMA_TYPE.BUCKETS:
            return bucketSchema
        case SCHEMA_TYPE.GLOBALFILTER:
            return globalFilterSchema
        case SCHEMA_TYPE.USER_AUTH:
            return userAuthSchema
        case SCHEMA_TYPE.RESET_ATTEMPT:
            return resetAttemptSchema
        case SCHEMA_TYPE.SESSIONS:
            return sessionsSchema
        case SCHEMA_TYPE.USERDASHBOARD:
            return userDashboard
        case SCHEMA_TYPE.REFERCODE:
            return referCodeSchema    
        case SCHEMA_TYPE.REFFERALMAPPING:
            return refferalmapping
        case SCHEMA_TYPE.GLOBALSETTING:
            return globalSettingsSchema
        case SCHEMA_TYPE.WEBHOOKS:
            return webhooksSchema
        case SCHEMA_TYPE.WEBHOOK_LOGS:
            return webhookLogsSchema
        case SCHEMA_TYPE.RECENTVISITS:
            return recentVisitsSchema
        case SCHEMA_TYPE.STICKIES:
            return stickiesSchema
        case SCHEMA_TYPE.API_TOKENS:
            return apiTokensSchema
        case SCHEMA_TYPE.API_ACTIVITY_LOGS:
            return apiActivityLogsSchema
        case SCHEMA_TYPE.EXPORT_JOBS:
            return exportJobsSchema
        case SCHEMA_TYPE.IMPORT_JOBS:
            return importJobsSchema
        case SCHEMA_TYPE.EPICS:
            return epicsSchema
        case SCHEMA_TYPE.PAGES:
            return pagesSchema
        case SCHEMA_TYPE.PAGE_VERSIONS:
            return pageVersionsSchema
        case SCHEMA_TYPE.PUBLIC_SHARES:
            return publicSharesSchema
        case SCHEMA_TYPE.INTAKE_ITEMS:
            return intakeItemsSchema
        case SCHEMA_TYPE.PUBLIC_SHARE_INDEX:
            return publicShareIndexSchema
        case SCHEMA_TYPE.RECURRING_TASKS:
            return recurringTasksSchema
        case SCHEMA_TYPE.TIMESHEET_APPROVAL:
            return timesheetApprovalSchema
        case SCHEMA_TYPE.BILLING_RATES:
            return billingRatesSchema
        case SCHEMA_TYPE.SSO_CONFIGS:
            return ssoConfigsSchema
        case SCHEMA_TYPE.AUDIT_LOGS:
            return auditLogsSchema
        default:
            return ""
    }
}
exports.tableType = (type) => {
    switch (type) {
        case SCHEMA_TYPE.TASKS:
            return `${dbCollections.TASKS}`
        case SCHEMA_TYPE.TIMESHEET:
            return `${dbCollections.TIMESHEET}`
        case SCHEMA_TYPE.HISTORY:
            return `${dbCollections.HISTORY}`
        case SCHEMA_TYPE.USERID:
            return `${dbCollections.USERID}`
        case SCHEMA_TYPE.USERS:
            return `${dbCollections.USERS}`
        case SCHEMA_TYPE.ADMIN_DETAIL:
            return `${dbCollections.ADMIN_DETAIL}`
        case SCHEMA_TYPE.WASABICREDENTIALS:
            return `${dbCollections.WASABICREDENTIALS}`
        case SCHEMA_TYPE.PROJECT_MAIN_TEMPLATES:
            return `${dbCollections.PROJECT_MAIN_TEMPLATES}`
        case SCHEMA_TYPE.TIMETRACKER_DOWNLOAD:
            return `${dbCollections.TIMETRACKER_DOWNLOAD}`
        case SCHEMA_TYPE.COMPANIES:
            return `${dbCollections.COMPANIES}`
        case SCHEMA_TYPE.PROJECT_TEMPLATES:
            return `${dbCollections.PROJECT_TEMPLATES}`
        case SCHEMA_TYPE.PROJECT_TAB_COMPONENTS:
            return `${dbCollections.PROJECT_TAB_COMPONENTS}`
        case SCHEMA_TYPE.PROJECT_STATUS_TEMPLATES:
            return `${dbCollections.PROJECT_STATUS_TEMPLATES}`
        case SCHEMA_TYPE.TASK_TYPE_TEMPLATES:
            return `${dbCollections.TASK_TYPE_TEMPLATES}`
        case SCHEMA_TYPE.TASK_STATUS_TEMPLATES:
            return `${dbCollections.TASK_STATUS_TEMPLATES}`
        case SCHEMA_TYPE.TEAMS_MANAGEMENT:
            return `${dbCollections.TEAMS_MANAGEMENT}`
        case SCHEMA_TYPE.COMPANY_USERS:
            return `${dbCollections.COMPANY_USERS}`
        case SCHEMA_TYPE.RULES:
            return `${dbCollections.RULES}`
        case SCHEMA_TYPE.ESTIMATES_TIME:
            return `${dbCollections.ESTIMATED_TIME}`
        case SCHEMA_TYPE.CURRENCY_LIST:
            return `${dbCollections.CURRENCY_LIST}`
        case SCHEMA_TYPE.PROJECTS:
            return `${dbCollections.PROJECTS}`
        case SCHEMA_TYPE.MAIN_CHATS:
            return `${dbCollections.MAIN_CHATS}`
        case SCHEMA_TYPE.SETTINGS:
            return `${dbCollections.SETTINGS}`
        case SCHEMA_TYPE.MILESTONE:
            return `${dbCollections.MILESTONE}`
        case SCHEMA_TYPE.APPS:
            return `${dbCollections.APPS}`
        case SCHEMA_TYPE.NOTIFICATIONS:
            return `${dbCollections.NOTIFICATIONS}`
        case SCHEMA_TYPE.NOTIFICATIONS_SETTINGS:
            return `${dbCollections.NOTIFICATIONS_SETTINGS}`
        case SCHEMA_TYPE.MENTIONS:
            return `${dbCollections.MENTIONS}`
        case SCHEMA_TYPE.COMPANY_NOTIFICATIONS:
            return `${dbCollections.NOTIFICATIONS}`
        case SCHEMA_TYPE.COMMON:
            return `${dbCollections.COMMON}`
        case SCHEMA_TYPE.COMMENTS:
            return `${dbCollections.COMMENTS}`
        case SCHEMA_TYPE.PROJECT_RULES:
            return `${SCHEMA_TYPE.PROJECT_RULES}`
        case SCHEMA_TYPE.SUBSCRIPTIONPLAN:
                return `${dbCollections.SUBSCRIPTIONPLAN}`
        case SCHEMA_TYPE.PLANFEATURE:
            return `${dbCollections.PLANFEATURE}`
        case SCHEMA_TYPE.PLANFEATUREDISPLAY:
            return `${dbCollections.PLANFEATUREDISPLAY}`
        case SCHEMA_TYPE.SUBSCRIPTIONS:
            return `${dbCollections.SUBSCRIPTIONS}`
        case SCHEMA_TYPE.INVOICES:
                return `${dbCollections.INVOICES}`
        case SCHEMA_TYPE.CUSTOM_FIELDS:
            return `${dbCollections.CUSTOM_FIELDS}`
        case SCHEMA_TYPE.CREDITNOTES:
            return `${dbCollections.CREDITNOTES}`
        case SCHEMA_TYPE.SPRINTS:
            return `${dbCollections.SPRINTS}`
        case SCHEMA_TYPE.FOLDERS:
            return `${dbCollections.FOLDERS}`
        case SCHEMA_TYPE.RESTRICTED_EXTENSIONS:
            return `${SCHEMA_TYPE.RESTRICTED_EXTENSIONS}`
        case SCHEMA_TYPE.TOURS:
            return `${SCHEMA_TYPE.TOURS}`
        case SCHEMA_TYPE.PRECOMPANIES:
            return `${dbCollections.PRECOMPANIES}`
        case SCHEMA_TYPE.GLOBAL_CUSTOM_FIELDS:
            return `${dbCollections.CUSTOM_FIELDS}`
        case SCHEMA_TYPE.BUCKETS:
            return `${dbCollections.BUCKETS}`
        case SCHEMA_TYPE.GLOBALFILTER:
            return `${dbCollections.GLOBALFILTER}`
        case SCHEMA_TYPE.USER_AUTH:
            return `${dbCollections.USER_AUTH}`
        case SCHEMA_TYPE.RESET_ATTEMPT:
            return `${dbCollections.RESET_ATTEMPT}`
        case SCHEMA_TYPE.SESSIONS:
            return `${dbCollections.SESSIONS}`
        case SCHEMA_TYPE.USERDASHBOARD:
            return `${dbCollections.USERDASHBOARD}`
        case SCHEMA_TYPE.REFERCODE:
            return `${dbCollections.REFERCODE}`    
        case SCHEMA_TYPE.REFFERALMAPPING:
            return `${dbCollections.REFFERALMAPPING}`   
        case SCHEMA_TYPE.GLOBALSETTING:
                return `${dbCollections.GLOBALSETTING}`
        case SCHEMA_TYPE.WEBHOOKS:
                return `${dbCollections.WEBHOOKS}`
        case SCHEMA_TYPE.WEBHOOK_LOGS:
                return `${dbCollections.WEBHOOK_LOGS}`
        case SCHEMA_TYPE.RECENTVISITS:
                return `${dbCollections.RECENTVISITS}`
        case SCHEMA_TYPE.STICKIES:
                return `${dbCollections.STICKIES}`
        case SCHEMA_TYPE.API_TOKENS:
                return `${dbCollections.API_TOKENS}`
        case SCHEMA_TYPE.API_ACTIVITY_LOGS:
                return `${dbCollections.API_ACTIVITY_LOGS}`
        case SCHEMA_TYPE.EXPORT_JOBS:
                return `${dbCollections.EXPORT_JOBS}`
        case SCHEMA_TYPE.IMPORT_JOBS:
                return `${dbCollections.IMPORT_JOBS}`
        case SCHEMA_TYPE.EPICS:
                return `${dbCollections.EPICS}`
        case SCHEMA_TYPE.PAGES:
                return `${dbCollections.PAGES}`
        case SCHEMA_TYPE.PAGE_VERSIONS:
                return `${dbCollections.PAGE_VERSIONS}`
        case SCHEMA_TYPE.PUBLIC_SHARES:
                return `${dbCollections.PUBLIC_SHARES}`
        case SCHEMA_TYPE.INTAKE_ITEMS:
                return `${dbCollections.INTAKE_ITEMS}`
        case SCHEMA_TYPE.PUBLIC_SHARE_INDEX:
                return `${dbCollections.PUBLIC_SHARE_INDEX}`
        case SCHEMA_TYPE.RECURRING_TASKS:
                return `${dbCollections.RECURRING_TASKS}`
        case SCHEMA_TYPE.TIMESHEET_APPROVAL:
                return `${dbCollections.TIMESHEET_APPROVAL}`
        case SCHEMA_TYPE.BILLING_RATES:
                return `${dbCollections.BILLING_RATES}`
        case SCHEMA_TYPE.SSO_CONFIGS:
                return `${dbCollections.SSO_CONFIGS}`
        case SCHEMA_TYPE.AUDIT_LOGS:
                return `${dbCollections.AUDIT_LOGS}`
        default:
            return ""
    }
}

/**
 * MongoDb CrudOpration Insert, Update, Delete
 * @param {Object} Data - Object Which Contain SchemaType And Data Array Which is need to perform opration in db
 * @param {String} CompanyId - Company Id In which Task Is Created
 * @param {Object} Method - Mongodb Method Which is needed to perform
 * @returns {Promise<String>} A Promise that resolves with the Response from db.
 *                            Rejects with an error message if any issues occur during the Process.
 */
exports.MongoDbCrudOpration = (companyId, data, method) => {
    return new Promise(async (resolve, reject) => {
        try {
            var res = await handleConnection(companyId)
            if (res?.status) {
                let { database } = res
                if (data.type === undefined || data.data === undefined) {
                    reject("Type and data is required in data")
                    return;
                }
                let table = this.tableType(data.type)
                var myVariable = this.checkType(data.type)
                if (method === 'save') {
                    const Model = database.model(table, myVariable, table);
                    const newDocument = new Model(data.data);
                    newDocument.save().then((res) => {
                        resolve(res)
                    }).catch((err) => {
                        reject(err)
                    });
                }
                else if (method == "find") {
                    const model = database.model(table, myVariable, table)
                    model[method].apply(model, data.data).then((res) => {
                        resolve(res)
                    }).catch((err) => {
                        reject(err)
                    })
                }
                else {
                    const model = database.model(table, myVariable, table)
                    model[method].apply(model, data.data).then((res) => {
                        resolve(res)
                    }).catch((err) => {
                        reject(err)
                    })
                }
            } else {
                reject({ message: res?.statusText, status: false })
            }
        } catch (error) {
            reject(error)
        }
    })
}



/**
 * 
 * @param {*} id - Id which we want to check if it is valid mongo id
 * @returns - true or false if it is mongo id then true otherwise false
 */
exports.validateObjectId = (id) => {
    return /^[0-9a-fA-F]{24}$/.test(id); // Example for MongoDB ObjectId
};