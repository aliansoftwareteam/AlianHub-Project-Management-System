const { Schema } = require('mongoose');
const { schema } = require('./schema');
// P1-SEC-11 — Core entity schemas hardened to `strict: true`. The
// field lists in `./schema.js` cover every known write path; unknown
// fields are now silently dropped instead of persisted, which blocks
// the "send `{ roleType: 1 }` in the task body and watch it stick"
// privilege-escalation surface flagged in the security audit. If a
// new legitimate field needs to land, declare it in `./schema.js`.
const taskSchema = new Schema(schema.tasks, { strict: true, timestamps: true });
const commentSchema = new Schema(schema.comments, { strict: true, timestamps: true });
const timeSheetSchema = new Schema(schema.timesheet, { strict: true, timestamps: true });
// BUG-046 / #100 — every other schema in this file already uses
// `{ timestamps: true }` so Mongoose owns `createdAt`/`updatedAt` as
// BSON Dates. The history schema alone declared them as String/Date
// fields the callers populated manually with `DateTime.utc().ts`
// (a numeric millis value). That produced inconsistent shapes
// (number vs Date) across documents. Letting Mongoose own them gives
// us proper BSON Dates without callers having to remember to set them.
const historySchema = new Schema(schema.history, { strict: true, timestamps: true });
// `userId` here is the per-user *notification counters* document. It
// intentionally carries a dynamic set of keys (one entry per task /
// sprint / project) so `strict: false` is required — flipping it would
// silently drop every count increment.
const userIdSchema = new Schema(schema.userId, { strict: false, timestamps: true });
const usersSchema = new Schema(schema.users, { strict: true,timestamps: true});
const adminDetailSchema = new Schema(schema.adminDetail, { strict: true,timestamps: true});
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
const subscriptionPlanSchema = new Schema(schema.subscriptionPlan, {strict: true, timestamps: true});
// `planFeature` / `planFeatureDisplay` intentionally hold an open-ended
// feature map that varies by plan tier (`maxProjects`, `maxStorage`,
// etc.) — the only schema-declared field is `planName`. Locking it down
// would lose every feature flag at write time.
const planFeatureSchema = new Schema(schema.planFeature, {strict: false, timestamps: true});
const planFeatureDisplaySchema = new Schema(schema.planFeature, {strict: false, timestamps: true});
// Chargebee mirror collections. The shape comes from Chargebee's
// webhook payloads (different per object type, evolving with their API)
// — we store them verbatim. Schema strictness would drop fields the
// billing flow needs.
const subscriptionsSchema = new Schema(schema.subscriptions, {strict: false, timestamps: true});
const invoiceSchema = new Schema(schema.invoices, {strict: false,timestamps: true});
const creditNoteSchema= new Schema(schema.creditNotes, {strict: false, timestamps: true})
const globalCustomFieldsSchema= new Schema(schema.globalCustomFields, {strict: true, timestamps: true})
// `customFields` is the user-defined field-definition collection. Each
// row's schema varies by `cfType` (text vs select vs date vs …), so the
// shape is genuinely dynamic by design.
const customFieldsSchema= new Schema(schema.customFields, {strict: false, timestamps: true})
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
const webhooksSchema = new Schema(schema.webhooks, {strict: true, timestamps: true});
const webhookLogsSchema = new Schema(schema.webhookLogs, {strict: true, timestamps: true});
// webhook logs: always read newest-first per webhook; cap retention by query.
webhookLogsSchema.index({ webhookId: 1, createdAt: -1 });
const recentVisitsSchema = new Schema(schema.recentVisits, {strict: true, timestamps: true});
// recents: one doc per user+entity, always read newest-first per user.
recentVisitsSchema.index({ userId: 1, visitedAt: -1 });
recentVisitsSchema.index({ userId: 1, entityType: 1, entityId: 1 }, { unique: true });
const apiTokensSchema = new Schema(schema.apiTokens, {strict: true, timestamps: true});
apiTokensSchema.index({ tokenHash: 1 });
apiTokensSchema.index({ userId: 1 });
const apiActivityLogsSchema = new Schema(schema.apiActivityLogs, {strict: true, timestamps: true});
apiActivityLogsSchema.index({ tokenId: 1, createdAt: -1 });
const exportJobsSchema = new Schema(schema.exportJobs, {strict: true, timestamps: true});
exportJobsSchema.index({ userId: 1, createdAt: -1 });
const importJobsSchema = new Schema(schema.importJobs, {strict: true, timestamps: true});
importJobsSchema.index({ userId: 1, createdAt: -1 });
const epicsSchema = new Schema(schema.epics, {strict: true, timestamps: true});
epicsSchema.index({ ProjectID: 1, deletedStatusKey: 1 });
const pagesSchema = new Schema(schema.pages, {strict: true, timestamps: true});
pagesSchema.index({ parentPageId: 1, deletedStatusKey: 1 });
pagesSchema.index({ ProjectID: 1, deletedStatusKey: 1 });
const pageVersionsSchema = new Schema(schema.pageVersions, {strict: true, timestamps: true});
pageVersionsSchema.index({ pageId: 1, createdAt: -1 });
const publicSharesSchema = new Schema(schema.publicShares, {strict: true, timestamps: true});
publicSharesSchema.index({ token: 1 }, { unique: true });
const intakeItemsSchema = new Schema(schema.intakeItems, {strict: true, timestamps: true});
intakeItemsSchema.index({ publicShareId: 1, status: 1 });
const publicShareIndexSchema = new Schema(schema.publicShareIndex, {strict: true, timestamps: true});
publicShareIndexSchema.index({ token: 1 }, { unique: true });
const recurringTasksSchema = new Schema(schema.recurringTasks, {strict: true, timestamps: true});
recurringTasksSchema.index({ ProjectID: 1, deletedStatusKey: 1 });
recurringTasksSchema.index({ enabled: 1, deletedStatusKey: 1, nextRunAt: 1 });
const remindersSchema = new Schema(schema.reminders, {strict: true, timestamps: true});
remindersSchema.index({ userId: 1, fired: 1, reminderAt: 1 });
const notesSchema = new Schema(schema.notes, {strict: true, timestamps: true});
notesSchema.index({ userId: 1, deletedStatusKey: 1 });
const clipsSchema = new Schema(schema.clips, {strict: true, timestamps: true});
clipsSchema.index({ userId: 1, deletedStatusKey: 1 });
const timesheetApprovalSchema = new Schema(schema.timesheetApproval, {strict: true, timestamps: true});
timesheetApprovalSchema.index({ userId: 1, periodStart: 1, periodEnd: 1 });
timesheetApprovalSchema.index({ status: 1, periodStart: -1 });
const billingRatesSchema = new Schema(schema.billingRates, {strict: true, timestamps: true});
billingRatesSchema.index({ scope: 1, refId: 1, deletedStatusKey: 1 });
const ssoConfigsSchema = new Schema(schema.ssoConfigs, {strict: true, timestamps: true});
const auditLogsSchema = new Schema(schema.auditLogs, {strict: true, timestamps: true});
auditLogsSchema.index({ createdAt: -1 });
auditLogsSchema.index({ actorId: 1, createdAt: -1 });
auditLogsSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogsSchema.index({ action: 1, createdAt: -1 });
const scimConfigsSchema = new Schema(schema.scimConfigs, {strict: true, timestamps: true});
const ptoEntriesSchema = new Schema(schema.ptoEntries, {strict: true, timestamps: true});
ptoEntriesSchema.index({ userId: 1, startDate: 1 });
ptoEntriesSchema.index({ status: 1 });
const portfoliosSchema = new Schema(schema.portfolios, {strict: true, timestamps: true});
portfoliosSchema.index({ deletedStatusKey: 1 });
const savedReportsSchema = new Schema(schema.savedReports, {strict: true, timestamps: true});
savedReportsSchema.index({ deletedStatusKey: 1 });
const reportSchedulesSchema = new Schema(schema.reportSchedules, {strict: true, timestamps: true});
reportSchedulesSchema.index({ deletedStatusKey: 1 });
reportSchedulesSchema.index({ active: 1, nextRunAt: 1 });
const emailInboxesSchema = new Schema(schema.emailInboxes, {strict: true, timestamps: true});
emailInboxesSchema.index({ token: 1 });
emailInboxesSchema.index({ companyId: 1, deletedStatusKey: 1 });
const calendarFeedsSchema = new Schema(schema.calendarFeeds, {strict: true, timestamps: true});
calendarFeedsSchema.index({ token: 1 });
calendarFeedsSchema.index({ companyId: 1, deletedStatusKey: 1 });
const automationRulesSchema = new Schema(schema.automationRules, {strict: true, timestamps: true});
automationRulesSchema.index({ deletedStatusKey: 1 });
const integrationConnectionsSchema = new Schema(schema.integrationConnections, {strict: true, timestamps: true});
integrationConnectionsSchema.index({ type: 1, deletedStatusKey: 1 });
const devMessagesSchema = new Schema(schema.devMessages, {strict: true, timestamps: true});
devMessagesSchema.index({ taskId: 1, createdAt: 1 });
devMessagesSchema.index({ role: 1, status: 1, createdAt: 1 });
// Global search: one combined text index per collection.
taskSchema.index({ TaskName: 'text', rawDescription: 'text' });
projectsSchema.index({ ProjectName: 'text' });
commentSchema.index({ message: 'text' });

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
    webhooksSchema,
    webhookLogsSchema,
    recentVisitsSchema,
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
    remindersSchema,
    notesSchema,
    clipsSchema,
    timesheetApprovalSchema,
    billingRatesSchema,
    ssoConfigsSchema,
    auditLogsSchema,
    scimConfigsSchema,
    ptoEntriesSchema,
    portfoliosSchema,
    savedReportsSchema,
    reportSchedulesSchema,
    emailInboxesSchema,
    calendarFeedsSchema,
    automationRulesSchema,
    integrationConnectionsSchema,
    devMessagesSchema,
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
