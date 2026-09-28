const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { FEATURES, isFeature } = require('../AICore/features');

/* Feedback is kept per company and per person, one row per person and item. It never holds the question,
 * and holds the answer only when the person ticks "include the answer": for an Ask turn that text is read
 * from their own thread, never taken from the request. */

const RATINGS = Object.freeze(['up', 'down']);
const REASONS = Object.freeze(['wrong', 'missing_sources', 'too_long', 'not_asked', 'other']);
const KINDS = Object.freeze({ ASK_TURN: 'ask_turn', PREVIEW: 'preview', PROPOSAL: 'proposal' });
const KIND_LIST = Object.freeze(Object.values(KINDS));
const VIA = Object.freeze({ THUMBS: 'thumbs', DECLINE: 'decline' });
const LIMITS = Object.freeze({ NOTE: 300, ANSWER: 4000, SOURCES: 20, ITEMS: 50, MODEL: 120 });
/* A preview has no stored row to point at, so its id is made by the screen that showed it. */
const ITEM_ID = /^[A-Za-z0-9_-]{6,64}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MODEL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const store = (companyId, type, data, method) => MongoDbCrudOpration(String(companyId), { type, data }, method);
const feedbackStore = (companyId, data, method) => store(companyId, SCHEMA_TYPE.AI_FEEDBACK, data, method);

const clip = (value, n) => String(value == null ? '' : value).trim().slice(0, n);
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const refuse = (res, statusCode, code, statusText) => res.status(statusCode).send({ status: false, statusText, message: statusText, code });

const viewOf = (row) => ({
    id: String(row._id),
    feature: row.feature,
    kind: row.kind,
    itemId: row.itemId,
    rating: row.rating,
    reasons: row.reasons || [],
    note: row.note || '',
    shared: Boolean(row.shared),
});

/* Agents and tokens made for them rate nothing: feedback is a person's word. */
const callerOf = async (req, res) => {
    const companyId = String(req.headers['companyid'] || '');
    const uid = req.uid ? String(req.uid) : '';
    if (!companyId || !uid) {
        refuse(res, 401, 'unauthenticated', 'companyId and an authenticated user are required.');
        return null;
    }
    if (req.agentRun || req.apiToken) {
        const { resolveActor, isAgent } = require('../Agents/actor');
        if (isAgent(await resolveActor(req))) {
            refuse(res, 403, 'people_only', 'Only a person can rate an AI answer.');
            return null;
        }
    }
    return { companyId, uid };
};

const invalid = (body) => {
    if (!isFeature(body.feature)) return 'Name a known AI feature.';
    if (!KIND_LIST.includes(body.kind)) return `kind must be one of ${KIND_LIST.join(', ')}.`;
    if (!ITEM_ID.test(String(body.itemId || ''))) return 'itemId is required.';
    if (!RATINGS.includes(body.rating)) return 'rating must be up or down.';
    if (body.reasons !== undefined && (!Array.isArray(body.reasons) || body.reasons.some((r) => !REASONS.includes(r)))) return `reasons must be from ${REASONS.join(', ')}.`;
    return '';
};

const latestModel = async (companyId, where) => {
    const rows = await store(companyId, SCHEMA_TYPE.AI_USAGE, [where, 'model at', { sort: { at: -1 }, limit: 1, lean: true }], 'find').catch(() => []);
    return clip(rows && rows[0] && rows[0].model, LIMITS.MODEL);
};

const askTurnOf = async (companyId, uid, itemId) => {
    const thread = await store(companyId, SCHEMA_TYPE.ASK_THREADS, [{ ownerId: uid, turns: { $elemMatch: { turnId: itemId } } }, null, { lean: true }], 'findOne');
    const turn = thread && (thread.turns || []).find((t) => t && t.turnId === itemId);
    if (!turn) return null;
    return {
        threadId: String(thread._id),
        model: clip(turn.model, LIMITS.MODEL),
        answer: String(turn.answer || ''),
        sources: (turn.cited || []).map((c) => ({ kind: String(c.kind), sourceId: String(c.sourceId), ref: String(c.ref || '') })),
    };
};

const proposalOf = async (companyId, itemId) => {
    if (!OBJECT_ID.test(itemId)) return null;
    const proposal = await store(companyId, SCHEMA_TYPE.AGENT_PROPOSALS, [{ _id: oid(itemId) }, 'runId', { lean: true }], 'findOne');
    if (!proposal) return null;
    const runId = proposal.runId ? String(proposal.runId) : '';
    return { runId, model: runId ? await latestModel(companyId, { runId }) : '' };
};

const clientSources = (sources) => (Array.isArray(sources) ? sources : [])
    .filter((s) => s && s.kind && (s.id || s.sourceId))
    .slice(0, LIMITS.SOURCES)
    .map((s) => ({ kind: clip(s.kind, 40), sourceId: clip(s.id || s.sourceId, 64), ref: clip(s.ref, 80) }));

