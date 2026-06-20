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
        totalEstimatedTime:{
            type: Number,
            required: false
        },
        remainingHours:{
            type: Number,
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
    // Personal sticky notes — per-user quick-capture scratchpad,
    // company-DB-scoped and private to the owning user. Managed by
    // Modules/Stickies. Content is plain text (rendered as text, never HTML).
    stickies: {
        userId: {
            type: String,
            required: true,
        },
        title: {
            type: String,
            required: false,
            default: "",
        },
        content: {
            type: String,
            required: false,
            default: "",
        },
        color: {
            type: String,
            required: false,
            default: "yellow",
        },
        sortIndex: {
            type: Number,
            required: false,
            default: 0,
        },
        isPinned: {
            type: Boolean,
            required: false,
            default: false,
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
        Cst_DialCode: {
            type: Map,
            required: true
        },
        Cst_LogTimeDays: {
            type: String,
            required: true
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
        guestProjectIds: {
            type: Array,
            default: [],
            required: false
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
        milestoneAmount: {
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
        }
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
        }
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
        status: {
            type: Number,
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
        projectId: {
            type:Array,
            required: false,
            default:''
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
        }
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
        }
    }
}

module.exports = { schema };