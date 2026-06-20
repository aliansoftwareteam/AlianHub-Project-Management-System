const jwt = require('./jwt');
const verifyJWTTokenWithCRoute = [
    "/api/v1/verifyToken",
    "/api/v1/createproject",
    "/api/v1/importSettings",
    // "/api/v1/manualLogtime",
    // "/api/v1/deleteManualLogtime",
    // "/api/v1/timetracker/end",
    // "/api/v1/timetracker/capture",
    // "/api/v1/timeTracker/start",
    "/api/v2/manualLogtime",
    "/api/v2/deleteManualLogtime",
    "/api/v2/timeTracker/start",
    "/api/v2/timetracker/end",
    "/api/v2/timetracker/capture",
    "/api/v2/timetracker/timelog",
    // Screenshot Retention (owner-only inside the controller; auth-required
    // at the middleware layer to populate req.uid / req.aud).
    "/api/v1/screenshot-retention",
    "/api/v1/screenshot-retention/preview",
    "/api/v1/addmilestone",
    "/api/v1/updatemilestone",
    "/api/v1/deletemilestone",
    "/api/v1/clearmilestonestatus",
    "/api/v1/cancelmilestonestatus",
    "/api/v1/refundamount",
    "/api/v1/draggablemilestone",
    "/api/v1/updateunreadcommentscount",
    "/api/v1/sendNotification",
    "/api/v1/handleHistory",
    "/api/v1/handleNotification",
    "/api/v1/send-fcm",
    "/api/v1/prepare-notification-data",
    "/api/v1/get-tasks",
    "/api/v1/projectSetting/taskType",
    "/api/v1/projectSetting/taskStatus",
    // "/api/v1/removeSprintOperations",
    "/api/v1/sprint",
    "/api/v1/sprint/:id",
    "/api/v1/folder",
    "/api/v1/folder/:id",
    "/api/v1/taskIndex",
    "/api/v1/updateTaskIndexOnload",
    "/api/tasks",
    "/api/v2/tasks",
    "/api/v1/importTasks",
    "/api/v1/wasabi/retriveObject",
    "/api/v1/wasabi/deleteFile",
    "/api/v1/removeUserNotification",
    "/api/v1/importSettingsProjectFunction",
    "/api/v2/getCardDetails",
    "/api/v2/createCustomerChargbee",
    '/api/v2/createPaymnetSourceChargebee',
    '/api/v2/createSubscriptionChargebee',
    '/api/v1/getInvoiceAndCreditNotes',
    '/api/v1/updateCardForSubscription',
    '/api/v1/getpaymentCustomer',
    '/api/v1/updateSubscriptionPayment',
    '/api/v2/updateSubscriptionChargebeeEstimate',
    '/api/v1/addAndRemoveUserInChargebeeSubscription',
    '/api/v1/addAndRemoveUserInPaymentSubscriptionEstimate',
    'api/v1/checkSendInviatation',
    '/api/v1/checkSubscriptionSchedule',
    '/api/v1/removeSubscriptionScheduledChanges',
    '/api/v1/getSubscription',
    '/api/v1/payPendingInvoice',
    '/api/v1/project/:id',
    '/api/v1/project',
    '/api/v1/project/allTask/:id',
    '/api/v1/project/sprintFolder',
    '/api/v1/project/sprint/:id',
    '/api/v1/company',
    '/api/v2/updateCustomerBilling',
    '/api/v1/project/search',
    '/api/v1/tabSyncTask',
    '/api/v1/teams',
    '/api/v1/teams/updateTeam',
    '/api/v1/teams/addTeam',
    '/api/v1/task/filter/create',
    '/api/v1/task/filter/:userId',
    '/api/v1/task/filter/update',
    '/api/v1/task/filter/delete/:cid/:id',
    '/api/v1/advance/filter/create',
    '/api/v1/advance/filter/:userId/:filterType',
    '/api/v1/advance/filter/update',
    '/api/v1/advance/filter/delete/:cid/:id',
    '/api/v1/advance/filter/search/tasks',
    '/api/v1/advance/filter/search/comments',
    '/api/v1/advance/filter/search/projects',
    '/api/v1/advance/filter/search/files',
    '/api/v1/advance/filter/search/links',
    '/api/v1/currency/:cid/:id',
    '/api/v1/currency',
    '/api/v1/projectRules/:pid',
    '/api/v1/projectRules/update',
    '/api/v1/projectRules/delete/:pid',
    '/api/v1/estimatedTime/:pid/:tid',
    '/api/v1/estimatedTime',
    '/api/v1/project/checklist',
    'api/v1/notifications',
    'api/v1/notifications/:id',
    '/api/v1/milestone',
    '/api/v1/milestone/project/:pid',
    '/api/v1/milestone/:id',
    '/api/v1/milestoneReport',
    '/api/v1/customField',
    '/api/v1/project/template/custom',
    '/api/v1/templates/taskType',
    '/api/v1/templates/taskStatus',
    '/api/v1/tours',
    '/api/v1/restricted-extensions',
    '/api/v1/collection/userid',
    '/api/v1/setting/projectStatus',
    '/api/v1/setting/taskStatus',
    '/api/v1/setting/taskType',
    '/api/v1/project-status-template',
    '/api/v1/securityPermissions',
    '/api/v1/members',
    '/api/v1/importUser',
    '/api/v1/projects-apps',
    '/api/v1/projectTabs',
    '/api/v1/comments',
    '/api/v1/main-chats',
    '/api/v1/app-notification',
    '/api/v1/activity-log',
    '/api/v1/setting/category',
    '/api/v1/setting/roles',
    '/api/v1/setting/designation',
    '/api/v1/setting/companyUserStatus',
    '/api/v1/fileExtensions',
    '/api/v1/commonDateFormate',
    '/api/v1/taskPriority',
    '/api/v1/milestoneBillingPeriod',
    '/api/v1/milestoneStatus',
    '/api/v1/mediaFiles',
    '/api/v1/groupByUsers',
    '/api/v1/task/:id',
    '/api/v1/get-remaining-projects',
    '/api/v1/project/tags',
    '/api/v1/projectdata/taskData',
    '/api/v1/task/find',
    '/api/v1/main-chats/find',
    '/api/v1/plan-feature-display',
    "/api/v1/generateMongoId",
    '/api/v4/timetracker/capture',
    '/api/v1/getcompany-reffercode',
    '/api/v1/promotional-credit/:id',
    '/api/v1/timesheet',
    '/api/v1/report/time-forcasting',
    // AI Project Generator
    // The /execute/events/:jobId SSE endpoint is intentionally NOT listed
    // — EventSource can't send auth headers, and the jobId is a random
    // 24-char hex (≥96 bits) so it's safe as a bearer-style capability.
    // Matches the existing pattern for /api/v1/generatePrompt/events/:id.
    '/api/v1/ai/project/upload-brief',
    '/api/v1/ai/project/plan',
    '/api/v1/ai/project/clarify',
    '/api/v1/ai/project/execute',
    // Personal API tokens (Modules/ApiTokens). app.use prefix-matching
    // covers /:id, /:id/logs and /me too. Routes were previously
    // unauthenticated (trusted body userData) — now JWT-protected; the
    // PAT branch in jwt.js blocks PATs from token management except /me.
    '/api/v2/api-tokens',
    // Two-factor auth management (Phase 1). JWT + companyId required so req.uid
    // is populated for the handlers. /api/v2/auth/2fa/validate is intentionally
    // NOT here — it is public (the user is mid-login, holding only a tempToken).
    '/api/v2/auth/2fa/status',
    '/api/v2/auth/2fa/setup',
    '/api/v2/auth/2fa/verify',
    '/api/v2/auth/2fa/disable',
    // SSO admin config (Modules/SSO) — JWT+company so the owner/admin gate has
    // req.uid. The login-flow routes (/api/v2/sso/oidc|saml|public) stay PUBLIC
    // (pre-auth), so they are intentionally NOT listed here.
    '/api/v2/sso/config',
    '/api/v1/audit-logs',
    // SCIM admin config (Modules/Scim) — JWT+company; owner/admin gated
    // in-controller. The SCIM 2.0 protocol routes (/scim/v2/*) use bearer-token
    // auth (company resolved from the token) and are intentionally NOT listed.
    '/api/v2/scim/config',
    '/api/v2/scim/token',
    // Time-off / PTO (Modules/Pto) — JWT+company; prefix-matches /pto, /pto/:id,
    // /pto/:id/status, /pto/capacity. Role checks are enforced in-controller.
    '/api/v1/pto',
    // Cross-project Portfolio rollup (Modules/Portfolio, REP-01) — JWT+company;
    // prefix-matches /portfolio, /portfolio/:id, /portfolio/:id/rollup.
    '/api/v1/portfolio',
    // Custom report builder (Modules/CustomReports, REP-02) — JWT+company;
    // prefix-matches /reports/custom, /reports/custom/run, /reports/custom/:id.
    '/api/v1/reports/custom',
    '/api/v1/reports/variance',
    '/api/v1/reports/capacity',
    '/api/v1/reports/schedules',
    // Email-to-task management (AUTO-01). NOTE: only the /inboxes management
    // routes are JWT-protected; the public inbound webhook /api/v1/email-in/:token
    // is intentionally NOT listed (its secret token authenticates it).
    '/api/v1/email-in/inboxes',
    // Calendar feed management (AUTO-02). The public .ics feed
    // /api/v1/calendar/ics/:token is intentionally NOT listed (token authenticates it).
    '/api/v1/calendar/feeds',
];
const verifyJWTToken = [
    "/api/v2/company/delete",
    "/api/v2/company/create",
    "api/v1/freeCompanyCount",
    "/api/v1/wasabi/retriveUserProfile/:companyId/:path",
    "/api/v1/wasabi/uploadFile",
    "/api/v1/createPaymentPlan",
    "/api/v1/getSubscriptionPaymentResource/:id",
    "/api/v1/getSubscriptionTransection/:id",
    "/api/v1/getEnv",
    "/api/v1/createBucket",
    "/api/v1/updateBucket/:bucketId",
    "/api/v1/getBucket/:bucketId",
    "/api/v1/removeBucket/:bucketId",
    "/api/v1/getBucketSize/:bucketId",
    "/api/v1/storage/removeFile/:bucketId",
    "/api/v1/generateSignedUrl/:bucketId",
    "/api/v1/storage/uploadFile",
    "/api/v1/storage/uploadFileBase64",
    "/api/v1/user",
    "/api/v2/session/update",
    "/api/v1/userAndCompanyCheck",
    "/api/v1/admin/wasabi/retriveObject",
    "/api/v1/admin/getInvoiceAndCreditNotes",
    "/api/v1/editPaymentPlan",
    "/api/v1/planStatusChange",
    "/api/v1/uploadLogoFile",
    "/api/v1/admin/checkSendInviatation",
    "/api/v1/getInvoiceAndCreditNoteURL",
    "/api/v1/company-invitation",
    '/api/v1/subscription/:id',
    '/api/v1/subscription/find',
    '/api/v1/subscription',
    '/api/v1/subscriptions/:id',
    '/api/v1/admin/plan-feature',
    '/api/v1/admin/plan-feature-display',
    '/api/v1/invoice',
    '/api/v1/admin/company',
    '/api/v1/admin/company/find',
    '/api/v1/customer-update',
    '/api/v2/logout',
    '/api/v1/root-members',
    '/api/v1/dashboard/:id',
    '/api/v1/dashboard',
    '/api/v1/cardcomponent',
    '/api/v1/validateRefferalCode',
    '/api/v1/getreferralpercentage',
    '/api/v1/customeModals/checkUserReviewWithModal',
    '/api/v1/customeModals/addReview',
    '/api/v1/customeModals/getReviewModalConfig',
    '/api/v1/customeModals/submitButtonHandle'
];


/**
 * Middleware With CompanyId
 * @param {*} app 
 */
exports.setMiddlewareWithCV2 = (app) => {
    app.use(verifyJWTTokenWithCRoute, jwt.verifyJWTTokenWithCV2)
};


/**
 * Middleware
 * @param {*} app
 */
exports.setMiddlewareV2 = (app) => {
    app.use(verifyJWTToken, jwt.verifyJWTTokenV2)
    // Defense-in-depth: if any of these routes happens to carry a companyId
    // (body/params/query/header), enforce it matches the JWT audience.
    // Routes without a companyId scope pass through unchanged.
    app.use(verifyJWTToken, jwt.requireCompanyAud)
};
