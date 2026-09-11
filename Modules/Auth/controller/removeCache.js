const { myCache } = require('../../../Config/config');

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

const removeCacheHandler = (req, res) => {
    try {
        const { cacheKey, isPrefix, global: flushAll } = req.body || {};
        if (flushAll) {
            return res.status(403).json({ status: false, statusText: 'Forbidden', message: 'Flushing the whole cache is not available.' });
        }
        if (typeof cacheKey !== 'string' || !cacheKey) {
            return res.status(400).json({ status: false, statusText: 'Bad Request', message: 'cacheKey is required' });
        }
        const scope = { companyId: String(req.headers.companyid || ''), uid: String(req.uid || '') };
        if (!isPrefix && !belongsToCaller(cacheKey, scope)) {
            return res.status(403).json({ status: false, statusText: 'Forbidden', message: 'That cache key does not belong to your company.' });
        }
        const removed = removeCallerCache({ cacheKey, isPrefix: Boolean(isPrefix), ...scope });
        return res.status(200).json({ status: true, statusText: 'Cache cleared successfully', data: { removed: removed.length } });
    } catch (error) {
        return res.status(500).json({ status: false, statusText: 'Internal Server Error', message: error.message });
    }
};

module.exports = { removeCacheHandler, removeCallerCache, belongsToCaller };
