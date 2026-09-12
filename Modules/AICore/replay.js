const crypto = require('crypto');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const usage = require('./usage');
const { FEATURES } = require('./features');
const { redact, redactMessages } = require('./redact');

/* The replay record: one row per model call, written by the core meter
 * (spend.js) so no feature can call a model without leaving one. The prompt
 * holds tenant content, so the stored copy is redacted and capped and expires;
 * promptHash is taken before redaction so identical prompts still match.
 * `decision` is the routing decision for the same call (decision.js): provider
 * names and numbers only, so it carries nothing to redact. */

const LOG_PREFIX = '[ai-replay]';
const MODES = ['off', 'agent', 'all'];
const DEFAULT_MODE = 'agent';
const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 86400000;
const MAX_BYTES = 200 * 1024;

const mode = () => {
    const value = String(process.env.AI_REPLAY || 'agent').trim().toLowerCase();
    return MODES.includes(value) ? value : DEFAULT_MODE;
};

const retentionDays = () => {
    const days = Number(process.env.AI_REPLAY_RETENTION_DAYS || 30);
    return Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
};

const shouldRecord = (feature) => {
    const current = mode();
    if (current === 'off') return false;
    return current === 'all' || feature === FEATURES.AGENT_RUN;
};

const promptHashOf = (opts) => crypto.createHash('sha256').update(JSON.stringify({ system: opts && opts.systemPrompt, messages: opts && opts.messages })).digest('hex');

function cut(text, budget) {
    const bytes = Buffer.byteLength(text);
    if (bytes <= budget) return { text, used: bytes, cut: false };
    const kept = Buffer.from(text).subarray(0, Math.max(0, budget)).toString('utf8').replace(/�+$/, '');
    return { text: kept, used: Buffer.byteLength(kept), cut: true };
}

function cappedPrompt(system, messages) {
    let left = MAX_BYTES;
    let truncated = false;
    const take = (text) => {
        const out = cut(text, left);
        left -= out.used;
        truncated = truncated || out.cut;
        return out.text;
    };
    const cappedSystem = typeof system === 'string' ? take(system) : null;
    return { system: cappedSystem, messages: messages.map((m) => ({ role: m.role, content: take(m.content) })), truncated };
}

const orNull = (value) => (value === undefined || value === null ? null : value);

const revisionOf = (value) => {
    const n = Number(value);
    return value === undefined || value === null || !Number.isFinite(n) ? null : n;
};

const skillRevisionOf = (ref) => (ref && ref.key ? { key: String(ref.key), hash: orNull(ref.hash), n: orNull(ref.n) } : null);

const currentTraceId = () => {
    try {
        return require('../../Config/telemetry').traceIdNow() || null;
    } catch (e) {
        return null;
    }
};

const errorCodeOf = (error) => String(error.code || error.status || error.name || 'error');

function rowFor({ context, opts, adapter, result, error, durationMs, decision }) {
    const given = (opts && opts.spend) || {};
    const model = (result && result.model) || adapter.model || null;
    const tally = usage.usageFromResult(result);
    const priced = result ? usage.summarize(tally, model) : null;
    const prompt = cappedPrompt(redact(opts.systemPrompt), redactMessages(opts.messages));
    const response = result ? cut(redact(String(orNull(result.content) === null ? '' : result.content)), MAX_BYTES) : null;
    const createdAt = new Date();
    return {
        feature: context.feature,
        runId: context.runId,
        agentId: given.agentId ? String(given.agentId) : null,
        agentRevision: revisionOf(given.agentRevision),
        skillRevision: skillRevisionOf(given.skillRevision),
        model,
        provider: adapter.name || null,
        params: { temperature: orNull(opts.temperature), maxTokens: orNull(opts.maxTokens), jsonMode: Boolean(opts.jsonMode) },
        promptHash: promptHashOf(opts),
        system: prompt.system,
        messages: prompt.messages,
        retrievedChunkIds: Array.isArray(given.retrievedChunkIds) ? given.retrievedChunkIds.map(String) : [],
        response: response ? response.text : null,
        truncated: prompt.truncated || Boolean(response && response.cut),
        usage: { inputTokens: tally.inputTokens, outputTokens: tally.outputTokens },
        costUsd: priced && priced.priced ? priced.costUsd : null,
        durationMs: Number(durationMs) || 0,
        decision: decision || null,
        status: error ? 'error' : 'ok',
        errorCode: error ? errorCodeOf(error) : null,
        traceId: currentTraceId(),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + retentionDays() * DAY_MS),
    };
}

async function record(call) {
    const { context } = call;
    if (!shouldRecord(context.feature)) return null;
    try {
        return await MongoDbCrudOpration(context.companyId || dbCollections.GLOBAL, { type: SCHEMA_TYPE.AI_REPLAYS, data: rowFor(call) }, 'save');
    } catch (e) {
        logger.warn(`${LOG_PREFIX} ${context.companyId}: ${context.feature} call${context.runId ? ` in run ${context.runId}` : ''} not recorded: ${e.message}`);
        return null;
    }
}

module.exports = { record, mode, retentionDays, shouldRecord, promptHashOf, MAX_BYTES };
