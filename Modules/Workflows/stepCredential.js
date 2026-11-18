const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const store = require('./store');
const registry = require('../Agents/registry');
const { leaseMs, heartbeatMs } = require('./flag');
const { STEP_CREDENTIAL_KIND, stepCredentialsEnabled } = require('../Agents/serviceIdentity');

// A replaced credential is not revoked: it stays good until the first re-mint at
// least REMINT_GRACE_MS after it was replaced, so an action already in flight
// during a re-mint is not refused, and no credential outlives one lease.

const ALGORITHM = 'HS256';
const KEY_SALT = 'alianhub-step-credential';
const REFUSAL_PREFIX = 'step credential refused';

const REFUSAL = Object.freeze({
    INVALID: 'credential_invalid',
    EXPIRED: 'credential_expired',
    WRONG_COMPANY: 'wrong_company',
    STEP_MISSING: 'step_missing',
    STEP_FINISHED: 'step_finished',
    STEP_RELEASED: 'step_released',
    STEP_RECLAIMED: 'step_reclaimed',
    LEASE_EXPIRED: 'lease_expired',
    AGENT_MISMATCH: 'agent_mismatch',
    STARTER_MISMATCH: 'starter_mismatch',
    ACTION_NOT_GRANTED: 'action_not_granted',
    RUN_NOT_RUNNING: 'run_not_running',
    SUPERSEDED: 'credential_superseded',
    MISSING: 'credential_missing',
});

const enabled = stepCredentialsEnabled;

/* A dedicated secret when the install sets one, JWT_SECRET otherwise: the same
 * fallback the two-factor and instance-settings keys use. Never JWT_SECRET
 * itself, so a credential is not a session token under another name. */
let cached = { material: null, key: null };
const key = () => {
    const material = process.env.STEP_CREDENTIAL_SECRET || process.env.JWT_SECRET || '';
    if (!material) throw new Error('STEP_CREDENTIALS needs STEP_CREDENTIAL_SECRET or JWT_SECRET to sign with');
    if (cached.material !== material) cached = { material, key: crypto.scryptSync(material, KEY_SALT, 32) };
    return cached.key;
};

/* An agent that narrows nothing may do every registry action, as registry.evaluate
 * reads it; an agent step whose agent was not found is granted nothing. */
const actionsFor = (step, agent) => {
    const type = String(step && step.type);
    const config = (step && step.config) || {};
    if (type === 'agent_run') {
        if (!agent) return [];
        const allowed = Array.isArray(agent.allowedActions) ? agent.allowedActions.map(String) : [];
        return allowed.length ? allowed : registry.keys();
    }
    if (type === 'tool_call') return config.tool ? [String(config.tool)] : [];
    return [];
};

/* A fresh id and expiry over the same claims, which is all a re-mint changes. */
const sign = (claims, leaseExpiresAt, now = new Date()) => {
    const credentialId = crypto.randomBytes(12).toString('hex');
    // A JWT expiry is whole seconds, rounded up so a credential never dies before its
    // lease does; the live lease check bounds the sub-second it may outlive it by.
    const expiresAt = new Date(Math.ceil(new Date(leaseExpiresAt).getTime() / 1000) * 1000);
    const signed = { ...claims, jti: credentialId };
    const token = jwt.sign({ ...signed, iat: Math.floor(now.getTime() / 1000), exp: Math.floor(expiresAt.getTime() / 1000) }, key(), { algorithm: ALGORITHM });
    return { token, credentialId, expiresAt, claims: signed };
};

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/* An ObjectId, its hex in either case and a plain string id are the same id to Mongo. */
const idOf = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return OBJECT_ID.test(text) ? text.toLowerCase() : text;
};

const same = (a, b) => idOf(a) === idOf(b);

