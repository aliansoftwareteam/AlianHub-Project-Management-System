const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { invalidateAgentAccountCache } = require('./actor');

// Personal coding-agent accounts (27a–d).
//   workspace — the company's key, server-side, can run unattended
//   personal  — the developer's own Claude Code / Cursor / Codex; AlianHub never holds a key
//   local     — Ollama / vLLM inside the network
// Rules that live here: personal spend is never billed to the workspace, a personal
// account cannot run unattended, admins can require a mode, and unlinking revokes the
// token but keeps every comment, PR and hour on its task.

const MODES = Object.freeze(['workspace', 'personal', 'local']);
const PROVIDERS = Object.freeze(['claude-code', 'cursor', 'codex', 'antigravity', 'ollama', 'vllm', 'other']);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const getPolicy = async (companyId) => {
    const company = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, 'agentPolicy'] }, 'findOne').catch(() => null);
    const p = (company && company.agentPolicy) || {};
    return { allowedModes: Array.isArray(p.allowedModes) && p.allowedModes.length ? p.allowedModes.filter((m) => MODES.includes(m)) : [...MODES], requireCheckBeforeDone: Boolean(p.requireCheckBeforeDone) };
};

const setPolicy = async (companyId, { allowedModes, requireCheckBeforeDone }) => {
    const modes = Array.isArray(allowedModes) ? allowedModes.filter((m) => MODES.includes(m)) : null;
    if (allowedModes !== undefined && (!modes || !modes.length)) return { error: `allowedModes must be drawn from ${MODES.join(', ')}.` };
    const set = {};
    if (modes) set['agentPolicy.allowedModes'] = modes;
    if (requireCheckBeforeDone !== undefined) set['agentPolicy.requireCheckBeforeDone'] = Boolean(requireCheckBeforeDone);
    await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, { $set: set }] }, 'updateOne');
    return { policy: await getPolicy(companyId) };
};

const getAccount = async (userId) => {
    const user = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [{ _id: oid(userId) }, 'agentAccount'] }, 'findOne').catch(() => null);
    return (user && user.agentAccount) || null;
};

/* Link (or switch) the caller's account. Refused — with the reason shown — when
 * the workspace policy does not allow the mode. */
const link = async (companyId, userId, { mode, provider, label, email }) => {
    if (!MODES.includes(mode)) return { error: `mode must be one of ${MODES.join(', ')}.` };
    const policy = await getPolicy(companyId);
    if (!policy.allowedModes.includes(mode)) {
        return { error: `This workspace requires ${policy.allowedModes.join(' or ')} accounts — ${mode} is not allowed by your admin.`, status: 403 };
    }
    const account = { mode, provider: PROVIDERS.includes(provider) ? provider : 'other', label: String(label || '').slice(0, 80), email: String(email || '').slice(0, 200), linkedAt: new Date() };
    await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [{ _id: oid(userId) }, { $set: { agentAccount: account } }] }, 'updateOne');
    invalidateAgentAccountCache(userId);
    return { account };
};

/* Unlink: revoke every agent token the person holds in this workspace. History stays. */
const unlink = async (companyId, userId) => {
    await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [{ _id: oid(userId) }, { $unset: { agentAccount: 1 } }] }, 'updateOne');
    const revoked = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.API_TOKENS, data: [{ userId: String(userId), $or: [{ kind: 'agent' }, { 'agentAccount.mode': { $exists: true } }] }, { $set: { active: false } }],
    }, 'updateMany').catch(() => ({ modifiedCount: 0 }));
    invalidateAgentAccountCache(userId);
    return { revokedTokens: (revoked && (revoked.modifiedCount || revoked.nModified)) || 0 };
};

/* "This month, through your account" (27b) — tasks worked, agent hours, PRs
 * opened, $0 to the company. A report, not a feature: AlianHub never reads the
 * person's provider invoice. */
const monthlySummary = async (companyId, userId, month) => {
    const key = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
    const from = new Date(`${key}-01T00:00:00.000Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const [logs, runs, linkedTasks] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [{ Loggeduser: String(userId), actorType: 'agent', createdAt: { $gte: from, $lt: to } }, 'TicketID LogTimeDuration viaAccount'] }, 'find').catch(() => []),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ startedBy: String(userId), viaAccount: 'personal', startedAt: { $gte: from, $lt: to } }, 'spend taskId'] }, 'find').catch(() => []),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ links: { $elemMatch: { addedBy: String(userId), kind: 'pr', addedAt: { $gte: from, $lt: to } } } }, '_id links'] }, 'find').catch(() => []),
    ]);
    const tasks = new Set((logs || []).map((l) => String(l.TicketID)));
    (runs || []).forEach((r) => { if (r.taskId) tasks.add(String(r.taskId)); });
    const minutes = (logs || []).reduce((s, l) => s + (Number(l.LogTimeDuration) || 0), 0);
    const prs = (linkedTasks || []).reduce((s, t) => s + (t.links || []).filter((l) => l.kind === 'pr' && String(l.addedBy) === String(userId) && new Date(l.addedAt) >= from && new Date(l.addedAt) < to).length, 0);
    const personalUsd = (runs || []).reduce((s, r) => s + Number((r.spend && r.spend.personalUsd) || 0), 0);
    return { month: key, tasksWorked: tasks.size, agentHours: Math.round((minutes / 60) * 10) / 10, prsOpened: prs, usdToCompany: 0, personalUsdEstimate: Math.round(personalUsd * 100) / 100 };
};

module.exports = { MODES, PROVIDERS, getPolicy, setPolicy, getAccount, link, unlink, monthlySummary };
