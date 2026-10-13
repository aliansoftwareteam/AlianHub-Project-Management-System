'use strict';

const crypto = require('crypto');
const { myCache } = require('../../Config/config');

// /execute builds only what /plan proposed, so the plan, the brief it was built from and the guide drafted for it
// are the server's copies, kept for the generator session.

const PLAN_TTL_SECONDS = 60 * 60;
const PLAN_EXPIRED = 'This plan has expired. Generate it again.';

const cacheKey = (kind, uid, id) => `aipg:${kind}:${uid}:${id}`;

const rememberPlan = ({ uid, companyId, plan, approvedBrief = '', assumptions = [] }) => {
    const planId = crypto.randomBytes(12).toString('hex');
    myCache.set(cacheKey('plan', uid, planId), { companyId, uid: String(uid), plan, approvedBrief, assumptions, createdAt: Date.now() }, PLAN_TTL_SECONDS);
    return planId;
};

const storedPlan = ({ uid, companyId, planId }) => {
    if (typeof planId !== 'string' || !planId) return null;
    const stash = myCache.get(cacheKey('plan', uid, planId));
    if (!stash || stash.companyId !== companyId || stash.uid !== String(uid)) return null;
    return stash;
};

const rememberGuide = ({ uid, companyId, planId, guide }) => {
    if (!storedPlan({ uid, companyId, planId })) return false;
    myCache.set(cacheKey('guide', uid, planId), { companyId, guide }, PLAN_TTL_SECONDS);
    return true;
};

const storedGuide = ({ uid, companyId, planId }) => {
    const stash = myCache.get(cacheKey('guide', uid, planId));
    return stash && stash.companyId === companyId ? stash.guide : null;
};

module.exports = { PLAN_TTL_SECONDS, PLAN_EXPIRED, cacheKey, rememberPlan, storedPlan, rememberGuide, storedGuide };