const mint = ({ companyId, run, step, actions = [], agentId, now = new Date() }) => {
    const config = step.config || {};
    const named = agentId !== undefined ? agentId : (config.agentId || (run && run.agentId) || null);
    return sign({
        kind: STEP_CREDENTIAL_KIND,
        companyId: String(companyId),
        runId: String(step.runId),
        stepId: String(step.stepId),
        stepRunId: String(step._id),
        fencingToken: Number(step.fencingToken),
        agentId: named ? String(named) : null,
        startedBy: run && run.startedBy ? String(run.startedBy) : null,
        actions: [...new Set(actions.map(String))],
    }, step.leaseExpiresAt, now);
};

/* The flag is read before `agentOf`, so a claim with it off reads what it read
 * before. `agentOf` answers { agentId, agent }: an agent it could not read throws
 * rather than coming back empty, since an empty answer would be taken as "no agent". */
const issue = async ({ companyId, run, step, agentOf, now }) => {
    if (!enabled()) return null;
    const found = typeof agentOf === 'function' ? await agentOf() : null;
    const agent = found ? found.agent : null;
    const agentId = found && found.agentId !== undefined ? found.agentId : undefined;
    return mint({ companyId, run, step, actions: actionsFor(step, agent), agentId, now });
};

/* The row names only the current credential and the one it replaced, so two
 * re-mints close together would refuse an action that read its credential just
 * before them. A renewal inside the grace of the last re-mint only confirms the
 * claim, and keeps the lease inside the credential the step holds. Half the
 * heartbeat at most, so a replaced credential is retired within the grace plus
 * one heartbeat. */
const REMINT_GRACE_MS = 30 * 1000;
const remintGraceMs = () => Math.min(REMINT_GRACE_MS, Math.floor(heartbeatMs() / 2));

/* Renewals are chained: two at once (the timer and a step's own keepAlive) would
 * otherwise each replace the same credential, and the step could end up holding
 * one the row no longer names. A lease that has already lapsed is not renewed. */
const hold = (companyId, claim, first) => {
    let current = first;
    let replacedAt = null;
    let queue = Promise.resolve();
    const renewOnce = async ({ now = new Date(), lease = leaseMs() } = {}) => {
        if (replacedAt !== null && now.getTime() - replacedAt < remintGraceMs()) {
            const untilCredentialExpires = new Date(current.expiresAt).getTime() - now.getTime();
            return store.heartbeat(companyId, { ...claim, now, lease: untilCredentialExpires, onlyWhileLive: true });
        }
        const next = sign(current.claims, new Date(now.getTime() + lease), now);
        const set = { credentialId: next.credentialId, previousCredentialId: current.credentialId, credentialExpiresAt: next.expiresAt };
        const held = await store.heartbeat(companyId, { ...claim, now, lease, set, onlyWhileLive: true });
        if (held) {
            current = next;
            replacedAt = now.getTime();
        }
        return held;
    };
    const renew = (options) => {
        const turn = queue.then(() => renewOnce(options));
        queue = turn.catch(() => {});
        return turn;
    };
    return { token: () => current.token, renew };
};

const refusal = (code, detail) => ({ ok: false, code, reason: `${REFUSAL_PREFIX}: ${code}${detail ? ` (${detail})` : ''}` });

/* Signature only. Expiry is judged in check(), after the live row, so a step that
 * was reclaimed or has settled says so even when its credential has also run out. */
const verify = (token) => {
    try {
        return { claims: jwt.verify(String(token || ''), key(), { algorithms: [ALGORITHM], ignoreExpiration: true }) };
    } catch (error) {
        return { error: REFUSAL.INVALID };
    }
};

/* The row and the run are compared before the credential's own expiry, so a step
 * that was reclaimed or has settled says so even when its credential has also run out. */
