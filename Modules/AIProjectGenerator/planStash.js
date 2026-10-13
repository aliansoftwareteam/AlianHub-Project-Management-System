'use strict';

const crypto = require('crypto');
const { myCache } = require('../../Config/config');

// /execute builds only what /plan proposed, so the plan, the brief it was built from and the guide drafted for it
// are the server's copies, kept for the generator session in this process's memory. A plan builds one project.
// A build holds its plan with a claim that lapses on its own, so a build that never finishes does not hold it for the
// whole session.

const PLAN_TTL_SECONDS = 60 * 60;
const CLAIM_TTL_SECONDS = 15 * 60;
const PLANS_PER_PERSON = 3;
const PLAN_EXPIRED = 'This plan has expired. Generate it again.';
const PLAN_IN_USE = 'This plan is already being built.';
const PLANS_BUSY = 'Your last plans are all being built. Wait for one to finish, then generate again.';

const cacheKey = (kind, uid, id) => `aipg:${kind}:${uid}:${id}`;
const indexKey = (uid) => cacheKey('plans', uid, 'index');
const claimKey = (kind, uid, planId) => cacheKey(`${kind}claim`, uid, planId);

const isClaimed = ({ uid, planId, kind = 'plan' }) => myCache.has(claimKey(kind, uid, planId));

const forgetPlan = ({ uid, planId }) => {
    myCache.del([cacheKey('plan', uid, planId), cacheKey('guide', uid, planId), claimKey('plan', uid, planId)]);
    const ids = myCache.get(indexKey(uid)) || [];
    if (ids.includes(planId)) myCache.set(indexKey(uid), ids.filter((id) => id !== planId), PLAN_TTL_SECONDS);
};

const livePlanIds = (uid) => (myCache.get(indexKey(uid)) || []).filter((id) => myCache.has(cacheKey('plan', uid, id)));

const hasRoomForPlan = (uid) => {
    const ids = livePlanIds(uid);
    return ids.length < PLANS_PER_PERSON || ids.some((planId) => !isClaimed({ uid, planId }));
};

/* The new plan's id, or null when every plan the person keeps is being built. */
const rememberPlan = ({ uid, companyId, plan, approvedBrief = '', assumptions = [] }) => {
    if (!hasRoomForPlan(uid)) return null;
    const planId = crypto.randomBytes(12).toString('hex');
    myCache.set(cacheKey('plan', uid, planId), { companyId, uid: String(uid), plan, approvedBrief, assumptions, createdAt: Date.now() }, PLAN_TTL_SECONDS);
    let ids = [...livePlanIds(uid), planId];
    while (ids.length > PLANS_PER_PERSON) {
        const oldest = ids.find((id) => id !== planId && !isClaimed({ uid, planId: id }));
        forgetPlan({ uid, planId: oldest });
        ids = ids.filter((id) => id !== oldest);
    }
    myCache.set(indexKey(uid), ids, PLAN_TTL_SECONDS);
    return planId;
};

const storedPlan = ({ uid, companyId, planId }) => {
    if (typeof planId !== 'string' || !planId) return null;
    const stash = myCache.get(cacheKey('plan', uid, planId));
    if (!stash || stash.companyId !== companyId || stash.uid !== String(uid)) return null;
    return stash;
};

/* Taken by the build that is running; false when the plan is gone or another build already took it. */
const claimPlan = ({ uid, planId, kind = 'plan' }) => {
    if (!myCache.has(cacheKey(kind, uid, planId)) || isClaimed({ uid, planId, kind })) return false;
    myCache.set(claimKey(kind, uid, planId), Date.now(), CLAIM_TTL_SECONDS);
    return true;
};
const releasePlan = ({ uid, planId, kind = 'plan' }) => { myCache.del(claimKey(kind, uid, planId)); };

const rememberGuide = ({ uid, companyId, planId, guide }) => {
    if (!storedPlan({ uid, companyId, planId })) return false;
    myCache.set(cacheKey('guide', uid, planId), { companyId, guide }, PLAN_TTL_SECONDS);
    return true;
};

const storedGuide = ({ uid, companyId, planId }) => {
    const stash = myCache.get(cacheKey('guide', uid, planId));
    return stash && stash.companyId === companyId ? stash.guide : null;
};

const rememberTasksPlan = ({ uid, companyId, projectId, mode, plan }) => {
    const planId = crypto.randomBytes(12).toString('hex');
    myCache.set(cacheKey('tasksplan', uid, planId), { companyId, uid: String(uid), projectId: String(projectId), mode, plan, createdAt: Date.now() }, PLAN_TTL_SECONDS);
    return planId;
};

const storedTasksPlan = ({ uid, companyId, projectId, planId }) => {
    if (typeof planId !== 'string' || !planId) return null;
    const stash = myCache.get(cacheKey('tasksplan', uid, planId));
    if (!stash || stash.companyId !== companyId || stash.uid !== String(uid) || stash.projectId !== String(projectId)) return null;
    return stash;
};

const forgetTasksPlan = ({ uid, planId }) => myCache.del([cacheKey('tasksplan', uid, planId), claimKey('tasksplan', uid, planId)]);

module.exports = {
    PLAN_TTL_SECONDS, CLAIM_TTL_SECONDS, PLANS_PER_PERSON, PLAN_EXPIRED, PLAN_IN_USE, PLANS_BUSY, cacheKey,
    rememberPlan, hasRoomForPlan, storedPlan, claimPlan, releasePlan, isClaimed, forgetPlan, rememberGuide, storedGuide,
    rememberTasksPlan, storedTasksPlan, forgetTasksPlan,
};
