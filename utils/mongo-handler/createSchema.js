const { Schema } = require('mongoose');
const { schema } = require('./schema');
const taskSchema = new Schema(schema.tasks, { strict: false, timestamps: true });
const commentSchema = new Schema(schema.comments, { strict: false, timestamps: true });
const timeSheetSchema = new Schema(schema.timesheet, { strict: false, timestamps: true });
// BUG-046 / #100 — every other schema in this file already uses
// `{ timestamps: true }` so Mongoose owns `createdAt`/`updatedAt` as
// BSON Dates. The history schema alone declared them as String/Date
// fields the callers populated manually with `DateTime.utc().ts`
// (a numeric millis value). That produced inconsistent shapes
// (number vs Date) across documents. Letting Mongoose own them gives
// us proper BSON Dates without callers having to remember to set them.
const historySchema = new Schema(schema.history, { strict: false, timestamps: true });
const userIdSchema = new Schema(schema.userId, { strict: false, timestamps: true });
const usersSchema = new Schema(schema.users, { strict: true,timestamps: true});
const adminDetailSchema = new Schema(schema.adminDetail, { strict: false,timestamps: true});
const wasabicredentials = new Schema(schema.wasabicredentials, {strict: true, timestamps: true});
const ProjectTemplate = new Schema(schema.ProjectTemplate, {strict: true, timestamps: true});
const timeTrackerDownload = new Schema(schema.timeTrackerDownload, {strict: true, timestamps: true});
const companies = new Schema(schema.companies, {strict: true, timestamps: true});
const companyProjectTemplate = new Schema(schema.companyProjectTemplate, {strict: true, timestamps: true});
const proejctTabComponents = new Schema(schema.proejctTabComponents, {strict: true, timestamps: true});
const projectStatusTemplate = new Schema(schema.projectStatusTemplate, {strict: true, timestamps: true});
const taskTypeTemplates = new Schema(schema.taskTypeTemplates, {strict: true, timestamps: true});
const taskStatusTemplates = new Schema(schema.taskStatusTemplates, {strict: true, timestamps: true});
const temsManagment = new Schema(schema.temsManagment, {strict: true, timestamps: true});
const companyUserSchema= new Schema(schema.companyUsers, {strict: true, timestamps: true})
const rulesSchema= new Schema(schema.rules, {strict: true, timestamps: true})
const estimatedTimeSchema= new Schema(schema.estimatedTime, {strict: true, timestamps: true})
const currencyListSchema= new Schema(schema.currency_list, {strict: true, timestamps: true})
const projectsSchema = new Schema(schema.projects, {strict: true, timestamps: true})
const mainChatSchema = new Schema(schema.mainChats, {strict: true, timestamps: true})
const settingsSchema = new Schema(schema.settings, {strict: true, timestamps: true})
const milestone = new Schema(schema.milestone, { strict: true,timestamps: true});
const appsSchema = new Schema(schema.apps, {strict: true, timestamps: true})
const notificationsSchema = new Schema(schema.notifications, {strict: true, timestamps: true})
const notificationsSettingsSchema= new Schema(schema.notificationsSettings, {strict: true, timestamps: true})
const mentionsSchema= new Schema(schema.mentions, {strict: true, timestamps: true})
const projectRulesSchema= new Schema(schema.projectRules, {strict: true, timestamps: true})
const subscriptionPlanSchema = new Schema(schema.subscriptionPlan, {strict: false, timestamps: true});
const planFeatureSchema = new Schema(schema.planFeature, {strict: false, timestamps: true});
const planFeatureDisplaySchema = new Schema(schema.planFeature, {strict: false, timestamps: true});
const subscriptionsSchema = new Schema(schema.subscriptions, {strict: false, timestamps: true});
const invoiceSchema = new Schema(schema.invoices, {strict: false,timestamps: true});
const globalCustomFieldsSchema= new Schema(schema.globalCustomFields, {strict: false, timestamps: true})
const customFieldsSchema= new Schema(schema.customFields, {strict: false, timestamps: true})
const creditNoteSchema= new Schema(schema.creditNotes, {strict: false, timestamps: true})
const sprints = new Schema(schema.sprints, { strict: true,timestamps: true});
const folders = new Schema(schema.folders, { strict: true,timestamps: true});
const restrictedExtensions = new Schema(schema.restrictedExtensions, { strict: true,timestamps: true});
const tours = new Schema(schema.tours, { strict: true,timestamps: true});

const preCompaniesSchema= new Schema(schema.preCompanies, {strict: true, timestamps: true})
const bucketSchema= new Schema(schema.bucket, {strict: true, timestamps: true})
const globalFilterSchema= new Schema(schema.globalFilter, {strict: true, timestamps: true})
const userAuthSchema = new Schema(schema.userAuth, {strict: true, timestamps: true})
const resetAttemptSchema = new Schema(schema.resetAttempt, {strict: true, timestamps: true})
const sessionsSchema = new Schema(schema.sessions, {strict: true, timestamps: true})
const userDashboard = new Schema(schema.userDashboard, {strict:true,timestamps: true})
sessionsSchema.index({ createdAt: 1 }, { expireAfterSeconds: Number(process.env.SESSIONEXPIREDTIME || 172800) });
const referCodeSchema = new Schema(schema.refferalcodes, {strict: true, timestamps: true});
const refferalmapping = new Schema(schema.refferalmapping, {strict: true, timestamps: true});
const globalSettingsSchema = new Schema(schema.globalSettings, {strict: true, timestamps: true});
module.exports = { 
    timeSheetSchema, 
    historySchema, 
    userIdSchema, 
    usersSchema,
    adminDetailSchema,
    wasabicredentials, 
    ProjectTemplate, 
    timeTrackerDownload, 
    companies ,
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
    mainChatSchema,
    settingsSchema,
    appsSchema,
    notificationsSchema,
    notificationsSettingsSchema,
    mentionsSchema,
    taskSchema,
    commentSchema,
    projectRulesSchema,
    subscriptionPlanSchema,
    planFeatureSchema,
    planFeatureDisplaySchema,
    subscriptionsSchema,
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
    globalSettingsSchema
};