const check = async (companyId, token, { action = null, actor = null, now = new Date() } = {}) => {
    const { claims, error } = verify(token);
    if (error) return refusal(error);
    if (claims.kind !== STEP_CREDENTIAL_KIND) return refusal(REFUSAL.INVALID, 'not a step credential');
    if (!same(claims.companyId, companyId)) return refusal(REFUSAL.WRONG_COMPANY);
    const tenant = String(claims.companyId);
    const where = `${claims.runId}/${claims.stepId}`;
    if (!same(claims.agentId, actor && actor.agentId)) return refusal(REFUSAL.AGENT_MISMATCH, `${where} was claimed for another agent than the one presenting it`);
    if (!same(claims.startedBy, actor && actor.userId)) return refusal(REFUSAL.STARTER_MISMATCH, `${where} was started by someone other than the person it is presented on behalf of`);
    const step = await store.getStep(tenant, claims.runId, claims.stepId);
    if (!step || !same(step._id, claims.stepRunId)) return refusal(REFUSAL.STEP_MISSING, where);
    if (step.config && step.config.agentId && !same(step.config.agentId, claims.agentId)) return refusal(REFUSAL.AGENT_MISMATCH, `${where} now names another agent`);
    if (store.STEP_TERMINAL.includes(step.status)) return refusal(REFUSAL.STEP_FINISHED, `${where} is ${step.status}`);
    if (step.status !== 'running') return refusal(REFUSAL.STEP_RELEASED, `${where} is ${step.status}`);
    if (Number(step.fencingToken) !== Number(claims.fencingToken)) return refusal(REFUSAL.STEP_RECLAIMED, `${where} fencing token ${step.fencingToken}, credential ${claims.fencingToken}`);
    if (claims.jti !== step.credentialId && claims.jti !== step.previousCredentialId) return refusal(REFUSAL.SUPERSEDED, `${where} has since been given a newer credential`);
    const run = await store.getRun(tenant, claims.runId);
    if (!run || run.status !== 'running') return refusal(REFUSAL.RUN_NOT_RUNNING, `run ${claims.runId} is ${run ? run.status : 'gone'}`);
    if (!same(run.startedBy, claims.startedBy)) return refusal(REFUSAL.STARTER_MISMATCH, `run ${claims.runId} was started by someone else`);
    if (!(Number(claims.exp) * 1000 > now.getTime())) return refusal(REFUSAL.EXPIRED, where);
    if (!step.leaseExpiresAt || new Date(step.leaseExpiresAt).getTime() <= now.getTime()) return refusal(REFUSAL.LEASE_EXPIRED, where);
    if (action !== null && !(Array.isArray(claims.actions) && claims.actions.includes(String(action)))) return refusal(REFUSAL.ACTION_NOT_GRANTED, `${action} is not granted to ${where}`);
    return { ok: true, claims, step };
};

/* The live credentials a person may see: every run's for an owner or admin, the
 * runs they started for anyone else. Never the credential, nor its id. */
const listActive = async (companyId, { userId, privileged = false, now = new Date() } = {}) => {
    if (!enabled()) return [];
    const steps = await store.listCredentialedSteps(companyId, now);
    if (!steps.length) return [];
    const runs = await store.listRunsById(companyId, [...new Set(steps.map((step) => String(step.runId)))]);
    const byId = Object.fromEntries(runs.map((run) => [String(run._id), run]));
    const viewer = String(userId || '');
    return steps
        .map((step) => ({ step, run: byId[String(step.runId)] }))
        .filter(({ run }) => run && (privileged || (OBJECT_ID.test(viewer) && same(run.startedBy, viewer))))
        .map(({ step, run }) => ({
            _id: String(step._id),
            kind: 'step_scoped',
            runId: String(run._id),
            runName: run.name || run.ruleName || '',
            source: run.source || null,
            stepId: String(step.stepId),
            stepType: String(step.type),
            issuedAt: step.claimedAt || null,
            expiresAt: step.credentialExpiresAt || null,
            startedBy: { id: run.startedBy ? String(run.startedBy) : '', name: '' },
        }))
        .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime() || a.runId.localeCompare(b.runId) || a.stepId.localeCompare(b.stepId));
};

module.exports = { REFUSAL, REFUSAL_PREFIX, enabled, actionsFor, mint, issue, hold, check, listActive };
