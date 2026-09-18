const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const store = require('./store');
const registry = require('../Agents/registry');
const { STEP_CREDENTIAL_KIND, stepCredentialsEnabled } = require('../Agents/serviceIdentity');

// The credential a step acts under, minted by the engine when it claims the
// step and verified against the live step row on every action.
//
// It is derived from the engine's identity, not from any person's token: it
// carries the tenant, the run, the step, the fencing token the claim won, the
// run's actor context and the actions the step may perform, and it expires with
// the lease. A credential for a step that has settled, been handed back or been
// reclaimed under a new fencing token is refused before it expires, so a leaked
// one buys one step's authority for the rest of one lease.

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
    ACTION_NOT_GRANTED: 'action_not_granted',
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

/* What a step may perform: an agent step is bounded by its agent (every registry
 * action when the agent narrows nothing, as registry.evaluate reads it), a tool
 * call by its one tool, and any other step by nothing. */
const actionsFor = (step, agent) => {
    const type = String(step && step.type);
    const config = (step && step.config) || {};
    if (type === 'agent_run') {
        const allowed = agent && Array.isArray(agent.allowedActions) ? agent.allowedActions.map(String) : [];
        return allowed.length ? allowed : registry.keys();
    }
    if (type === 'tool_call') return config.tool ? [String(config.tool)] : [];
    return [];
};

const mint = ({ companyId, run, step, actions = [], now = new Date() }) => {
    const credentialId = crypto.randomBytes(12).toString('hex');
    // A JWT expiry is whole seconds, rounded up so a credential never dies before its
    // lease does; the live lease check bounds the sub-second it may outlive it by.
    const expiresAt = new Date(Math.ceil(new Date(step.leaseExpiresAt).getTime() / 1000) * 1000);
    const config = step.config || {};
    const claims = {
        kind: STEP_CREDENTIAL_KIND,
        jti: credentialId,
        companyId: String(companyId),
        runId: String(step.runId),
        stepId: String(step.stepId),
        stepRunId: String(step._id),
        fencingToken: Number(step.fencingToken),
        agentId: config.agentId ? String(config.agentId) : (run && run.agentId ? String(run.agentId) : null),
        startedBy: run && run.startedBy ? String(run.startedBy) : null,
        actions: [...new Set(actions.map(String))],
    };
    const token = jwt.sign({ ...claims, iat: Math.floor(now.getTime() / 1000), exp: Math.floor(expiresAt.getTime() / 1000) }, key(), { algorithm: ALGORITHM });
    return { token, credentialId, expiresAt, claims };
};

/* Mints for a claimed step under the flag, nothing with it off. */
const issue = ({ companyId, run, step, agent, now }) => (enabled() ? mint({ companyId, run, step, actions: actionsFor(step, agent), now }) : null);

const refusal = (code, detail) => ({ ok: false, code, reason: `${REFUSAL_PREFIX}: ${code}${detail ? ` (${detail})` : ''}` });

const verify = (token) => {
    try {
        return { claims: jwt.verify(String(token || ''), key(), { algorithms: [ALGORITHM] }) };
    } catch (error) {
        return { error: error && error.name === 'TokenExpiredError' ? REFUSAL.EXPIRED : REFUSAL.INVALID };
    }
};

/* The live-step check. The row is read fresh every time: a credential is only
 * as good as the claim it was minted for, right now. */
const check = async (companyId, token, { action = null, now = new Date() } = {}) => {
    const { claims, error } = verify(token);
    if (error) return refusal(error);
    if (claims.kind !== STEP_CREDENTIAL_KIND) return refusal(REFUSAL.INVALID, 'not a step credential');
    if (String(claims.companyId) !== String(companyId)) return refusal(REFUSAL.WRONG_COMPANY);
    const where = `${claims.runId}/${claims.stepId}`;
    const step = await store.getStep(companyId, claims.runId, claims.stepId);
    if (!step || String(step._id) !== String(claims.stepRunId)) return refusal(REFUSAL.STEP_MISSING, where);
    if (store.STEP_TERMINAL.includes(step.status)) return refusal(REFUSAL.STEP_FINISHED, `${where} is ${step.status}`);
    if (step.status !== 'running') return refusal(REFUSAL.STEP_RELEASED, `${where} is ${step.status}`);
    if (Number(step.fencingToken) !== Number(claims.fencingToken)) return refusal(REFUSAL.STEP_RECLAIMED, `${where} fencing token ${step.fencingToken}, credential ${claims.fencingToken}`);
    if (!step.leaseExpiresAt || new Date(step.leaseExpiresAt).getTime() <= now.getTime()) return refusal(REFUSAL.LEASE_EXPIRED, where);
    if (action !== null && !(Array.isArray(claims.actions) && claims.actions.includes(String(action)))) return refusal(REFUSAL.ACTION_NOT_GRANTED, `${action} is not granted to ${where}`);
    return { ok: true, claims, step };
};

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

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
        .filter(({ run }) => run && (privileged || (OBJECT_ID.test(viewer) && String(run.startedBy || '') === viewer)))
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

module.exports = { REFUSAL, REFUSAL_PREFIX, enabled, actionsFor, mint, issue, check, listActive };
