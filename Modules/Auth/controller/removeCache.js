const { myCache } = require('../../../Config/config');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/* Cache keys embed the company id (`UserProjectData:<cid>:<uid>`, `rules:<cid>`) or, for
 * per-user entries, the user id (`dashboard_<uid>`). A key naming neither belongs to
 * another tenant, another user, or the whole instance, so a session may not drop it. */
const belongsToCaller = (key, { companyId, uid }) =>
    (OBJECT_ID_PATTERN.test(companyId) && key.includes(companyId))
    || (OBJECT_ID_PATTERN.test(uid) && key.includes(uid));

const removeCallerCache = ({ cacheKey, isPrefix, companyId, uid }) => {
    const candidates = isPrefix ? myCache.keys().filter((key) => key.includes(cacheKey)) : [cacheKey];
    const removable = candidates.filter((key) => belongsToCaller(key, { companyId, uid }));
    if (removable.length) myCache.del(removable);
    return removable;
};

/* Where the company id sits in each company-scoped key type. Another slot can hold a user or
 * project id equal to some company's id, so only the company slot is compared, and a key type
 * missing from this list is never flushed. */
const COMPANY_SLOT = {
    ...Object.fromEntries([
        'UserAllData', 'automation_rules', 'calendar_feeds', 'commonDateFormate', 'company_users', 'currency',
        'customField', 'designation', 'email_inboxes', 'fileExtensions', 'integration_connections', 'knowledgeFigures',
        'milestoneBillingPeriod', 'milestoneRange', 'milestoneStatus', 'portfolio_summary', 'portfolios', 'projectList',
        'project_status_template', 'projectstatus', 'pto', 'report_schedules', 'role', 'rules', 'saved_reports',
        'sprintPlanCheck', 'taskPriority', 'taskStatusTemplate', 'taskTypeTemplate', 'taskstatus', 'tasktype',
        'timesheet', 'UserProjectData',
    ].map((type) => [type, 1])),
    membership: 2,
    milestone: 2,
    notification: 2,
    roleType: 2,
};
const COMPANY_SUFFIX_TYPES = ['companyData_', 'project_template_', 'workloadSummary_'];

const companyOfKey = (key) => {
    const suffixType = COMPANY_SUFFIX_TYPES.find((type) => key.startsWith(type));
    if (suffixType) return key.slice(suffixType.length);
    const parts = key.split(':');
    const slot = COMPANY_SLOT[parts[0]];
    return slot === undefined ? null : parts[slot];
};

const removeCompanyCache = (companyId) => {
    if (!OBJECT_ID_PATTERN.test(companyId)) return [];
    const removable = myCache.keys().filter((key) => companyOfKey(key) === companyId);
    if (removable.length) myCache.del(removable);
    return removable;
};

const removeCacheHandler = async (req, res) => {
    try {
        const { cacheKey, isPrefix, global: flushCompany } = req.body || {};
        const scope = { companyId: String(req.headers.companyid || ''), uid: String(req.uid || '') };
        if (flushCompany) {
            if (!isPrivileged(await getRoleType(scope.companyId, scope.uid))) {
                return res.status(403).json({ status: false, statusText: 'Forbidden', message: 'Only an owner or an admin can clear the company cache.' });
            }
            const removed = removeCompanyCache(scope.companyId);
            return res.status(200).json({ status: true, statusText: 'Cache cleared successfully', data: { removed: removed.length } });
        }
        if (typeof cacheKey !== 'string' || !cacheKey) {
            return res.status(400).json({ status: false, statusText: 'Bad Request', message: 'cacheKey is required' });
        }
        if (!isPrefix && !belongsToCaller(cacheKey, scope)) {
            return res.status(403).json({ status: false, statusText: 'Forbidden', message: 'That cache key does not belong to your company.' });
        }
        const removed = removeCallerCache({ cacheKey, isPrefix: Boolean(isPrefix), ...scope });
        return res.status(200).json({ status: true, statusText: 'Cache cleared successfully', data: { removed: removed.length } });
    } catch (error) {
        return res.status(500).json({ status: false, statusText: 'Internal Server Error', message: error.message });
    }
};

module.exports = { removeCacheHandler, removeCallerCache, removeCompanyCache, belongsToCaller };
