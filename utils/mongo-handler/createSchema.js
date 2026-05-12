const { Schema } = require('mongoose');
const { schema } = require('./schema');
const taskSchema = new Schema(schema.tasks, { strict: false, timestamps: true });
const commentSchema = new Schema(schema.comments, { strict: false, timestamps: true });
const timeSheetSchema = new Schema(schema.timesheet, { strict: false, timestamps: true });
const historySchema = new Schema(schema.history);
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

// BUG-021 / #75 — Indexes for the hottest query paths. Each company has its
// own MongoDB database, so `companyId` itself is the database name and need
// not be indexed; what matters is the per-DB filter fields. Compound order
// follows ESR (Equality → Sort → Range) where applicable.
//
// All indexes are background-built and idempotent (Mongoose's
// ensureIndexes/syncIndexes only creates missing ones at startup).

// --- Per-company collections -------------------------------------------------

// tasks: list / filter / lookup hot paths.
taskSchema.index({ ProjectID: 1, sprintId: 1, deletedStatusKey: 1 });
taskSchema.index({ sprintId: 1, deletedStatusKey: 1 });
taskSchema.index({ AssigneeUserId: 1 });
taskSchema.index({ ParentTaskId: 1 });
taskSchema.index({ TaskKey: 1 });

// comments: every comment is fetched by task/sprint/project triplet.
commentSchema.index({ 'objId.taskId': 1, deletedStatusKey: 1 });
commentSchema.index({ 'objId.sprintId': 1 });
commentSchema.index({ 'objId.projectId': 1 });

// history: by task and by project (timeline display).
historySchema.index({ TaskId: 1, createdAt: -1 });
historySchema.index({ ProjectId: 1, createdAt: -1 });

// timesheet: by task ID (timesheet linking) and by user.
timeSheetSchema.index({ TicketID: 1 });
timeSheetSchema.index({ userId: 1, ProjectId: 1 });

// userId notification counters — keyed by user.
userIdSchema.index({ userId: 1 });

// sprints/folders/projects: secondary lookups.
sprints.index({ ProjectID: 1, deletedStatusKey: 1 });
folders.index({ ProjectID: 1 });
projectsSchema.index({ deletedStatusKey: 1 });

// --- Global DB collections (the "global" company DB) ------------------------

// users: login lookup by email is the hottest path; membership lookup by
// AssignCompany is required by BUG-013's per-request membership re-check.
usersSchema.index({ Employee_Email: 1 });
usersSchema.index({ AssignCompany: 1 });

// userAuth: email is the lookup key.
userAuthSchema.index({ email: 1 });

// companyUsers: lookup by userId + invitation status.
companyUserSchema.index({ userId: 1 });

// sessions: refresh-token lookup is what `Config/jwt.js` does.
sessionsSchema.index({ refreshToken: 1 });
sessionsSchema.index({ userId: 1 });

// resetAttempt: keyed by IP.
resetAttemptSchema.index({ ip: 1 });
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
