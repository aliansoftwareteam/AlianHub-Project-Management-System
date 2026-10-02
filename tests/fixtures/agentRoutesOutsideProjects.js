/* Every other write route an agent token is not stopped on, under why it changes nothing in a project. A route
 * added later is in none of these lists, and fails in agent-rest-route-actions until it is held for people, asks the
 * project's rule, or is placed here with its reason. agent-rest-outside-projects runs each of them. */
const OUTSIDE_EVERY_PROJECT = {
    'answers a question and saves nothing': [
        'POST /api/v1/admin/checkSendInviatation', 'POST /api/v1/checkSendInviatation', 'POST /api/v1/admin/company', 'POST /api/v1/admin/company/find', 'POST /api/v1/company',
        'POST /api/v1/advance/filter/search/comments', 'POST /api/v1/advance/filter/search/files', 'POST /api/v1/advance/filter/search/links',
        'POST /api/v1/advance/filter/search/projects', 'POST /api/v1/advance/filter/search/tasks', 'POST /api/v1/ai/task-values',
        'POST /api/v1/automations/preview', 'POST /api/v2/automations/:id/dry-run', 'POST /api/v2/automations/backtest', 'POST /api/v2/automations/compile',
        'POST /api/v1/dashboard/at-risk', 'POST /api/v1/dashboard/employee-workload', 'POST /api/v1/dashboard/my-achievements', 'POST /api/v1/dashboard/my-due-soon',
        'POST /api/v1/dashboard/my-leave', 'POST /api/v1/dashboard/my-next-tasks', 'POST /api/v1/dashboard/my-time', 'POST /api/v1/dashboard/on-leave',
        'POST /api/v1/dashboard/project-metrics', 'POST /api/v1/dashboard/project-utilization-summary', 'POST /api/v1/dashboard/tasks-by-status',
        'POST /api/v1/dashboard/team-logged-vs-eta', 'POST /api/v1/dashboard/team-tasktype-breakdown',
        'POST /api/v1/estimatedTime', 'POST /api/v1/export/csv', 'POST /api/v1/export/pdf', 'POST /api/v1/export/xlsx', 'POST /api/v2/exports',
        'POST /api/v1/findOneAiModel', 'POST /api/v1/findOnePrompts', 'POST /api/v1/getAiCategory', 'POST /api/v1/getAiModels', 'POST /api/v1/getPrompts',
        'POST /api/v1/get-remaining-projects', 'POST /api/v1/getGlobalTemplate', 'POST /api/v1/mongoOpration', 'POST /api/v1/project/search',
        'POST /api/v1/reports/custom/run', 'POST /api/v1/tabSyncTask', 'POST /api/v1/task/find', 'POST /api/v2/tasks/everything',
        'POST /api/v1/timesheet', 'POST /api/v1/timesheet/billable-summary', 'POST /api/v1/timesheet/export-csv', 'POST /api/v1/timesheet/logDetail',
        'POST /api/v1/timesheet/project', 'POST /api/v1/timesheet/timelog', 'POST /api/v1/timesheet/tracker', 'POST /api/v1/timesheet/user',
        'POST /api/v1/timesheet/workload', 'POST /api/v1/timesheet/workload-grid', 'POST /api/v2/timetracker/timelog',
        'POST /api/v1/user/find', 'POST /api/v1/userAndCompanyCheck', 'POST /api/v1/validateRefferalCode', 'POST /api/v2/checkPermission',
        'POST /api/v2/custom-fields/formula/validate', 'POST /api/v2/custom-fields/links/resolve',
        'POST /api/v2/imports/clickup/preview', 'POST /api/v2/imports/csv/preview', 'POST /api/v2/search',
        'POST /api/v2/sprints/burndown', 'POST /api/v2/sprints/hours', 'POST /api/v2/workflows/dry-run',
    ],
    'reads what a project keeps, and makes what is missing for a person alone': [
        'POST /api/v2/sprints/backlog',
    ],
    'keeps the person\'s own notes, marks, saved views and settings': [
        'PATCH /api/v1/clips/:id', 'POST /api/v1/clips', 'PATCH /api/v1/notes/:id', 'POST /api/v1/notes', 'PATCH /api/v2/calls/notes/:id',
        'PATCH /api/v1/reminders/:id', 'POST /api/v1/reminders', 'POST /api/v1/reminders/:id/run-now', 'POST /api/v1/reminders/run-due',
        'POST /api/v1/advance/filter/create', 'PUT /api/v1/advance/filter/update', 'POST /api/v1/project/filter/create', 'PUT /api/v1/project/filter/update',
        'POST /api/v1/task/filter/create', 'PUT /api/v1/task/filter/update', 'POST /api/v2/tasks/everything/views', 'PATCH /api/v2/tasks/everything/views/:id',
        'POST /api/v1/reports/custom', 'POST /api/v1/reports/custom/:id/duplicate', 'POST /api/v1/reports/custom/from-template', 'PUT /api/v1/reports/custom/:id',
        'POST /api/v1/inbox/clear', 'POST /api/v1/inbox/clear-all', 'POST /api/v1/inbox/read', 'POST /api/v1/inbox/read-all',
        'POST /api/v1/inbox/restore', 'POST /api/v1/inbox/restore-all', 'POST /api/v1/inbox/snooze', 'POST /api/v1/inbox/unsnooze',
        'POST /api/v1/pushupdateunreadcommentscount', 'POST /api/v1/updateunreadcommentscount', 'PUT /api/v1/collection/userid',
        'PUT /api/v1/app-notification/mark-all-read', 'PUT /api/v1/app-notification/mark-read', 'PUT /api/v1/push-mark-read', 'POST /api/v1/removeUserNotification',
        'PUT /api/v1/notifications', 'PUT /api/v1/notifications/preferences', 'POST /api/v1/importSettingsNotification',
        'POST /api/v1/deleteUserChat', 'PUT /api/v1/ai/ask/threads/:id', 'PUT /api/v1/ai/feedback', 'POST /api/v1/removeCache',
        'PUT /api/v1/timesheet/workload-capacity', 'PUT /api/v1/user', 'POST /api/v2/recent-visits',
        'PUT /api/v2/users/favourites', 'PUT /api/v2/users/favourites/order', 'PUT /api/v2/users/home-cards', 'PUT /api/v2/users/nav-preferences', 'PUT /api/v2/users/onboarding',
        'PUT /api/v1/cloud-storage/settings/:provider', 'POST /api/v1/github/access-token', 'POST /api/v1/gitlab/access-token', 'POST /api/v1/google/access-token',
    ],
    'signs a person in or out, or takes a public link, a form or a webhook: no token is read': [
        'POST /api/v1/auth/loginAuthTracker', 'POST /api/v1/verifyToken', 'POST /api/v2/auth/2fa/validate', 'POST /api/v2/auth/forgot-password',
        'POST /api/v2/auth/invitation-accept', 'POST /api/v2/auth/invitation-preview', 'POST /api/v2/auth/login', 'POST /api/v2/auth/magic-link',
        'POST /api/v2/auth/reset-password', 'POST /api/v2/auth/token-verify-forgotpassword', 'POST /api/v2/auth/tracker-code', 'POST /api/v2/createUser',
        'POST /api/v2/generateToken', 'POST /api/v2/github-signup', 'POST /api/v2/gitlab-signup', 'POST /api/v2/google-signup', 'POST /api/v2/logout',
        'POST /api/v2/sendForgotPasswordEmail', 'POST /api/v2/sendVerificationEmail', 'POST /api/v2/test', 'POST /api/v2/verifyEmail', 'PUT /api/v2/session/update',
        'POST /api/v2/setup/complete', 'POST /api/v1/email-in/:token', 'POST /api/v1/slack/command/:companyId', 'POST /form/:token', 'POST /share/:token', 'POST /share/:token/intake',
    ],
    'is answered by the instance owner\'s guard or key, which takes no token': [
        'POST /api/v2/instance/audit/:companyId/redact-person', 'POST /api/v2/instance/backups', 'POST /api/v2/instance/backups/:name/restore',
        'POST /api/v2/instance/instruction-patterns', 'POST /api/v2/instance/knowledge/:companyId/erase/document', 'POST /api/v2/instance/knowledge/:companyId/erase/person',
        'POST /api/v2/instance/knowledge/:companyId/exclusions/:exclusionId/remove', 'POST /api/v2/instance/knowledge/:companyId/reembed',
        'POST /api/v2/instance/knowledge/:companyId/reindex', 'POST /api/v2/instance/knowledge/:companyId/reindex/cancel', 'POST /api/v2/instance/knowledge/:companyId/retry-files',
        'POST /api/v2/instance/maintenance', 'POST /api/v2/instance/migrations/run', 'POST /api/v2/instance/orphan-databases/:name/drop', 'POST /api/v2/instance/settings/test',
        'PUT /api/v2/instance/egress/:companyId', 'PUT /api/v2/instance/enforcement/:companyId/mode', 'PUT /api/v2/instance/enforcement/default', 'PUT /api/v2/instance/settings',
        'POST /api/v1/projectSetting/migrateSprintsFun', 'POST /api/v1/setPresetCompany', 'POST /api/v1/settings/oauth', 'POST /api/v1/tracker/create', 'PUT /api/v1/tracker/update',
        'POST /api/v1/updateAiModel', 'POST /api/v1/updateEmailTemplate', 'POST /api/v1/versionUpdateNotify',
    ],
    'is judged where it is handled, which takes a signed-in person or refuses a token': [
        'POST /api/v2/agents/proposals/:id/approve', 'POST /api/v2/agents/proposals/:id/decline', 'POST /api/v2/agents/proposals/:id/undo',
        'POST /api/v2/workflows/runs/:id/steps/:stepId/decide', 'PUT /api/v1/pto/:id/status', 'PUT /api/v2/ai-switch', 'PUT /api/v2/provider-keys/:provider',
        'POST /api/v2/secrets', 'POST /api/v2/secrets/:handle/revoke', 'POST /api/v2/secrets/:handle/rotate', 'POST /api/v1/ai/quality/held-out',
    ],
    'is the agent\'s own road, where the registry, the person\'s rights and the project\'s rule are asked of each change': [
        'POST /mcp', 'POST /api/v2/agents/proposals', 'POST /api/v2/agents/runs', 'POST /api/v2/agents/draft', 'POST /api/v2/agents/chat/direct',
        'POST /api/v2/agents/alerts/evaluate', 'POST /api/v2/agents/skills/:key/dry-run',
    ],
    'stores or reads a file under the bucket\'s own rule; a task route attaches it': [
        'PATCH /api/v1/updateBucket/:bucketId', 'POST /api/v1/createBucket', 'POST /api/v1/getTaskTypeImage', 'POST /api/v1/getUserProfile',
        'POST /api/v1/storage/uploadFile', 'POST /api/v1/storage/uploadFileBase64', 'POST /api/v1/admin/wasabi/retriveObject', 'POST /api/v1/wasabi/retriveObject',
        'POST /api/v1/wasabi/uploadFile', 'POST /api/v1/wasabi/uploadFile_64', 'POST /api/v1/cloud-storage/:provider/import',
    ],
};

module.exports = { OUTSIDE_EVERY_PROJECT };
