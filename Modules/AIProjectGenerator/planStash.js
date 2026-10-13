'use strict';

const crypto = require('crypto');
const { myCache } = require('../../Config/config');

// /execute builds only what /plan proposed, so the plan, the brief it was built from and the guide drafted for it
// are the server's copies, kept for the generator session in this process's memory. A plan builds one project.
// A build holds its plan with a claim token whose lease it renews while it runs, up to MAX_HOLD_SECONDS, so a build
// that never finishes does not hold the plan for good. Only the holder of the token can release or use up the plan.

const PLAN_TTL_SECONDS = 60 * 60;
const CLAIM_TTL_SECONDS = 5 * 60;
const MAX_HOLD_SECONDS = 45 * 60;
const PLANS_PER_PERSON = 3;
const PLAN_EXPIRED = 'This plan has expired. Generate it again.';
const PLAN_IN_USE = 'This plan is already being built.';
const PLANS_BUSY = 'Your last plans are all being built. Wait for one to finish, then generate again.';

const cacheKey = (kind, uid, id) => `aipg:${kind}:${uid}:${id}`;
const indexKey = (uid) => cacheKey('plans', uid, 'index');
const claimKey = (kind, uid, planId) => cacheKey(`${kind}claim`, uid, planId);

const isClaimed = ({ uid, planId, kind = 'plan' }) => myCache.has(claimKey(kind, uid, planId));
const holds = ({ uid, planId, kind = 'plan', token }) => Boolean(token) && myCache.get(claimKey(kind, uid, planId)) === token;

/* Without a token only an unclaimed plan is forgotten; with one, only while that token still holds it. */
const forgetPlan = ({ uid, planId, token }) => {
    if (token ? !holds({ uid, planId, token }) : isClaimed({ uid, planId })) return false;
    myCache.del([cacheKey('plan', uid, planId), cacheKey('guide', uid, planId), claimKey('plan', uid, planId)]);
    const ids = myCache.get(indexKey(uid)) || [];
    if (ids.includes(planId)) myCache.set(indexKey(uid), ids.filter((id) => id !== planId), PLAN_TTL_SECONDS);
    return true;
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

/* The claim token of the build that takes the plan; null when the plan is gone or another build holds it. */
const claimPlan = ({ uid, planId, kind = 'plan' }) => {
    if (!myCache.has(cacheKey(kind, uid, planId)) || isClaimed({ uid, planId, kind })) return null;
    const token = crypto.randomBytes(12).toString('hex');
    myCache.set(claimKey(kind, uid, planId), token, CLAIM_TTL_SECONDS);
    return token;
};

const renewClaim = (claim) => {
    if (!holds(claim)) return false;
    myCache.ttl(claimKey(claim.kind || 'plan', claim.uid, claim.planId), CLAIM_TTL_SECONDS);
    return true;
};

const releasePlan = (claim) => {
    if (!holds(claim)) return false;
    myCache.del(claimKey(claim.kind || 'plan', claim.uid, claim.planId));
    return true;
};

/* Renews the claim while `running` is unsettled, for at most `upTo` ms. */
const keepClaimWhile = (claim, running, { every = (CLAIM_TTL_SECONDS * 1000) / 3, upTo = MAX_HOLD_SECONDS * 1000 } = {}) => {
    const stopAt = Date.now() + upTo;
    const timer = setInterval(() => {
        if (Date.now() >= stopAt || !renewClaim(claim)) clearInterval(timer);
    }, every);
    if (timer.unref) timer.unref();
    return Promise.resolve(running).finally(() => clearInterval(timer));
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

const forgetTasksPlan = ({ uid, planId, token }) => {
    if (!holds({ uid, planId, kind: 'tasksplan', token })) return false;
    myCache.del([cacheKey('tasksplan', uid, planId), claimKey('tasksplan', uid, planId)]);
    return true;
};

module.exports = {
    PLAN_TTL_SECONDS, CLAIM_TTL_SECONDS, MAX_HOLD_SECONDS, PLANS_PER_PERSON, PLAN_EXPIRED, PLAN_IN_USE, PLANS_BUSY, cacheKey,
    rememberPlan, hasRoomForPlan, storedPlan, claimPlan, renewClaim, releasePlan, keepClaimWhile, isClaimed, forgetPlan, rememberGuide, storedGuide,
    rememberTasksPlan, storedTasksPlan, forgetTasksPlan,
};