/* What the item itself says about the answer; null when the caller may not rate it. */
const subjectOf = async (companyId, uid, body) => {
    const itemId = String(body.itemId);
    if (body.kind === KINDS.ASK_TURN) {
        const turn = await askTurnOf(companyId, uid, itemId);
        return turn && { threadId: turn.threadId, runId: '', model: turn.model, answer: turn.answer, sources: turn.sources };
    }
    if (body.kind === KINDS.PROPOSAL) {
        const proposal = await proposalOf(companyId, itemId);
        return proposal && { threadId: '', runId: proposal.runId, model: proposal.model, answer: '', sources: [] };
    }
    const model = clip(body.model, LIMITS.MODEL)
        || await latestModel(companyId, { userId: uid, feature: body.feature, at: { $gte: new Date(Date.now() - MODEL_LOOKBACK_MS) } });
    return { threadId: '', runId: '', model, answer: String(body.answer || ''), sources: clientSources(body.sources) };
};

const upsert = (companyId, key, fields) => {
    const now = new Date();
    return feedbackStore(companyId, [key, { $set: { ...fields, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true, new: true, lean: true }], 'findOneAndUpdate');
};

/* PUT /api/v1/ai/feedback  body: { feature, kind, itemId, rating, reasons?, note?, includeAnswer?, answer?, sources?, model? } */
const saveFeedback = async (req, res) => {
    try {
        const caller = await callerOf(req, res);
        if (!caller) return undefined;
        const body = req.body || {};
        const problem = invalid(body);
        if (problem) return refuse(res, 400, 'invalid_feedback', problem);
        const subject = await subjectOf(caller.companyId, caller.uid, body);
        if (!subject) return refuse(res, 404, 'item_not_found', 'That answer does not exist, or it is not yours to rate.');
        const down = body.rating === 'down';
        const shared = body.includeAnswer === true && Boolean(subject.answer);
        const row = await upsert(caller.companyId, { userId: caller.uid, feature: body.feature, itemId: String(body.itemId) }, {
            kind: body.kind,
            threadId: subject.threadId,
            runId: subject.runId,
            model: subject.model,
            rating: body.rating,
            reasons: down ? [...new Set(body.reasons || [])] : [],
            note: down ? clip(body.note, LIMITS.NOTE) : '',
            via: VIA.THUMBS,
            shared,
            answer: shared ? subject.answer.slice(0, LIMITS.ANSWER) : '',
            sources: shared ? subject.sources.slice(0, LIMITS.SOURCES) : [],
        });
        return res.send({ status: true, statusText: 'Thanks for the feedback.', data: viewOf(row) });
    } catch (error) {
        logger.error(`ai feedback save: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* GET /api/v1/ai/feedback/mine?items=a,b — the caller's own ratings of those items */
const listMine = async (req, res) => {
    try {
        const caller = await callerOf(req, res);
        if (!caller) return undefined;
        const items = [...new Set(String((req.query && req.query.items) || '').split(',').map((s) => s.trim()).filter((s) => ITEM_ID.test(s)))].slice(0, LIMITS.ITEMS);
        const rows = items.length
            ? await feedbackStore(caller.companyId, [{ userId: caller.uid, itemId: { $in: items } }, 'feature kind itemId rating reasons note shared', { lean: true }], 'find')
            : [];
        return res.send({ status: true, data: { items: Object.fromEntries((rows || []).map((row) => [row.itemId, viewOf(row)])) } });
    } catch (error) {
        logger.error(`ai feedback mine: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v1/ai/feedback/:id — only the person who gave it */
const removeFeedback = async (req, res) => {
    try {
        const caller = await callerOf(req, res);
        if (!caller) return undefined;
        const id = String((req.params && req.params.id) || '');
        const result = OBJECT_ID.test(id) ? await feedbackStore(caller.companyId, [{ _id: oid(id), userId: caller.uid }], 'deleteOne') : null;
        if (!result || !result.deletedCount) return refuse(res, 404, 'feedback_not_found', 'That feedback does not exist, or it is not yours.');
        return res.send({ status: true, statusText: 'Feedback removed.', data: { id } });
    } catch (error) {
        logger.error(`ai feedback remove: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* A declined proposal is the decider's thumbs down; the decline reason is its note. */
const fromDecline = async (companyId, userId, { proposalId, runId = '', reason = '' }) => {
    if (!userId || !proposalId) return null;
    const run = runId ? String(runId) : '';
    return upsert(companyId, { userId: String(userId), feature: FEATURES.AGENT_RUN, itemId: String(proposalId) }, {
        kind: KINDS.PROPOSAL,
        threadId: '',
        runId: run,
        model: run ? await latestModel(companyId, { runId: run }) : '',
        rating: 'down',
        reasons: [],
        note: clip(reason, LIMITS.NOTE),
        via: VIA.DECLINE,
        shared: false,
        answer: '',
        sources: [],
    });
};

const validUser = (userId) => {
    const id = String(userId || '').trim();
    if (!OBJECT_ID.test(id)) throw new Error('Erasing AI feedback needs a valid user id.');
    return id;
};

/* Erasure by person (Knowledge/controls): answers how many rows went. */
const eraseUser = async (companyId, userId) => {
    const result = await feedbackStore(companyId, [{ userId: validUser(userId) }], 'deleteMany');
    return (result && result.deletedCount) || 0;
};

const hasFeedback = async (companyId, userId) => Boolean(await feedbackStore(companyId, [{ userId: validUser(userId) }, '_id', { lean: true }], 'findOne'));

module.exports = {
    RATINGS, REASONS, KINDS, VIA, LIMITS, saveFeedback, listMine, removeFeedback, fromDecline, eraseUser, hasFeedback,
};
