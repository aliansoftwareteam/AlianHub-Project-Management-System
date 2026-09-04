const mongoose = require('mongoose');
const schema = {
    tasks: {
        "legacyId": {
            type: String,
            required: false
        },
        'TaskName': {
            type: String,
            required: true,
        },
        'TaskKey': {
            type: String,
            required: true,
        },
        'AssigneeUserId': {
            type: Array,
            default: [],
            required: false,
        },
        'watchers': {
            type: Array,
            default: [],
            required: false,
        },
        'DueDate': {
            type: Date,
            required: false,
        },
        'dueDateDeadLine': {
            type: Array,
            default: [],
            required: false,
        },
        'TaskType': {
            type: String,
            required: true,
        },
        'TaskTypeKey': {
            type: Number,
            required: true,
        },
        'ParentTaskId': {
            type: String,
            required: false,
        },
        'ProjectID': {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        'CompanyId': {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        'status': {
            type: Object,
            required: true,
        },
        'isParentTask': {
            type: Boolean,
            required: true,
        },
        'Task_Leader': {
            type: String,
            required: true,
        },
        'sprintArray': {
            type: Object,
            required: true,
        },
        'Task_Priority': {
            type: String,
            required: true,
        },
        'deletedStatusKey': {
            type: Number,
            required: true,
        },
        'sprintId': {
            type:  mongoose.Schema.Types.ObjectId,
            required: true,
        },
        'groupByAssigneeIndex': {
            type: Number,
            required: false,
        },
        'groupByPriorityIndex': {
            type: Number,
            required: false,
        },
        'groupByDueDateIndex': {
            type: Number,
            required: false,
        },
        'groupByStatusIndex': {
            type: Number,
            required: false,
        },
        'queueListArray': {
            type: Array,
            required: false,
        },
        'attachments': {
            type: Array,
            required: false,
        },
        // Task-to-task links: [{ taskId: ObjectId, type: 'blocks'|'blocked_by'|
        // 'duplicates'|'duplicated_by'|'relates_to', createdBy, createdAt }] —
        // written only by Modules/Tasks/helpers/taskMongo/relations.js
        'relations': {
            type: Array,
            default: [],
            required: false,
        },
        // Emoji reactions: [{ emoji, userId, createdAt }], one entry per
        // user+emoji — written only by Modules/Reactions/controller.js
        'reactions': {
            type: Array,
            default: [],
            required: false,
        },
        // Optional epic membership — managed by Modules/Epics
        'epicId': {
            type: mongoose.Schema.Types.ObjectId,
            required: false,
        },
        'checklistArray': {
            type: Array,
            required: false,
        },
        'tagsArray': {
            type: Array,
            required: false,
        },
        'favouriteTasks': {
            type: Array,
            required: false,
        },
        'subTasks': {
            type: Number,
            required: false,
        },
        'rawDescription': {
            type: String,
            required: false,
        },
        'description': {
            type: String,
            required: false,
        },
        'statusType': {
            type: String,
            required: true,
        },
        'startDate': {
            type: Date,
            required: false,
        },
        'statusKey': {
            type: Number,
            required: true,
        },
        'updateToken':{
            type: Object,
            required: false,
        },
        'islocalSnapStop':{
            type: Boolean,
            required: false,
        },
        'folderObjId': {
            type: mongoose.Schema.Types.ObjectId,
            required: false,
        },
        // Provenance of Done — written only by Modules/Tasks/helpers/completion.js:
        // { workBy: [{ actorId, actorType, agentId?, viaAccount, hours }],
        //   checkedBy: { actorId, actorType:'human', at } | null,
        //   closedBy:  { actorId, actorType:'human', at } | null,
        //   badge: 'HUMAN'|'AGENT'|'MIXED'|'UNCHECKED'|null, reopenCount }
        'completion': {
            type: Object,
            required: false,
        },
        // External links (PR, branch, doc, url) attached through task.link:
        // [{ url, kind, label, addedBy, actorType, agentId?, addedAt }]
        'links': {
            type: Array,
            default: [],
            required: false,
        },
        descriptionBlock: {
            type : Object,
            required: false
        },
        customField: {
            type: Object,
            required: false
        },
        lastMessage: {
            type: Date,
            required:false
        },
        message: {
            type: String,
            required: false
        },
        // Marks this task as a one-to-one main-chat conversation (a task in the
        // hidden `default` chat project) rather than a normal task.
        //
        // This schema is built with `strict: true` (P1-SEC-11, see
        // createSchema.js), so an UNDECLARED field is silently dropped on save.
        // `mainChat` was set by the chat creator but never declared here, so it
        // never persisted — and the one-to-one list filters on exactly this flag
        // (`{ mainChat: true, AssigneeUserId }` in Modules/MainChats/controller.js
        // setChats). The conversation therefore worked in-session but vanished
        // from the list on reload. Channels were unaffected because they are
        // sprints, not tasks. Declaring it makes the flag stick.
        mainChat: {
            type: Boolean,
            required: false
        },
        totalEstimatedTime:{
            type: Number,
            required: false
        },
        remainingHours:{
            type: Number,
            required: false
        },
        // AHE — set true when a task's estimate is RE-updated (changed after it was
        // first set). Surfaced in the Project Timesheet so a TL sees which tasks had
        // their estimate changed. Permanent for now; a manual clear will be added later.
        estimateChangedFlag: {
            type: Boolean,
            default: false,
            required: false
        },
        points: {
            type: Number,
            default: null,
            required: false
        }
    },
    timesheet: {
        LogDescription: {
            type: String,
            required: true,
        },
        LogEndTime: {
            type: Number,
            required: true,
        },
        LogStartTime: {
            type: Number,
            required: true,
        },
        LogTimeDuration: {
            type: Number,
            required: true,
        },
        Loggeduser: {
            type: String,
            required: true,
        },
        ProjectId: {
            type: String,
            required: true,
        },
        TicketID: {
            type: String,
            required: true,
        },
        logAddType: {
            type: Number,
            required: false,
        },
        trackShots: {
            type: Array,
            default: [],
            required: false,
        },
        startTimeTracker: {
            type: Number,
            required: false,
        },
        billable: {
            type: Boolean,
            default: true,
            required: false,
        },
        actorType: {
            type: String,
            required: false,
        },
        agentId: {
            type: String,
            required: false,
        },
        viaAccount: {
            type: String,
            required: false,
        },
        runId: {
            type: String,
            required: false,
        },
    },
    history: {
        Key: {
            type: String,
            required: true,
        },
        Message: {
            type: String,
            required: true,
        },
        ProjectId: {
            type: String,
            required: true,
        },
        TaskId: {
            type: String,
            required: false,
        },
        Type: {
            type: String,
            required: true,
        },
        UserId: {
            type: String,
            required: true,
        },
        // BUG-046 / #100: createdAt/updatedAt are populated by Mongoose
        // (`timestamps: true` on historySchema). Keep the field
        // declarations so older code paths that still reference the
        // shape don't break, but drop `required: true` — Mongoose
        // sets them on `.save()` automatically; requiring them on every
        // update would reject legacy docs that lacked them.
        createdAt: {
            type: Date,
        },
        updatedAt: {
            type: Date,
        },
    },
    userId: {
        userId: {
            type: String,
            required: true
        },
    },
    // Per-user recently-visited entities (one doc per user+entity, upserted
    // on every visit) — written only by Modules/RecentVisits/controller.js
    recentVisits: {
        userId: {
            type: String,
            required: true,
        },
        entityType: {
            type: String,
            required: true,
        },
        entityId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        visitedAt: {
            type: Date,
            required: true,
        },
    },
    // Personal API tokens (hashed at rest; prefix shown for identification)
    // — managed by Modules/ApiTokens
    apiTokens: {
        name: { type: String, required: true },
        tokenHash: { type: String, required: true },
        prefix: { type: String, required: true },
        scopes: { type: Array, default: [], required: false },
        userId: { type: String, required: true },
        active: { type: Boolean, default: true, required: false },
        expiresAt: { type: Date, required: false },
        lastUsedAt: { type: Date, required: false },
        // 'user' (a script acting as the person) or 'agent' (a CLI/coding agent —
        // the action registry applies). Absent means 'user'.
        kind: { type: String, required: false },
        agentId: { type: String, required: false },
        // { mode: 'workspace'|'personal'|'local', provider, linkedAt, label }
        agentAccount: { type: Object, required: false },
        // Contractor narrowing: when set, tasks.next / tasks.search stay inside these projects.
        projectIds: { type: Array, default: [], required: false },
    },
    // Per-call audit of token-authenticated API requests
    apiActivityLogs: {
        tokenId: { type: mongoose.Schema.Types.ObjectId, required: true },
        method: { type: String, required: true },
        path: { type: String, required: true },
        statusCode: { type: Number, required: false },
        durationMs: { type: Number, required: false },
        ip: { type: String, required: false },
    },
    // Async export jobs — managed by Modules/ExportJobs
    exportJobs: {
        userId: { type: String, required: true },
        type: { type: String, required: true },
        format: { type: String, required: true },
        filters: { type: Object, required: false },
        status: { type: String, required: true },
        fileName: { type: String, required: false },
        filePath: { type: String, required: false },
        total: { type: Number, required: false },
        processed: { type: Number, required: false },
        error: { type: String, required: false },
    },
    // Async import jobs (jira first) — managed by Modules/Importers
    importJobs: {
        userId: { type: String, required: true },
        source: { type: String, required: true },
        projectId: { type: mongoose.Schema.Types.ObjectId, required: true },
        sprintId: { type: mongoose.Schema.Types.ObjectId, required: false },
        status: { type: String, required: true },
        total: { type: Number, required: false },
        processed: { type: Number, required: false },
        created: { type: Number, required: false },
        errorList: { type: Array, default: [], required: false },
        mapping: { type: Object, required: false },
        fileName: { type: String, required: false },
    },
    // Epics: a grouping layer above tasks with progress roll-up
    epics: {
        name: { type: String, required: true },
        description: { type: String, required: false },
        ProjectID: { type: mongoose.Schema.Types.ObjectId, required: true },
        color: { type: String, required: false },
        status: { type: String, required: false },
        priority: { type: String, required: false },
        ownerUserId: { type: String, required: false },
        startDate: { type: Date, required: false },
        dueDate: { type: Date, required: false },
        createdBy: { type: String, required: false },
        taskCount: { type: Number, default: 0, required: false },
        completedCount: { type: Number, default: 0, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Recurring task definitions — managed by Modules/RecurringTasks, instantiated by the cron / run-due endpoint
    recurringTasks: {
        name: { type: String, required: true },
        ProjectID: { type: mongoose.Schema.Types.ObjectId, required: true },
        sprintId: { type: String, required: false },
        enabled: { type: Boolean, default: true },
        freq: { type: String, required: true },
        interval: { type: Number, default: 1 },
        byweekday: { type: Array, default: [] },
        monthday: { type: Number, required: false },
        runHour: { type: Number, default: 9 },
        skipIfOpen: { type: Boolean, default: false },
        until: { type: Date, required: false },
        nextRunAt: { type: Date, required: false },
        lastRunAt: { type: Date, required: false },
        lastInstanceTaskId: { type: String, required: false },
        runCount: { type: Number, default: 0 },
        templateSnapshot: { type: Object, required: true },
        projectSnapshot: { type: Object, required: false },
        userSnapshot: { type: Object, required: false },
        sprintArray: { type: Object, required: false },
        createdBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0 },
    },
    // Personal reminders (COLLAB-03) — one-shot, per-user. A node-schedule cron
    // (every minute) fires any reminder whose reminderAt has passed and that
    // hasn't fired yet, delivering an in-app notification to userId. Managed by
    // Modules/Reminders. fired/firedAt make the firing idempotent.
    reminders: {
        userId: { type: String, required: true },
        companyId: { type: String, required: false },
        taskId: { type: mongoose.Schema.Types.ObjectId, required: false },
        projectId: { type: mongoose.Schema.Types.ObjectId, required: false },
        reminderText: { type: String, required: false },
        reminderAt: { type: Date, required: true },
        fired: { type: Boolean, default: false },
        firedAt: { type: Date, required: false },
        createdBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0 },
    },
    // Due-index for general reminders, stored in the GLOBAL database.
    //
    // Reminders themselves live in per-company databases, so finding what is due
    // would otherwise mean opening a connection to EVERY company every minute —
    // which pins one live connection per tenant and never lets them idle out.
    // This index holds one tiny pointer row per pending reminder, so the
    // scheduler reads the global DB once and only connects to the companies that
    // actually have work. Rows are removed when a reminder fires, completes or
    // is deleted. It is a derived cache: it can be rebuilt from the per-company
    // collections and never holds reminder content.
    general_reminder_queue: {
        companyId: { type: String, required: true },
        reminderId: { type: String, required: true },
        notifyAt: { type: Date, required: true },
    },
    // Standalone, general-purpose reminders — the header "Reminder" dialog.
    // Deliberately a separate collection from `reminders` above (which is the
    // task-scoped "Remind me" flow) because these are not tied to a task and
    // carry their own title, description, notify lead-time, attachments and
    // recipient. Managed by Modules/GeneralReminders.
    general_reminders: {
        title: { type: String, required: true },
        description: { type: String, required: false },
        // Who the reminder is for ("For me" = the creator).
        userId: { type: String, required: true },
        createdBy: { type: String, required: false },
        companyId: { type: String, required: false },
        remindAt: { type: Date, required: true },
        // Lead time in minutes before remindAt. 0 = on due date, -1 = don't notify.
        notifyBefore: { type: Number, default: 0 },
        // Denormalised firing moment (remindAt - notifyBefore) so the cron can use
        // a single indexed range query.
        notifyAt: { type: Date, required: false },
        // [{ name, url, extension, size }]
        attachments: { type: Array, default: [] },
        fired: { type: Boolean, default: false },
        firedAt: { type: Date, required: false },
        isDone: { type: Boolean, default: false },
        completedAt: { type: Date, required: false },
        deletedStatusKey: { type: Number, default: 0 },
    },
    // Personal notepad (COLLAB-06) — quick per-user notes, convertible to tasks.
    // Managed by Modules/Notes. convertedTaskId is stamped (frontend) once a note
    // has been turned into a task via the existing task-create flow.
    notes: {
        userId: { type: String, required: true },
        companyId: { type: String, required: false },
        title: { type: String, required: false },
        content: { type: String, required: false },
        convertedTaskId: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0 },
    },
    // Clips (COLLAB-04) — first-class, reusable screen/voice recordings owned by
    // a user and company-scoped. Recorded once, stored once (the media file is
    // uploaded via the EXISTING storage endpoint; only its url is kept here),
    // then referenced anywhere (task attachment, comment, share, or the owner's
    // library). Managed by Modules/Clips.
    clips: {
        clipId: { type: String, required: false },
        userId: { type: String, required: true },
        companyId: { type: String, required: false },
        title: { type: String, required: false },
        url: { type: String, required: true },
        mediaType: { type: String, required: false },
        mimeType: { type: String, required: false },
        size: { type: Number, required: false },
        durationSec: { type: Number, required: false },
        source: { type: String, required: false },
        // Stamped by the client after a clip has been turned into a task through
        // the existing task-create flow, mirroring notes.convertedTaskId.
        convertedTaskId: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0 },
    },
    // Timesheet approval submissions — one per user per period (week/month) — managed by Modules/TimesheetApproval
    timesheetApproval: {
        userId: { type: String, required: true },
        periodType: { type: String, default: 'week', required: false },
        periodStart: { type: Date, required: true },
        periodEnd: { type: Date, required: true },
        status: { type: String, default: 'submitted', required: false },
        totalMinutes: { type: Number, default: 0, required: false },
        entryCount: { type: Number, default: 0, required: false },
        note: { type: String, required: false },
        submittedAt: { type: Date, required: false },
        submittedBy: { type: String, required: false },
        reviewedAt: { type: Date, required: false },
        reviewedBy: { type: String, required: false },
        reviewerName: { type: String, required: false },
        rejectionReason: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Billing rates — per user / project / default hourly rate — managed by Modules/TimeSheet (TIME-07)
    billingRates: {
        scope: { type: String, required: true },
        refId: { type: String, default: '', required: false },
        rate: { type: Number, required: true },
        currency: { type: String, default: 'USD', required: false },
        createdBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Per-company enterprise SSO config (OIDC/SAML) — managed by Modules/SSO (SEC-02)
    ssoConfigs: {
        provider: { type: String, default: 'oidc', required: false },
        isEnabled: { type: Boolean, default: false, required: false },
        displayName: { type: String, default: '', required: false },
        domains: { type: [String], default: [], required: false },
        enforcement: { type: String, default: 'optional', required: false },
        autoProvisionUsers: { type: Boolean, default: true, required: false },
        defaultRoleType: { type: Number, default: 3, required: false },
        oidc: { type: Object, required: false },
        saml: { type: Object, required: false },
        createdBy: { type: String, required: false },
        updatedBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Immutable audit trail — managed by Modules/Audit (SEC-04). Insert-only;
    // pruned by retention. No deletedStatusKey (rows are never soft-deleted).
    auditLogs: {
        actorId: { type: String, required: false },
        actorName: { type: String, required: false },
        action: { type: String, required: true },
        entityType: { type: String, required: false },
        entityId: { type: String, required: false },
        entityName: { type: String, required: false },
        meta: { type: Object, required: false },
        ip: { type: String, required: false },
    },
    // Per-company SCIM 2.0 provisioning config — managed by Modules/Scim (SEC-05).
    // The IdP-held bearer token is stored only as a bcrypt hash; the company is
    // resolved from the token itself, so SCIM requests carry no companyId header.
    scimConfigs: {
        isEnabled: { type: Boolean, default: false, required: false },
        tokenHash: { type: String, required: false },
        tokenLast4: { type: String, required: false },
        defaultRoleType: { type: Number, default: 3, required: false },
        createdBy: { type: String, required: false },
        updatedBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Time-off / PTO entries — managed by Modules/Pto (SEC-08). Approved entries
    // reduce a user's available capacity (helpers/ptoRules.computeAvailableCapacity).
    ptoEntries: {
        userId: { type: String, required: true },
        type: { type: String, default: 'casual', required: false },
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        hoursPerDay: { type: Number, default: 8, required: false },
        status: { type: String, default: 'pending', required: false },
        reason: { type: String, required: false },
        approvedBy: { type: String, required: false },
        createdBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Cross-project portfolios — managed by Modules/Portfolio (REP-01). Groups N
    // projects for a rolled-up leadership/CEO view (progress / at-risk / milestones).
    portfolios: {
        name: { type: String, required: true },
        projectIds: { type: Array, default: [], required: false },
        description: { type: String, required: false },
        createdBy: { type: String, required: false },
        updatedBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Saved custom reports — managed by Modules/CustomReports (REP-02). A report
    // config (metric + dimension + filters + chartType) resolved by a whitelisted
    // query engine; values are validated against an allow-list, never raw fields.
    savedReports: {
        name: { type: String, required: true },
        source: { type: String, default: 'tasks', required: false },
        metric: { type: String, default: 'count', required: false },
        dimension: { type: String, default: 'statusType', required: false },
        filters: { type: Object, default: {}, required: false },
        chartType: { type: String, default: 'bar', required: false },
        createdBy: { type: String, required: false },
        updatedBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Scheduled report deliveries — managed by Modules/ScheduledReports (REP-08).
    // Emails a saved report (savedReportId) to recipients on a cadence; nextRunAt
    // is advanced after each run so the prod cron stays idempotent.
    reportSchedules: {
        savedReportId: { type: String, required: true },
        cadence: { type: String, default: 'weekly', required: false },
        recipients: { type: Array, default: [], required: false },
        active: { type: Boolean, default: true, required: false },
        lastRunAt: { type: Date, required: false },
        nextRunAt: { type: Date, required: false },
        createdBy: { type: String, required: false },
        updatedBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Email-to-task inboxes — managed by Modules/EmailIn (AUTO-01). Lives in the
    // GLOBAL db keyed by token so the unauthenticated inbound webhook can resolve
    // token -> company. Snapshots project/sprint/user so taskMongo.create needs no reload.
    emailInboxes: {
        token: { type: String, required: true },
        companyId: { type: String, required: true },
        name: { type: String, required: false },
        ProjectID: { type: mongoose.Schema.Types.ObjectId, required: false },
        sprintId: { type: String, required: false },
        templateSnapshot: { type: Object, default: {}, required: false },
        projectSnapshot: { type: Object, default: {}, required: false },
        userSnapshot: { type: Object, default: {}, required: false },
        sprintArray: { type: Object, default: {}, required: false },
        enabled: { type: Boolean, default: true, required: false },
        createdBy: { type: String, required: false },
        lastEmailFrom: { type: String, required: false },
        lastTaskId: { type: String, required: false },
        lastReceivedAt: { type: Date, required: false },
        receivedCount: { type: Number, default: 0, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Calendar feeds — managed by Modules/Calendar (AUTO-02). Token-keyed in the
    // GLOBAL db; an unauthenticated .ics URL resolves its company + scope.
    calendarFeeds: {
        token: { type: String, required: true },
        companyId: { type: String, required: true },
        userId: { type: String, required: false },
        scope: { type: String, default: 'my', required: false },
        projectId: { type: String, required: false },
        name: { type: String, required: false },
        enabled: { type: Boolean, default: true, required: false },
        createdBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Automation rules — managed by Modules/Automations (AUTO-03). conditions
    // (which tasks) + actions (set_priority); applied on demand as a bulk update.
    automationRules: {
        name: { type: String, required: true },
        // v1 stored a bare trigger name ("task_created"); v2 stores
        // { type, event, cron, tz }. Mixed so both shapes validate — existing
        // rules keep working untouched, and the matcher reads either
        // (`rule.trigger.event || rule.trigger`). Narrowing this to Object would
        // orphan every rule already saved.
        trigger: { type: mongoose.Schema.Types.Mixed, default: 'manual', required: false },
        version: { type: Number, default: 1, required: false },
        conditions: { type: Object, default: {}, required: false },
        // v1 flat action list. Kept because the on-demand bulk `apply` still
        // reads it; v2 rules use `steps` instead.
        actions: { type: Array, default: [], required: false },
        steps: { type: Array, default: [], required: false },
        scope: { type: Object, default: {}, required: false },
        limits: { type: Object, default: {}, required: false },
        stats: { type: Object, default: {}, required: false },
        // Opt-in to reacting to automation-authored events. Off by default: this
        // is the switch that stops rule A and rule B triggering each other forever.
        reactToAutomation: { type: Boolean, default: false, required: false },
        enabled: { type: Boolean, default: true, required: false },
        lastRunAt: { type: Date, required: false },
        lastRunCount: { type: Number, default: 0, required: false },
        createdBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Canonical domain events, written by event/domainEventBus.js. Phase 0 of the
    // automation engine records envelopes without acting on them, so we can read a
    // week of real traffic and find the events we don't yet emit before the matcher
    // is built against the wrong shape. Capped by TTL — this is a diagnostic log,
    // never a source of truth.
    automationEventLog: {
        eventId: { type: String, required: true },
        type: { type: String, required: true },
        occurredAt: { type: Date, required: true },
        actor: { type: Object, default: {}, required: false },
        depth: { type: Number, default: 0, required: false },
        scope: { type: Object, default: {}, required: false },
        entity: { type: Object, default: {}, required: false },
        changedFields: { type: Array, default: [], required: false },
        hasPrevious: { type: Boolean, default: false, required: false },
    },
    // One document per rule execution. `cursor` is what makes a container restart
    // mid-run resumable instead of replaying: the runner writes it after every
    // step, so a resumed run picks up at the next step rather than re-applying
    // mutations that already landed.
    // What an agent has already reported for a task, keyed on the STABLE fact id
    // rather than the finding's title. The model re-words the same defect on every
    // run ("Shorten meta description to 160 characters" one run, "…to avoid
    // truncation" the next), so title-based dedup silently fails and the board
    // fills with the same six defects again and again.
    agentFindings: {
        projectId: { type: String, required: true },
        taskId: { type: String, required: true },
        factId: { type: String, required: true },
        skill: { type: String, required: false },
        subtaskId: { type: String, required: false },
        title: { type: String, required: false },
        severity: { type: String, required: false },
        // open | resolved | wontfix — `wontfix` is set by a human and is never
        // re-filed, which is how the "ignore this check" list learns itself.
        status: { type: String, default: 'open', required: false },
        occurrences: { type: Number, default: 1, required: false },
        firstSeenAt: { type: Date, required: false },
        lastSeenAt: { type: Date, required: false },
    },
    // Agents as teammates — managed by Modules/Agents.
    agents: {
        name: { type: String, required: true },
        slug: { type: String, required: false },
        description: { type: String, required: false },
        ownerId: { type: String, required: false },
        skills: { type: Array, default: [], required: false },
        // Subset of Modules/Agents/registry.js keys this agent may use. Empty = every registry action.
        allowedActions: { type: Array, default: [], required: false },
        projectIds: { type: Array, default: [], required: false },
        // 0 suggest everything · 1 act on low risk · 2 act on medium, propose the rest · 3 also on a schedule
        autonomy: { type: Number, default: 0, required: false },
        spendCapUsd: { type: Number, default: 30, required: false },
        // { month: 'YYYY-MM', usd, tokens, runs }
        spendMonth: { type: Object, required: false },
        paused: { type: Boolean, default: false, required: false },
        pausedReason: { type: String, required: false },
        pausedAt: { type: Date, required: false },
        // 'workspace' | 'personal' | 'local'
        account: { type: String, default: 'workspace', required: false },
        model: { type: String, required: false },
        schedule: { type: Object, required: false },
        rateLimitPerDay: { type: Number, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    agentRuns: {
        agentId: { type: String, required: true },
        agentName: { type: String, required: false },
        taskId: { type: String, required: false },
        projectId: { type: String, required: false },
        skill: { type: String, required: false },
        trigger: { type: String, required: false },
        // queued | running | waiting_approval | done | failed | stopped
        status: { type: String, default: 'queued', required: true },
        viaAccount: { type: String, required: false },
        startedBy: { type: String, required: false },
        startedAt: { type: Date, required: false },
        finishedAt: { type: Date, required: false },
        elapsedMs: { type: Number, default: 0, required: false },
        // { tokens, usd, model, billedToWorkspace }
        spend: { type: Object, required: false },
        actions: { type: Array, default: [], required: false },
        proposals: { type: Array, default: [], required: false },
        refusals: { type: Number, default: 0, required: false },
        outcome: { type: String, required: false },
        error: { type: String, required: false },
    },
    agentProposals: {
        agentId: { type: String, required: true },
        agentName: { type: String, required: false },
        runId: { type: String, required: false },
        taskId: { type: String, required: false },
        projectId: { type: String, required: false },
        what: { type: String, required: true },
        why: { type: String, required: false },
        // [{ action, params, label, reversible }] — every action a registry key
        changes: { type: Array, default: [], required: false },
        // pending | approved | edited | declined | undone
        status: { type: String, default: 'pending', required: true },
        gate: { type: String, required: false },
        priority: { type: String, required: false },
        decidedBy: { type: String, required: false },
        decidedAt: { type: Date, required: false },
        undoUntil: { type: Date, required: false },
        auditIds: { type: Array, default: [], required: false },
        cost: { type: Object, required: false },
    },
    automationRuns: {
        ruleId: { type: String, required: true },
        ruleName: { type: String, required: false },
        eventId: { type: String, required: true },
        eventType: { type: String, required: false },
        entity: { type: Object, default: {}, required: false },
        envelope: { type: Object, default: {}, required: false },
        status: { type: String, default: 'queued', required: true },
        cursor: { type: Number, default: 0, required: false },
        attempts: { type: Number, default: 0, required: false },
        steps: { type: Array, default: [], required: false },
        outputs: { type: Object, default: {}, required: false },
        error: { type: String, required: false },
        startedAt: { type: Date, required: false },
        finishedAt: { type: Date, required: false },
    },
    // Integration connections — managed by Modules/Integrations (AUTO-04). Generic
    // registry backing the marketplace, Slack and iframe apps. Secrets live in
    // config but are redacted before reaching the client.
    integrationConnections: {
        type: { type: String, required: true },
        name: { type: String, required: false },
        config: { type: Object, default: {}, required: false },
        status: { type: String, default: 'connected', required: false },
        enabled: { type: Boolean, default: true, required: false },
        createdBy: { type: String, required: false },
        connectedAt: { type: Date, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // AHE-3838 — one row per (user, cloud storage provider). Distinct from
    // integrationConnections above, which holds the COMPANY's app registration:
    // every person has their own Drive, so the OAuth grant has to be per-user.
    // Tokens are AES-256-GCM ciphertext (Modules/CloudStorage/helpers/cloudCrypto),
    // never plaintext, and are never returned to the browser.
    cloudStorageConnections: {
        provider: { type: String, required: true },      // google_drive | dropbox
        userId: { type: String, required: true },
        // The user's OWN app registration for this provider (client id/secret,
        // api key, app id / app key). Per-user, not per-company: one member must
        // never see or overwrite another's credentials, and two people may point
        // at the same drive account independently.
        //
        // MUST stay declared — this sub-schema is strict: true, so an undeclared
        // path is silently dropped on save and only shows up as data that
        // vanishes after a reload.
        config: { type: Object, default: {}, required: false },
        accountEmail: { type: String, required: false },
        accountName: { type: String, required: false },
        accessToken: { type: String, required: false },  // encrypted
        refreshToken: { type: String, required: false },  // encrypted
        expiresAt: { type: Date, required: false },
        scope: { type: String, required: false },
        // 'connected' | 'reauth_required' — set to reauth_required when the
        // provider rejects our refresh token, so the UI can prompt instead of
        // failing every pick with an opaque error.
        status: { type: String, default: 'connected', required: false },
        lastUsedAt: { type: Date, required: false },
        connectedAt: { type: Date, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Wiki pages (Editor.js blocks; versioned) — managed by Modules/Pages
    pages: {
        title: { type: String, required: true },
        content: { type: Object, required: false },
        rawText: { type: String, required: false },
        parentPageId: { type: mongoose.Schema.Types.ObjectId, required: false },
        ProjectID: { type: mongoose.Schema.Types.ObjectId, required: false },
        createdBy: { type: String, required: false },
        updatedBy: { type: String, required: false },
        order: { type: Number, required: false },
        // Tasks this doc is attached to. Held on the DOC, not on the task: one place to
        // read and write, and a doc knows what it belongs to without a second lookup.
        // A project link needs no field of its own — ProjectID above already is one.
        linkedTasks: { type: [mongoose.Schema.Types.ObjectId], required: false, default: [] },
        // 'project' (anyone who can see the project) or 'private' (only its author).
        visibility: { type: String, required: false, default: 'project' },
        isWiki: { type: Boolean, required: false, default: false },
        ownerId: { type: String, required: false },
        reviewDate: { type: Date, required: false },
        reviewedAt: { type: Date, required: false },
        reviewedBy: { type: String, required: false },
        createdByAgent: { type: Boolean, required: false, default: false },
        agentName: { type: String, required: false },
        // 'draft' until a person approves an agent-written page.
        agentStatus: { type: String, required: false },
        approvedBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    pageVersions: {
        pageId: { type: mongoose.Schema.Types.ObjectId, required: true },
        title: { type: String, required: false },
        content: { type: Object, required: false },
        rawText: { type: String, required: false },
        savedBy: { type: String, required: false },
    },
    // Public share links for sprints/projects (+ optional intake form)
    publicShares: {
        entityType: { type: String, required: true },
        entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        token: { type: String, required: true },
        enabled: { type: Boolean, default: true, required: false },
        allowIntake: { type: Boolean, default: false, required: false },
        createdBy: { type: String, required: false },
        expiresAt: { type: Date, required: false },
        passwordHash: { type: String, required: false },
    },
    /* Forms — a form belongs to a project and files every submission as a task in
     * one sprint. That sprint IS the response list: there is no separate response
     * store, nothing to read them in, and nothing to keep in step with the tasks.
     *
     * `questions` is an untyped Array on purpose: a question's shape depends on
     * what it binds to, and pinning a sub-schema here would mean editing this file
     * for every new field type. The module validates it instead. Everything else
     * stays declared — this sub-schema is strict, so an undeclared path is dropped
     * on save and only shows up later as data that vanished.
     *
     * Each question is { id, label, help, fieldKey, fieldSource, required, order }
     * where fieldSource is 'task' | 'custom' and fieldKey names what it fills.
     */
    forms: {
        title: { type: String, required: true },
        description: { type: String, default: '', required: false },
        ProjectID: { type: mongoose.Schema.Types.ObjectId, required: true },
        // Where submissions land. Held on the form so a submission needs no
        // lookup and cannot be pointed at another project's sprint.
        sprintId: { type: mongoose.Schema.Types.ObjectId, required: false },
        questions: { type: Array, default: [], required: false },
        // Applied to every submission task.
        defaults: { type: Object, default: {}, required: false },
        // Presentation of the public page: layout, theme, colours, toggles.
        settings: { type: Object, default: {}, required: false },
        // Shown after submitting.
        successMessage: { type: String, default: '', required: false },
        // 'draft' | 'live' — a draft has no working public link.
        state: { type: String, default: 'draft', required: false },
        submissionCount: { type: Number, default: 0, required: false },
        // Taken when the form is published, exactly as an email inbox does it:
        // the public submission handler has no logged-in user and no company
        // context, so everything it needs to build a task is frozen here rather
        // than looked up per submission.
        CompanyId: { type: String, default: '', required: false },
        projectSnapshot: { type: Object, default: {}, required: false },
        sprintArray: { type: Object, default: {}, required: false },
        userSnapshot: { type: Object, default: {}, required: false },
        templateSnapshot: { type: Object, default: {}, required: false },
        createdBy: { type: String, required: false },
        updatedBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // One row per public form submission, stored whether or not a task was
    // created from it: the form's own response table is the record of what was
    // submitted, and task creation is optional.
    form_submissions: {
        formId: { type: mongoose.Schema.Types.ObjectId, required: true },
        ProjectID: { type: mongoose.Schema.Types.ObjectId, required: true },
        CompanyId: { type: String, default: '', required: false },
        // [{ questionId, label, value }] — the label is copied in as given, so
        // renaming or deleting a question later cannot rewrite past answers.
        answers: { type: Array, default: [], required: false },
        // Empty when the form does not create tasks.
        taskId: { type: String, default: '', required: false },
        taskKey: { type: String, default: '', required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // One billing contract per project — managed by Modules/Milestone (handoff 19a/19b).
    // The milestones themselves stay in `milestone`; this holds the terms the
    // money maths needs and that live nowhere else in the product: who the
    // client is, whether the project is fixed-price or hourly, the tax rate, the
    // monthly ceiling, and the blended cost rate profitability is measured
    // against. Rates are stored in MINOR UNITS and tax in BASIS POINTS so no
    // stored figure is ever a float.
    projectContracts: {
        ProjectID: { type: mongoose.Schema.Types.ObjectId, required: true },
        // 'fixed' | 'hourly'
        billingMode: { type: String, default: 'fixed', required: false },
        clientName: { type: String, default: '', required: false },
        vendorName: { type: String, default: '', required: false },
        // Company users with the client's seat — they are who a sign-off task is
        // assigned to and who the client view answers for.
        clientContactIds: { type: Array, default: [], required: false },
        currency: { type: String, default: 'USD', required: false },
        currencySymbol: { type: String, default: '$', required: false },
        taxLabel: { type: String, default: '', required: false },
        taxRateBp: { type: Number, default: 0, required: false },
        paymentTermsDays: { type: Number, default: 30, required: false },
        // Null until somebody sets it. There is no honest default for a blended
        // cost rate, so profitability stays unavailable rather than wrong.
        blendedCostRateMinor: { type: Number, default: null, required: false },
        monthlyCapMinor: { type: Number, default: null, required: false },
        // Contract-level rule toggles shown on 19a.
        requireTasksDoneToInvoice: { type: Boolean, default: true, required: false },
        signOffIsTask: { type: Boolean, default: true, required: false },
        warnWhenHoursExceedValue: { type: Boolean, default: false, required: false },
        allowClientMessages: { type: Boolean, default: true, required: false },
        invoicePrefix: { type: String, default: 'INV', required: false },
        invoiceSeq: { type: Number, default: 0, required: false },
        createdBy: { type: String, required: false },
        updatedBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Client invoices raised against a project (handoff 19c). Distinct from the
    // global `invoices` collection, which is AlianHub's own subscription billing.
    // Every line keeps the ids it was drafted from so a client question about a
    // number can be answered by opening the tasks or the time logs behind it.
    projectInvoices: {
        ProjectID: { type: mongoose.Schema.Types.ObjectId, required: true },
        number: { type: String, required: true },
        clientName: { type: String, default: '', required: false },
        // 'milestone' | 'month'
        source: { type: String, default: 'milestone', required: false },
        periodStart: { type: Date, required: false },
        periodEnd: { type: Date, required: false },
        issuedDate: { type: Date, required: false },
        dueDate: { type: Date, required: false },
        // [{ id, kind, label, detail, qtyMilli, unitMinor, amountMinor,
        //    milestoneId, taskIds, timelogIds }]
        lines: { type: Array, default: [], required: false },
        currency: { type: String, default: 'USD', required: false },
        currencySymbol: { type: String, default: '$', required: false },
        taxLabel: { type: String, default: '', required: false },
        taxRateBp: { type: Number, default: 0, required: false },
        subtotalMinor: { type: Number, default: 0, required: false },
        taxMinor: { type: Number, default: 0, required: false },
        totalMinor: { type: Number, default: 0, required: false },
        // 'draft' | 'sent' | 'paid'
        status: { type: String, default: 'draft', required: false },
        sentAt: { type: Date, required: false },
        paidAt: { type: Date, required: false },
        notes: { type: String, default: '', required: false },
        createdBy: { type: String, required: false },
        updatedBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false },
    },
    // Submissions arriving through a public intake form
    intakeItems: {
        publicShareId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, required: false },
        email: { type: String, required: false },
        title: { type: String, required: true },
        description: { type: String, required: false },
        status: { type: String, required: true },
        taskId: { type: mongoose.Schema.Types.ObjectId, required: false },
    },
    // GLOBAL-DB lookup: public share token -> tenant (no auth context on
    // public requests, so the token must resolve the company first)
    publicShareIndex: {
        token: { type: String, required: true },
        companyId: { type: String, required: true },
        shareId: { type: mongoose.Schema.Types.ObjectId, required: true },
    },
    // Outgoing webhook registrations (per-company) — managed by
    // Modules/Webhooks/controller.js, delivered by dispatcher.js
    webhooks: {
        name: {
            type: String,
            required: true,
        },
        url: {
            type: String,
            required: true,
        },
        // Subscribed event names, or ['*'] for everything.
        events: {
            type: Array,
            default: [],
            required: true,
        },
        // HMAC secret — generated server-side, returned once on create.
        secret: {
            type: String,
            required: true,
        },
        active: {
            type: Boolean,
            default: true,
            required: false,
        },
        // Outbound payload shape: 'json' (raw, default), 'slack' (Block Kit),
        // or 'discord' (embed) — lets a hook target a Slack/Discord incoming
        // webhook directly without a transform service.
        format: {
            type: String,
            default: "json",
            required: false,
        },
        createdBy: {
            type: String,
            required: false,
        },
        lastStatus: {
            type: Number,
            required: false,
        },
        lastDeliveredAt: {
            type: Date,
            required: false,
        },
    },
    // Delivery log per webhook attempt — written by the dispatcher only.
    webhookLogs: {
        webhookId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        event: {
            type: String,
            required: true,
        },
        statusCode: {
            type: Number,
            required: false,
        },
        success: {
            type: Boolean,
            required: true,
        },
        durationMs: {
            type: Number,
            required: false,
        },
        attempt: {
            type: Number,
            required: false,
        },
        error: {
            type: String,
            required: false,
        },
    },
    users: {
        "legacyId": {
            type: String,
            required: false
        },
        Employee_Email: {
            type: String,
            required: false,
        },
        Employee_FName: {
            type: String,
            required: false,
        },
        Employee_LName: {
            type: String,
            required: false,
        },
        Employee_Name: {
            type: String,
            required: false,
        },
        Time_Format: {
            type: String,
            required: false,
        },
        Time_Zone: {
            type: String,
            required: false,
        },
        isActive: {
            type: Boolean,
            required: false,
        },
        isOnline: {
            type: Boolean,
            required: false,
        },
        verificationToken: {
            type: String,
            required: false
        },
        verificationTokenTime: {
            type: Date,
            required: false
        },
        AssignCompany: {
            type: Array,
            required: false
        },
        Employee_profileImage: {
            type: String,
            required: false
        },
        Employee_profileImageURL: {
            type: String,
            required: false
        },
        webTokens: {
            type: Array,
            required: false
        },
        forgotPasswordToken: {
            type: String,
            required: false
        },
        forgotPasswordTokenTime: {
            type: Date,
            required: false
        },
        lastActive: {
            type: Date,
            required: false
        },
        isEmailVerified: {
            type: Boolean,
            required: true
        },
        customerId: {
            type: String,
            required: false
        },
        customerIds: {
            type: Array,
            required: false
        },
        isProductOwner: {
            type: Boolean,
            required: false
        },
        isVesionUpdate: {
            type: Boolean,
            required: false
        },
        tour: {
            type: Object,
            required: false
        },
        languageCode: {
            type: String,
            required: false,
            default: "en"
        },
        lastSelectedCompany: {
            type: String,
            required: false,
            default: ""
        },
        workingHours: {
            type: Object,
            required: false
        },
        // Personal coding-agent link (27b): { mode, provider, linkedAt, label, email }
        agentAccount: {
            type: Object,
            required: false
        }
    },
    adminDetail: {
        companyName: {
            type: String,
            required: true
        },
        address1: {
            type: String,
            required: true,
        },
        address2: {
            type: String,
            required: false,
        },
        country: {
            type: String,
            required: true,
        },
        state: {
            type: String,
            required: true,
        },
        city: {
            type: String,
            required: true,
        },
        pincode: {
            type: String,
            required: true,
        }
    },
    wasabicredentials: {
        accessKeyId: {
            type: String,
            required: true
        },
        secretAccessKey: {
            type: String,
            required: true
        }
    },
    ProjectTemplate: {
        AssigneeUserId: {
            type: Array,
            required: true
        },
        Description: {
            type: String,
            required: false
        },
        LeadUserId: {
            type: Array,
            required: true
        },
        ProjectCurrency: {
            type: Map,
            required: true
        },
        TaskTypeTemplateId: {
            type: String,
            required: false
        },
        TemplateCategory: {
            type: Map,
            required: false
        },
        TemplateName: {
            type: String,
            required: true
        },
        TemplateRequiredComponent: {
            type: Array,
            required: true
        },
        TemplateTaskActiveKey: {
            type: Array,
            required: false
        },
        TemplateTaskCloseKey: {
            type: Number,
            required: false
        },
        TemplateTaskDoneKey: {
            type: Array,
            required: false
        },
        TemplateTaskStatusId: {
            type: String,
            required: false
        },
        TemplateTaskType: {
            type: Array,
            required: true
        },
        apps: {
            type: Array,
            required: true
        },
        projectStatusData: {
            type: Array,
            required: true
        },
        taskStatusData: {
            type: Array,
            required: true
        }
    },
    timeTrackerDownload: {
        downloadUrl: {
            type: String,
            required: true
        },
        description: {
            type: String,
            required: false
        },
        type: {
            type: String,
            required: true
        },
        title: {
            type: String,
            required: true
        },
        version: {
            type: String,
            required: true
        }
    },
    companies: {
        // { allowedModes: ['workspace','personal','local'], requireCheckBeforeDone }
        agentPolicy: {
            type: Object,
            required: false
        },
        "legacyId": {
            type: String,
            required: false
        },
        Cst_City: {
            type: String,
            required: false
        },
        Cst_Country: {
            type: String,
            required: true
        },
        Cst_CompanyName: {
            type: String,
            required: true
        },
        // What the team mainly does, answered once during setup. Decides which sample content the
        // company starts with, and which templates are worth showing first. Blank for every company
        // created before the question existed, which the code treats as "no preference".
        teamFocus: {
            type: String,
            default: ''
        },
        Cst_DialCode: {
            type: Map,
            required: true
        },
        Cst_LogTimeDays: {
            type: String,
            required: true
        },
        // Whether the desktop tracker is capped by a task's estimated hours (AHE-3831).
        // ON: a task needs an estimate to start, and the tracker auto-stops when the
        // estimate is met. OFF: neither gate applies and the tracker runs freely.
        //
        // Defaults to true so every company that predates this setting keeps the behaviour
        // it has today — an absent field must not silently switch the cap off.
        //
        // MUST stay declared: this schema is strict, so an undeclared path is dropped on
        // save and only shows up as a setting that will not stick after a reload.
        trackerEstimateLimit: {
            type: Boolean,
            required: false,
            default: true
        },
        Cst_Phone: {
            type: String,
            required: true
        },
        Cst_State: {
            type: String,
            required: false
        },
        customerId: {
            type: String,
            required: false
        },
        isInactive: {
            type: Boolean,
            required: false
        },
        SubcriptionId: {
            type: String,
            required: false
        },
        totalData: {
            type: Map,
            required: true
        },
        totalProjects: {
            type: String,
            required: true
        },
        userId: {
            type : mongoose.Schema.Types.ObjectId,
            required : false
        },
        Cst_profileImage: {
            type : String,
            required : false
        },
        planFeature: {
            type: Map,
            required: false
        },
        // Per-company opt-in retention policy for time-tracker screenshots.
        // Map shape:
        //   enabled: Boolean
        //   maxAgeMonths: Number (3 | 6 | 12 | 24)
        //   enabledAt: Date
        //   enabledBy: String (userId)
        //   lastRunAt: Date
        //   lastRunStats: { deletedCount, failedCount, durationMs, cutoffIso }
        //   firstRunCompletedAt: Date (used to lift the first-run safety cap)
        //   runningSince: Date (advisory lock — set when a run starts, cleared on finish)
        screenshotRetention: {
            type: Map,
            required: false
        },
        // Per-company opt-in policy for auto-closing inactive projects (AHE-3798).
        // Applied nightly by Modules/projectClose/helper.js. Map shape:
        //   enabled: Boolean (default false)
        //   inactiveMonths: Number (1 | 2 | 3 | 6) — quiet period before closing
        //   enabledAt: Date, enabledBy: String (userId)
        //   lastRunAt: Date, lastRunStats: { closedCount, durationMs }
        autoCloseProjects: {
            type: Map,
            required: false
        },
        // Per-company opt-in policy for the daily "log your time" reminder email.
        // Map shape:
        //   enabled: Boolean (default false — no reminder until an owner enables it)
        //   userIds: [String] (global users _id; ONLY these members are emailed)
        //   enabledAt: Date
        //   enabledBy: String (userId)
        timeReminderSettings: {
            type: Map,
            required: false
        },
        availableUser: {
            type: Number,
        },
        projectCount: {
            type : Object,
            required : false
        },
        isPlanShchedule: {
            type: Boolean,
        },
        bucketSize: {
            type : Number,
            required : false
        },
        isPaymentFailed: {
            type: Boolean,
            required: false,
        },
        paymentFailed_error_text: {
            type: String,
            required: false,
        },
        trackerUsers: {
            type: Number,
            required: false,
        },
        companyData: {
            type: Array,
            required: false
        },
        subscriptionRenewalDate: {
            type: Number,
        },
        isDisable: {
            type: Boolean,
            required: false
        },
        billingDetails: {
            type: Object,
            required : false
        },
        aiTotalRequestedCount: {
            type: Number,
            required: false
        },
        Cst_stateCode: {
            type: String,
            required: false
        },
        Cst_countryCode: {
            type: String,
            required: false
        }
    },
    companyProjectTemplate: {
        AssigneeUserId: {
            type: Array,
            required: true
        },
        CompanyId: {
            type: String,
            required: false
        },
        CompanyName: {
            type: String,
            required: false
        },
        Description: {
            type: String,
            required: false
        },
        LeadUserId: {
            type: Array,
            required: true
        },
        ProjectCurrency: {
            type: Map,
            required: true
        },
        ProjectRequiredDefaultComponent: {
            type: String,
            required: true
        },
        TaskTypeTemplateId: {
            type: String,
            required: false
        },
        TemplateName: {
            type: String,
            required: true
        },
        TemplateRequiredComponent: {
            type: Array,
            required: true
        },
        TemplateTaskActiveKey: {
            type: Array,
            required: false
        },
        TemplateTaskCloseKey: {
            type: Number,
            required: false
        },
        TemplateTaskDoneKey: {
            type: Array,
            required: false
        },
        TemplateTaskStatusId: {
            type: String,
            required: false
        },
        TemplateTaskType: {
            type: Array,
            required: true
        },
        apps: {
            type: Array,
            required: true
        },
        projectStatusData: {
            type: Array,
            required: true
        },
        taskStatusData: {
            type: Array,
            required: true
        },
        templateImageURL: {
            type: Map,
            required: false
        },
        customFiedlsValue: {
            type: Array,
            required: false
        }
    },
    proejctTabComponents: {
        activeIcon: {
            type: String,
            required: false
        },
        icon: {
            type: String,
            required: false
        },
        keyName: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        setAsDefault: {
            type: Boolean,
            required: true
        },
        sortIndex: {
            type: Number,
            required: true
        },
        value: {
            type: String,
            required: true
        },
        viewStatus: {
            type: Boolean,
            required: true
        }
    },
    projectStatusTemplate: {
        TemplateName: {
            type: String,
            required: true
        },
        projectActiveStatus: {
            type: Array,
            required: true
        },
        projectCompletedStatus: {
            type: Map,
            required: true
        },
        projectDoneStatus: {
            type: Array,
            required: true
        },
        default: {
            type: Boolean,
            required: false
        }
    },
    taskTypeTemplates: {
        TemplateName: {
            type: String,
            required: true
        },
        taskTypes: {
            type: Array,
            required: true
        },
        default: {
            type: Boolean,
            required: false
        },
    },
    taskStatusTemplates: {
        ActiveStatusList: {
            type: Array,
            required: true
        },
        DoneStatusList: {
            type: Array,
            required: true
        },
        TemplateName: {
            type: String,
            required: true
        },
        defaultActive: {
            type: Map,
            required: true
        },
        defaultComplete: {
            type: Map,
            required: true
        },
        default: {
            type: Boolean,
            required: false
        },
        taskActiveStatus: {
            type: Array,
            required: false
        },
        taskcloseStatus: {
            type: Number,
            required: false
        }
    },
    temsManagment: {
        assigneeUsersArray: {
            type: Array,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        teamColor: {
            type: Map,
            required: true
        },
        value: {
            type: String,
            required: true
        }
    },
    companyUsers: {
        "legacyId": {
            type: String,
            required: false
        },
        companyId: {
            type: String,
            required: true
        },
        designation: {
            type: Number,
            required: true
        },
        isDelete: {
            type: Boolean,
            required: true,
            default: false
        },
        linkId: {
            type: String,
            required: false,
            default: ""
        },
        roleType: {
            type: Number,
            required: true
        },
        sendInvitationTime: {
            type: Number,
            required: false
        },
        status: {
            type: Number,
            required: true
        },
        userEmail: {
            type: String,
            required: true
        },
        embedViews: {
            type: Map,
            required: false
        },
        userId: {
            type: String,
            required: false
        },
        // The userId of this member's manager in the same company. Empty means no
        // reporting line is recorded, which is the normal state for most workspaces.
        managerId: {
            type: String,
            required: false,
            default: ""
        },
        isTrackerUser: {
            type: Boolean,
            required: false
        },
        isRestrict: {
            type : Boolean,
            required: false,
            default : false
        },
        dashboardLocked: {
            type : Boolean,
            required: false,
            default : false
        },
        aiRequestedCount: {
            type: Number,
            required: false
        },
        ProjectRequiredComponent: {
            type: Array,
            required: false
        }
    },
    rules: {
        dependency: {
            type: String,
            required: false,
            default: ""
        },
        desc: {
            type: String,
            required: false,
            default: ""
        },
        isParent: {
            type: Boolean,
            required: true,
            default: false
        },
        key: {
            type: String,
            required: true,
            default: ""
        },
        name: {
            type: String,
            required: true,
            default: ""
        },
        parentId: {
            type: String,
            required: false,
            default: ""
        },
        priorityIndex: {
            type: Number,
            required: false,
        },
        roles: {
            type: Array,
            required: true,
            default: []
        },
        allowAdminForPrivateSpace : {
            type:Boolean,
            required : false
        },
        showAllTasks : {
            type:Boolean,
            required : false
        },
        showAllProjects : {
            type:Boolean,
            required : false
        },
        selectionField : {
            type: Boolean,
            required : false
        }

    },
    estimatedTime: {
        Date: {
            type: Date,
            required: true
        },
        ProjectId: {
            type: String,
            required: true
        },
        TaskId: {
            type: String,
            required: true
        },
        UserId: {
            type: String,
            required: true
        },
        EstimatedTime: {
            type: Number,
            required: true
        },
        userId: {
            type: String,
            required: true
        }
    },
    currency_list: {
        code: {
            type: String,
            required: true
        },
        count: {
            type: Number,
            required: true
        },
        decimal_digits: {
            type: Number,
            required: true
        },
        isDefault: {
            type: Boolean,
            required: true
        },
        isDelete: {
            type: Boolean,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        name_plural: {
            type: String,
            required: true
        },
        rounding: {
            type: Number,
            required: true
        },
        symbol: {
            type: String,
            required: true
        },
        symbol_native: {
            type: String,
            required: true
        }
    },
    projects: {
        "legacyId": {
            type: String,
            required: false
        },
        // Auto-archive rule: { enabled: Boolean, afterDays: Number } —
        // applied nightly by Modules/projectSetting/autoArchive.js
        "autoArchive": {
            type: Object,
            required: false
        },
        AssigneeUserId: {
            type: Array,
            default: [],
            required: false
        },
        BillingPeriod: {
            type: String,
            required: false
        },
        CompanyId: {
            type: String,
            required: true
        },
        DueDate: {
            type: Date,
            required: false
        },
        EndDate: {
            type: Date,
            required: false
        },
        LeadUserId: {
            type: Array,
            default: [],
            required: true
        },
        ProjectCode: {
            type: String,
            required: true
        },
        ProjectCurrency: {
            type: Object,
            required: true
        },
        ProjectName: {
            type: String,
            required: true
        },
        ProjectRequiredComponent: {
            type: Array,
            required: true,
            default: []
        },
        ProjectRequiredDefaultComponent: {
            type: String,
            required: true
        },
        // Personal List (Modules/PersonalList). Without these the flag was stripped on
        // save, the list was never found again and a fresh "Personal" project was
        // created on every visit — and shown in the team's project list.
        isPersonal: {
            type: Boolean,
            default: false
        },
        personalOwner: {
            type: String,
            default: ""
        },
        ProjectType: {
            type: String,
            required: true
        },
        StartDate: {
            type: Date,
            required: false
        },
        TaskTypeTemplateId: {
            type: String,
            required: false,
            default: ""
        },
        TemplateId: {
            type: String,
            required: false,
            default: ""
        },
        TemplateTaskStatusId: {
            type: String,
            required: false,
            default: ""
        },
        apps: {
            type: Array,
            required: true,
            default: []
        },
        checklistArray: {
            type: Array,
            required: false,
            default: []
        },
        attachments: {
            type: Array,
            required: false,
            default: []
        },
        description: {
            type: String,
            required: false,
            default: ""
        },
        dueDateDeadLine: {
            type: Array,
            required: false,
            default: []
        },
        isPrivateSpace: {
            type: Boolean,
            required: true,
            default: false
        },
        lastTaskId: {
            type: Number,
            required: false,
            default: 0
        },
        projectCreatedBy: {
            type: String,
            required: true,
        },
        projectIcon: {
            type: Object,
            required: true
        },
        projectStatusData: {
            type: Array,
            required: true,
            default: []
        },
        projectStatusTemplateId: {
            type: String,
            required: false,
        },
        sprintsObj: {
            type: Object,
            required: false,
            default: {}
        },
        sprintsfolders: {
            type: Object,
            required: false,
            default: {}
        },
        status: {
            type: String,
            required: true,
        },
        statusType: {
            type: String,
            required: true,
        },
        // Per-project sprint cadence. Shaped like the existing autoArchive and
        // autoCloseProjects rules so the nightly cron that reads it follows a
        // pattern already in the codebase.
        // { enabled, lengthDays, startWeekday, autoClose, autoCreateNext, rolloverTarget }
        sprintCadence: {
            type: Object,
            default: {},
            required: false
        },
        taskStatusData: {
            type: Array,
            required: true,
            default: []
        },
        taskTypeCounts: {
            type: Array,
            required: true,
            default: []
        },
        milestoneAmount: {
            type: Number,
            required: false,
            default: 0
        },
        deletedStatusKey: {
            type: Number,
            required: false,
            default: 0
        },
        isGlobalPermission : {
            type: Boolean,
            required: true,
            default : true
        },
        lastProjectActivity: {
            type: Number,
            required: false
        },
        userActivity: {
            type: Object,
            required: false,
            default: {}
        },
        isRestrict: {
            type: Boolean,
            required: false,
            default: false
        },
        viewColumn: {
            type: Array,
            required: false,
        },
        estimationScale: {
            type: String,
            required: false,
            default: 'fibonacci'
        },
        favouriteTasks:{
            type: Array,
            required: false,
        },
        watchers:{
            type: Object,
            required:false
        },
        descriptionBlock: {
            type: Object,
            required: false
        },
        customField: {
            type: Object,
            required: false
        },
        tagsArray:{
            type: Array,
            required: false
        },
        // Id of the won proposal this project came from (bidding tool
        // `proposals.proposalId`). Free text — not validated against that DB.
        proposalId: {
            type: String,
            required: false,
            default: ''
        },
        // Digits-only form of `proposalId` when one can be derived. The bidding
        // DB stores 19-digit ids, so this is what the warehouse joins on.
        proposalIdNumeric: {
            type: String,
            required: false,
            default: ''
        },
        // Where the work came from: 'upwork' | 'fiverr' | 'other'. Required on
        // create; absent on projects that predate the field, which read 'other'.
        source: {
            type: String,
            required: false,
            default: 'other'
        },
        // Slugs from the company's `project_skills` settings list, so renames
        // are display-only and the value joins to a bid's skills downstream.
        skills: {
            type: Array,
            required: false,
            default: []
        }
    },
    mainChats: {
        "legacyId": {
            type: String,
            required: false
        },
        default: {
            type: Boolean,
            required: true
        },
        AssigneeUserId: {
            type: Array,
            default: [],
            required: false
        },
        DueDate: {
            type: Number,
            required: false
        },
        EndDate: {
            type: Number,
            required: false
        },
        LeadUserId: {
            type: Array,
            default: [],
            required: true
        },
        ProjectCode: {
            type: String,
            required: true
        },
        ProjectName: {
            type: String,
            required: true
        },
        ProjectRequiredComponent: {
            type: Array,
            required: true,
            default: []
        },
        StartDate: {
            type: Number,
            required: false
        },
        TaskTypeTemplateId: {
            type: String,
            required: false,
            default: ""
        },
        TemplateId: {
            type: String,
            required: false,
            default: ""
        },
        TemplateTaskStatusId: {
            type: String,
            required: false,
            default: ""
        },
        apps: {
            type: Array,
            required: true,
            default: []
        },
        checklistArray: {
            type: Array,
            required: false,
            default: []
        },
        description: {
            type: String,
            required: false,
            default: ""
        },
        dueDateDeadLine: {
            type: Array,
            required: false,
            default: []
        },
        isPrivateSpace: {
            type: Boolean,
            required: true,
            default: false
        },
        lastTaskId: {
            type: Number,
            required: false,
            default: 0
        },
        milestoneAmount: {
            type: Number,
            required: false,
            default: 0
        },
        projectIcon: {
            type: Object,
            required: false
        },
        projectStatusData: {
            type: Array,
            required: true,
            default: []
        },
        projectStatusTemplateId: {
            type: String,
            required: false,
        },
        sprintsObj: {
            type: Object,
            required: false,
            default: {}
        },
        sprintsfolders: {
            type: Object,
            required: false,
            default: {}
        },
        status: {
            type: String,
            required: false,
        },
        statusType: {
            type: String,
            required: false,
        },
        taskStatusData: {
            type: Array,
            required: true,
            default: []
        },
        taskTypeCounts: {
            type: Array,
            required: true,
            default: []
        }
    },
    settings: {
        settings: {
            type: Array,
            required: true,
            default: []
        },
        name: {
            type: String,
            required: true
        },
        totalStatus: {
            type: Number,
            required: false
        }
    },
    milestone: {
        milestoneName:{
            type: String,
            required: true,
        },
        amount:{
            type: Number,
            required: true,
        },
        projectId:{
            type: String,
            required: true,
        },
        startDate:{
            type: Number,
            required: false,
        },
        endDate:{
            type: Number,
            required: false,
        },
        dueDate:{
            type: Number,
            required: false,
        },
        statusDate:{
            type: Number,
            required: false,
        },
        statusId:{
            type: String,
            required: false,
        },
        refundedAmount:{
            type: Array,
            required: false,
        },
        statusArray:{
            type: Array,
            required: false,
        },
        order:{
            type: String,
            required: false,
        },
        maxRefundDate:{
            type: Number,
            required: false,
        },
        minRefundDate:{
            type: Number,
            required: false,
        },
        minute:{
            type:Number,
            required:false
        },
        hours:{
            type:Number,
            required:false
        },
        amountPerHours:{
            type:Number,
            required:false
        },
        billingPeriod:{
            type:String,
            required:false
        },
        // Which tasks this milestone covers. Empty means "derive from the
        // milestone's own date window" — see resolveMilestoneScope.
        taskIds:{
            type: Array,
            default: [],
            required: false
        },
        // Company user who signs the milestone off (the client contact).
        signOffUserId:{
            type: String,
            required: false
        },
        signOffAt:{
            type: Date,
            required: false
        }
    },
    apps: {
        afterIcon: {
            type: String,
            required: true,
        },
        appStatus: {
            type: Boolean,
            required: true,
        },
        beforeIcon: {
            type: String,
            required: true,
        },
        key: {
            type: String,
            required: true,
        },
        name: {
            type: String,
            required: true,
        },
        sortIndex: {
            type: Number,
            required: true,
        }
    },
    notifications: {
        key: {
            type: String,
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        projectId: {
            type: String,
            required: true,
        },
        taskId: {
            type: String,
            required: false,
        },
        type: {
            type: String,
            required: true,
        },
        userId: {
            type: String,
            required: true,
        },
        assigneeUsers: {
            type: Array,
            required: true,
        },
        folderId: {
            type: String,
            required: false,
        },
        isSelected: {
            type: Boolean,
            required: false,
        },
        notSeen: {
            type: Array,
            required: true,
            default: []
        },
        sprintId: {
            type: String,
            required: false,
        },
        companyId: {
            type: String,
            required: false,
        },
        task_leader_ID: {
            type: String,
            required: false,
        },
        changeType: {
            type: String,
            required: false,
        },
        changeData: {
            type: Object,
            required: false,
        },
        receiverID: {
            type: String,
            required: false,
        },
        notificationType: {
            type: String,
            required: true,
            default: "push"
        },
        uniqueId:{
            type: String,
            required: true,
        },
        isSchedule:{
            type: Boolean,
            required:false
        },
        Employee_Email: {
            type: String,
            required: false,
        },
        Employee_Name: {
            type: String,
            required: false,
        },
        Employee_profileImage: {
            type: String,
            required: false,
        },
        User_Employee_Email: {
            type: String,
            required: false,
        },
        User_Employee_Name: {
            type: String,
            required: false,
        },
        User_Employee_profileImage: {
            type: String,
            required: false,
        },
        notificationStatus: {
            type: String,
            required: false,
        },
        isSeen:{
            type: Boolean,
            required:false
        },
        webTokens:{
            type: Array,
            required: false,
        },
        notificationId:{
            type: String,
            required:false
        },
        comments_id:{
            type: String,
            required:false
        },
        User_Employee_Verify: {
            type: Boolean,
            required:false
        }
    },
    notificationsSettings: {
        before: {
            type: Object,
            required: true
        },
        project: {
            type: Object,
            required: true
        },
        tasks: {
            type: Object,
            required: true
        },
        chat: {
            type: Object,
            required: true
        },
        userId: {
            type: String,
            required: true,
        },
        quietHours: {
            type: Object,
            required: false
        },
        agentActivity: {
            type: Boolean,
            required: false,
            default: true
        },
        dailyDigest: {
            type: Boolean,
            required: false,
            default: false
        }
    },
    mentions: {
        comment_id: {
            type: String,
            required: true
        },
        comment_mediaOriginalName: {
            type: String,
            required: false
        },
        comment_mediaName: {
            type: String,
            required: false
        },
        comment_mediaSize: {
            type: Number,
            required: false
        },
        comment_mediaURL: {
            type: String,
            required: false
        },
        comment_message: {
            type: String,
            required: false
        },
        comment_reply_id: {
            type: String,
            required: false
        },
        comment_reply_mediaOriginalName: {
            type: String,
            required: false
        },
        comment_reply_mediaName: {
            type: String,
            required: false
        },
        comment_reply_mediaSize: {
            type: Number,
            required: false
        },
        comment_reply_mediaURL: {
            type: String,
            required: false
        },
        comment_reply_message: {
            type: String,
            required: false
        },
        comment_reply_type: {
            type: String,
            required: false
        },
        comment_reply_userId: {
            type: String,
            required: false
        },
        comment_type: {
            type: String,
            required: true
        },
        folderId: {
            type: String,
            required: false
        },
        mentionIds: {
            type: Array,
            required: true
        },
        notSeen: {
            type: Array,
            required: false
        },
        projectId: {
            type: String,
            required: true
        },
        sprintId: {
            type: String,
            required: false
        },
        taskId: {
            type: String,
            required: false
        },
        type: {
            type: String,
            required: true
        },
        userId: {
            type: String,
            required: true
        },
        mainChat:{
            type: Boolean,
            required: false,
            default: false
        },
    },
    comments: {
        "legacyId": {
            type: String,
            required: false
        },
        "hasReply": {
            type: Boolean,
            required: false
        },
        "isDeleted": {
            type: Boolean,
            required: false
        },
        "mediaName": {
            type: String,
            required: false
        },
        "message": {
            type: String,
            required: false
        },
        "mediaSize": {
            type: Number,
            required: false
        },
        "mediaURL": {
            type: String,
            required: false
        },
        "sprintId": {
            type: mongoose.Schema.Types.ObjectId,
            required: false
        },
        "project": {
            type: Boolean,
            required: true
        },
        "projectId": {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        "reply_userId": {
            type: String,
            required: false
        },
        "reply_type": {
            type: String,
            required: false
        },
        "reply_message": {
            type: String,
            required: false
        },
        "reply_mediaURL": {
            type: String,
            required: false
        },
        "taskId": {
            type: mongoose.Schema.Types.Mixed,
            required: false
        },
        "reply_mediaSize": {
            type: Number,
            required: false
        },
        "reply_mediaName": {
            type: String,
            required: false
        },
        "reply_mediaOriginalName": {
            type: String,
            required: false
        },
        "reply_id": {
            type: String,
            required: false
        },
        "userId": {
            type: String,
            required: true
        },
        "type": {
            type: String,
            required: true
        },
        "reply_createdAt": {
            type: Date,
            required: false
        },
        "mentionIds": {
            type: Array,
            required: false
        },
        "pinnedMessage": {
            type: Boolean,
            default: false,
            required: false
        },
        // Emoji reactions: [{ emoji, userId, createdAt }], one entry per
        // user+emoji — written only by Modules/Reactions/controller.js
        "reactions": {
            type: Array,
            default: [],
            required: false
        },
        "mediaOriginalName": {
            type: String,
            required: false
        },
        folderId:{
            type: mongoose.Schema.Types.ObjectId,
            required: false,
        },
        transcript: { type: String, required: false },
        isAgent: { type: Boolean, required: false },
        agentName: { type: String, required: false },
        // 27c attribution. Without these the fields were stripped on save and every
        // agent comment read as posted by the person who approved it.
        actorType: { type: String, default: "" },
        agentId: { type: String, default: "" },
        viaAccount: { type: String, default: "" },
        runId: { type: String, default: "" }
    },
    mainChat: {
        ProjectCode: {
            type: String,
            required: true
        }, 
        ProjectName: {
            type: String,
            required: true
        }, 
        default: {
            type: Boolean,
            required: true
        },
        sprintsfolders: {
            type: Object,
            required: true,
            default: {}
        },
        taskStatusData: {
            type: Array,
            required: true
        },
        taskTypeCounts: {
            type: Array,
            required: true
        },
        name : {
            type : String,
            required : true
        }
    },
    subscriptionPlan: {
        addonPriceArray: {
            type: Array,
            required: false
        },
        planName: {
            type: String,
            required: true
        },
        itemPriceArray: {
            type: Array,
            required: false
        },
        planDetails: {
            type: Object,
            required: false
        },
        isDefaultShow: {
            type: Boolean,
            required: false
        },
        defaultSubscribe: {
            type: Boolean,
            required: false,
        },
        status: {
            type: Number,
            required: false,
        }
    },
    planFeature:{
        planName: {
            type: String,
            required: true
        }
    },
    projectRules: {
        dependency: {
            type: String,
            required: false,
            default: ""
        },
        desc: {
            type: String,
            required: false,
            default: ""
        },
        isParent: {
            type: Boolean,
            required: true,
            default: false
        },
        key: {
            type: String,
            required: true,
            default: ""
        },
        name: {
            type: String,
            required: true,
            default: ""
        },
        parentId: {
            type: String,
            required: false,
            default: ""
        },
        priorityIndex: {
            type: Number,
            required: false,
        },
        roles: {
            type: Array,
            required: true,
            default: []
        },
        allowAdminForPrivateSpace : {
            type:Boolean,
            required : false
        },
        showAllTasks : {
            type:Boolean,
            required : false
        },
        showAllProjects : {
            type:Boolean,
            required : false
        },
        projectId : {
            type : String,
            required : true,
            default : ''
        }
    },
    planFeatureDisplay:{
        planName: {
            type: String,
            required: true
        }
    },
    subscriptions: {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        }
    },
    invoices: {},
    creditNotes: {},
    globalCustomFields: {
        cfPrimaryColor: {
            type: String,
            required: true
        },
        cfType: {
            type: String,
            required: true
        },
        cfDescrption: {
            type: String,
            required: true
        },
        cfIcon: {
            type: String,
            required: true
        },
        cfTitle: {
            type: String,
            required: true
        },
        cfIconGrey: {
            type: String,
            required: true
        },
        cfBackgroundColor: {
            type: String,
            required: true
        }
    },
    customFields:{
        fieldTitle : {
            type: String, 
            required:false,
            default:''
        },
        fieldPlaceholder: {
            type: String, 
            required:false,
            default:''
        },
        fieldDescription: {
            type: String, 
            required:false,
            default:''
        },
        fieldRequired: {
            type: Array, 
            required:false,
            default:[]
        },
        fieldMinimum: {
            type: String, 
            required:false,
            default:''
        },
        fieldMaximum: {
            type: String, 
            required:false,
            default:''
        },
        fieldHide: {
            type: Array, 
            required:false,
            default:[]
        },
        fieldValidation: {
            type: String, 
            required:false,
            default:''
        },
        fieldType: {
            type: String, 
            required:true,
            default:''
        },
        global: {
            type: Boolean,
            required: false,
            default: false
        },
        type: {
            type:String,
            required: true,
            default:''
        },
        fieldEntryLimits: {
            type:Array,
            required: false,
            default:''
        },
        fieldImage: {
            type:String,
            required: false,
            default:''
        },
        fieldImageGrey:{
            type:String,
            required: false,
            default:''
        },
        fieldPrimaryColor:{
            type:String,
            required: false,
            default:''
        },
        fieldBackgroundColor:{
            type:String,
            required: false,
            default:''
        },
        isDelete:{
            type:Boolean,
            required: false,
            default:''
        },
        fieldCountryObject:{
            type:Object,
            required: false,
            default:''
        },
        fieldCountryCode:{
            type:String,
            required: false,
            default:''
        },
        fieldCountrySelect:{
            type:Array,
            required: false,
            default:''
        },
        fieldMoneyCode:{
            type:String,
            required: false,
            default:''
        },
        fieldMoneyName:{
            type:String,
            required: false,
            default:''
        },
        fieldMoneySymbol:{
            type:String,
            required: false,
            default:''
        },
        userId:{
            type:String,
            required: false,
            default:''
        },
        projectId:{
            type:mongoose.Schema.Types.Mixed,
            required: false,
            default:''
        },
        formulaExpression:{
            type:String,
            required: false,
            default:''
        },
        rollupSourceFieldId:{
            type:String,
            required: false,
            default:''
        },
        rollupFunction:{
            type:String,
            required: false,
            default:''
        }
    },
    sprints: {
        sendMessage: {
            type: Boolean,
            required: false,
        },
        type: {
            type: String,
            required: false,
        },
        iconName: {
            type: String,
            required: false,
        },
        prefix: {
            type: String,
            required: false,
        },
        name:{
            type: String,
            required: true,
        },
        projectId:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        tasks:{
            type: Number,
            required: false,
        },
        private:{
            type: Boolean,
            required:true
        },
        deletedStatusKey:{
            type: Number,
            required: true
        },
        archiveTaskCount:{
            type: Number,
            required: false,
        },
        folderId:{
            type: mongoose.Schema.Types.ObjectId,
            required: false,
        },
        AssigneeUserId:{
            type: Array,
            required:false
        },
        watchers:{
            type: Array,
            required:false
        },
        favouriteTasks:{
            type: Array,
            required:false
        },
        legacyId : {
            type: String,
            required:false
        },
        url : {
            type: String,
            required: false
        },
        // ── Scrum ────────────────────────────────────────────────────
        // A sprint doc is a plain container until someone opts it in. Chat
        // channels (mainChat) and Forms response lists live in this same
        // collection and never get these set, so they are unaffected.
        //
        // Declared, not inferred: the schema is strict, so an undeclared path is
        // dropped on write — it appears to work until the next reload. That is
        // exactly why burndown.js has been reading a startDate that never existed.
        isScrum: {
            type: Boolean,
            default: false,
            required: false
        },
        // The one designated container per project for un-sprinted work.
        // tasks.sprintId is required, so a backlog cannot be "no sprint".
        isBacklog: {
            type: Boolean,
            default: false,
            required: false
        },
        goal: {
            type: String,
            default: '',
            required: false
        },
        startDate: {
            type: Date,
            required: false
        },
        endDate: {
            type: Date,
            required: false
        },
        // planned | active | closed
        state: {
            type: String,
            default: '',
            required: false
        },
        // Snapshot taken once, when the sprint starts: { points, tasks, minutes, at }.
        // Without it "committed vs completed" is a tautology and scope added
        // mid-sprint is invisible.
        commitment: {
            type: Object,
            default: {},
            required: false
        },
        // What the close actually did: { at, by, done, notDone, movedTo, counts }.
        closeReport: {
            type: Object,
            default: {},
            required: false
        },
        // Set on a sprint created by rolling over from another one.
        rolledFrom: {
            type: mongoose.Schema.Types.ObjectId,
            required: false
        },
        purpose: { type: String, required: false },
        linkedProjectId: { type: String, required: false },
        visibility: { type: String, required: false },
        slackMirror: { type: Object, default: {}, required: false }
    },
    calls: {
        callId: { type: String, required: true },
        chatId: { type: String, required: false },
        projectId: { type: String, required: false },
        sprintId: { type: String, required: false },
        media: { type: String, required: false },
        title: { type: String, required: false },
        participants: { type: Array, default: [], required: false },
        startedAt: { type: Date, required: false },
        endedAt: { type: Date, required: false },
        durationSec: { type: Number, default: 0, required: false },
        notetaker: { type: Boolean, default: false, required: false },
        transcript: { type: String, default: '', required: false },
        summary: { type: String, default: '', required: false },
        actionItems: { type: Array, default: [], required: false },
        status: { type: String, default: 'ready', required: false },
        recapPostedAt: { type: Date, required: false },
        createdBy: { type: String, required: false },
        deletedStatusKey: { type: Number, default: 0, required: false }
    },
    folders:{
        name:{
            type: String,
            required: true,
        },
        projectId:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        deletedStatusKey:{
            type: Number,
            required: true
        },
        legacyId : {
            type: String,
            required:false
        }
    },
    preCompanies: {
        isAvailable: {
            type:Boolean,
            required: true
        },
        pickupCount: {
            type: Number,
            required: true
        }
    },
    restrictedExtensions: {
        extensions: {
            type: Array,
            required: true,
            default: []
        }
    },
    tours: {
        title: {
            type: String,
            required: true
        },
        description: {
            type: String,
            required: true
        },
        image: {
            type: String,
            required: true
        },
        isCompleted: {
            type: Boolean,
            required: true
        },
        id: {
            type: String,
            required: true
        }
    },
    bucket: {
        id: {
            type: String,
            required: true,
            unique: true,
            immutable: true
        },
        rule: {
            type: Object,
            required: true
        }
    },
    globalFilter: {
        name: {
            type: String,
            required: true,
        },
        filters: {
            type: Array,
            required: true,
        },
        userId: {
            type: String,
            required: true,
        },
        companyId: {
            type: String,
            required: true,
        },
        typeFilter: {
            type: String,
            required: true,
        },
        filter: {
            type: String,
            required: true,
        },
        sortByField: {
            type: Object,
            required: false,
        },
        sortByOrder: {
            type: Object,
            required: false,
        }
    },
    userAuth: {
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },
        passwordHash: {
            type: String,
            required: false
        },
        isBlocked: {
            type: Boolean,
            default: false
        },
        token: {
            type: String,
            required: false
        },
        googleId: {
            type: String,
            required: false
        },
        githubId: {
            type: String,
            required: false
        },
        gitlabId: {
            type: String,
            required: false
        },
        // Two-factor auth (TOTP). Opt-in, password-login only (Phase 1).
        // Stored as a free-form object: { enabled, secretEnc, pendingSecretEnc,
        // recoveryCodes:[bcryptHash], enrolledAt }. The secret is AES-encrypted
        // and recovery codes are bcrypt-hashed — nothing here is ever returned
        // to the client. Object (Mixed) so these blobs are persisted as-is.
        twoFactor: {
            type: Object,
            required: false,
        },
    },
    resetAttempt: {
        ip: {
            type: String,
            required: true
        },
        attempts: {
            type: Number,
            default: 0 
        },
        firstAttemptTime: {
            type: Date,
            default: null
        },
        blockedUntil: {
            type: Date,
            default: null
        },
        isSendMail: {
            type: Boolean,
            default: false
        }
    },
    sessions: {
        expireAt: {
            type: Date,
            required: false
        },
        userId: {
            type: String,
            required: true
        },
        ip: {
            type: String,
            required: true
        },
        webToken: {
            type: String,
            required: false
        },
        info: {
            type: Object,
            required: false
        },
        refreshToken: {
            type: String,
            required: false
        },
        lastActive: {
            type: Date,
            default: new Date()
        }
    },
    refferalcodes: {
        code: {
            type: String,
            unique: true,
            required: true
        },
        companyId: {
            type: String,
            required: true
        },
        ownerId: {
            type: String,
            required: true
        }
    },
    refferalmapping: {
        joinedCompanyId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        inviterCompanyId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        transectionPercentage: {
            type: Number,
            required: true
        },
        validityTime:{
            type: Date,
            required: true
        }
    },
    // One row per migration id, plus the "__lock" row the runner holds while it works.
    schemaVersions: {
        _id: { type: String, required: true },
        appliedAt: { type: Date, required: false },
        durationMs: { type: Number, required: false },
        appVersion: { type: String, required: false },
        ok: { type: Boolean, required: false },
        error: { type: String, required: false },
        companies: { type: Object, required: false },
        owner: { type: String, required: false },
        expiresAt: { type: Date, required: false },
    },
    // A single document (_id "instance") holding what Settings > Instance saves; secrets encrypted.
    instanceSettings: {
        _id: { type: String, required: true },
        values: { type: Object, required: false },
        updatedAt: { type: Date, required: false },
        updatedBy: { type: String, required: false },
    },
    globalSettings: {
        name: {
            type: String,
            required: true
        },
        value: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        }
    },
    userDashboard:{
        userId: {
            type: String,
            required: true
        },
        templateId: {
            type: String,
            required: false
        },
        cards: {
            type: Array,
            required: true
        },
        createdAt: {
            type: Date,
            required: true
        },
        updatedAt: {
            type: Date,
            required: true
        },
        title:  {
            type: String,
            required: true
        },
        isDeleted: {
            type: Boolean,
            required: true
        },
        ownerId: {
            type: String,
            required: false
        },
        visibility: {
            type: String,
            required: false
        },
        projectId: {
            type: String,
            required: false
        },
        sharedWith: {
            type: Array,
            required: false
        },
        description: {
            type: String,
            required: false
        },
        updatedBy: {
            type: String,
            required: false
        }
    }
}

module.exports = { schema };