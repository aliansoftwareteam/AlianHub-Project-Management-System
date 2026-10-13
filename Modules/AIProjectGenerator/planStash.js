'use strict';

const crypto = require('crypto');
const { myCache } = require('../../Config/config');

// /execute builds only what /plan proposed, so the plan, the brief it was built from and the guide drafted for it
// are the server's copies, kept for the generator session in this process's memory. A plan builds one project.

const PLAN_TTL_SECONDS = 60 * 60;
const PLANS_PER_PERSON = 3;
const PLAN_EXPIRED = 'This plan has expired. Generate it again.';

const cacheKey = (kind, uid, id) => `aipg:${kind}:${uid}:${id}`;
const indexKey = (uid) => cacheKey('plans', uid, 'index');

const forgetPlan = ({ uid, planId }) => {
    myCache.del([cacheKey('plan', uid, planId), cacheKey('guide', uid, planId)]);
    const ids = myCache.get(indexKey(uid)) || [];
    if (ids.includes(planId)) myCache.set(indexKey(uid), ids.filter((id) => id !== planId), PLAN_TTL_SECONDS);
};

const rememberPlan = ({ uid, companyId, plan, approvedBrief = '', assumptions = [] }) => {
    const planId = crypto.randomBytes(12).toString('hex');
    myCache.set(cacheKey('plan', uid, planId), { companyId, uid: String(uid), plan, approvedBrief, assumptions, createdAt: Date.now() }, PLAN_TTL_SECONDS);
    const ids = [...(myCache.get(indexKey(uid)) || []).filter((id) => myCache.has(cacheKey('plan', uid, id))), planId];
    ids.slice(0, -PLANS_PER_PERSON).forEach((id) => forgetPlan({ uid, planId: id }));
    myCache.set(indexKey(uid), ids.slice(-PLANS_PER_PERSON), PLAN_TTL_SECONDS);
    return planId;
};

const storedPlan = ({ uid, companyId, planId }) => {
    if (typeof planId !== 'string' || !planId) return null;
    const stash = myCache.get(cacheKey('plan', uid, planId));
    if (!stash || stash.used || stash.companyId !== companyId || stash.uid !== String(uid)) return null;
    return stash;
};

const markUsed = (uid, planId, used) => {
    const key = cacheKey('plan', uid, planId);
    const stash = myCache.get(key);
    if (!stash || Boolean(stash.used) === used) return false;
    const ttl = myCache.getTtl(key);
    const left = ttl ? Math.max(1, Math.ceil((ttl - Date.now()) / 1000)) : PLAN_TTL_SECONDS;
    myCache.set(key, { ...stash, used }, left);
    return true;
};

/* Taken by the build that is running; false when another build already took it. */
const claimPlan = ({ uid, planId }) => markUsed(uid, planId, true);
const releasePlan = ({ uid, planId }) => markUsed(uid, planId, false);

const rememberGuide = ({ uid, companyId, planId, guide }) => {
    if (!storedPlan({ uid, companyId, planId })) return false;
    myCache.set(cacheKey('guide', uid, planId), { companyId, guide }, PLAN_TTL_SECONDS);
    return true;
};

const storedGuide = ({ uid, companyId, planId }) => {
    const stash = myCache.get(cacheKey('guide', uid, planId));
    return stash && stash.companyId === companyId ? stash.guide : null;
};

module.exports = {
    PLAN_TTL_SECONDS, PLANS_PER_PERSON, PLAN_EXPIRED, cacheKey, rememberPlan, storedPlan, claimPlan, releasePlan, forgetPlan, rememberGuide, storedGuide,
};
