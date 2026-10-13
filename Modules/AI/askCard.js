const logger = require('../../Config/loggerConfig');
const { answerQuestion, failed } = require('./ask');
const { callerOf, openSources, citedView } = require('./askThreads');
const { store } = require('./askCardStore');
const dashboards = require('../UserDashboard/controller');

/* An Ask card's answer is built from what its asker can open, so a kept answer belongs to one viewer of the dashboard:
 * every read and write here is keyed by the caller's own id, taken from the session and never from the request. */

const CARD_COMPONENT = 'AskAQuestionCard';
const CARD_UID = /^[\w-]{1,64}$/;
const QUESTION_MAX = 500;
const PROJECT_ID_MAX = 64;
const HOUR_MS = 60 * 60 * 1000;
const REFRESH_HOURS = [1, 6, 24, 168];
const DEFAULT_REFRESH_HOURS = 24;
const NEVER = 'never';
const NOT_FOUND = 'That card does not exist, or you cannot open its dashboard.';

const questionOf = (text) => String(text == null ? '' : text).trim().slice(0, QUESTION_MAX);

/* How long a kept answer stands before an open may ask again, from the card's own setting. */
const limitOf = (settings) => {
    const chosen = String((settings && settings.refreshAfter) ?? '');
    if (chosen === NEVER) return Infinity;
    return (REFRESH_HOURS.includes(Number(chosen)) ? Number(chosen) : DEFAULT_REFRESH_HOURS) * HOUR_MS;
};

const ageOf = (date, now) => (date ? now - new Date(date).getTime() : Infinity);
const isStale = (row, limit, now) => ageOf(row.askedAt, now) > limit;
const refreshDue = (row, limit, now) => isStale(row, limit, now) && ageOf(row.autoAskedAt, now) > limit;

/* One answer for a card nobody can see and for a card that is not there, so the reply tells an outsider nothing. */
const cardOf = async (req, res, caller) => {
    const { dashboardId, cardUid } = req.params || {};
    const dashboard = CARD_UID.test(String(cardUid || '')) ? await dashboards.findDashboardById(caller.companyId, dashboardId) : null;
    const card = dashboard && (dashboard.cards || []).find((c) => c && String(c.uid) === String(cardUid) && c.componentId === CARD_COMPONENT);
    if (!card || !dashboards.canViewDashboard(dashboard, caller.uid, await dashboards.visibleProjectIds(caller.companyId, caller.uid))) {
        res.status(404).send({ status: false, statusText: NOT_FOUND, code: 'card_not_found' });
        return null;
    }
    return {
        where: { dashboardId: String(dashboard._id), cardUid: String(cardUid), userId: caller.uid },
        limit: limitOf(card.config && card.config.cardData),
    };
};

/* A cite keeps ids alone; each is read again under the reader's access of the day, and one they can no longer open is left out. */
const storedView = async (caller, row) => {
    const cites = row.cited || [];
    const found = await openSources(caller.companyId, caller.uid, cites);
    return {
        question: row.question,
        projectId: row.projectId || '',
        answer: row.answer || '',
        cited: cites.map((cite) => citedView(cite, found)).filter((cite) => cite.available),
        askedAt: new Date(row.askedAt).getTime(),
    };
};

/* GET /api/v1/ai/ask/card/:dashboardId/:cardUid — the caller's own kept answer for that card, never anyone else's. */
const readAnswer = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const card = await cardOf(req, res, caller);
        if (!card) return undefined;
        const row = await store(caller.companyId, [card.where, null, { lean: true }], 'findOne');
        if (!row) return res.send({ status: true, data: { stored: null, stale: false, refreshDue: false } });
        const now = Date.now();
        return res.send({
            status: true,
            data: { stored: await storedView(caller, row), stale: isStale(row, card.limit, now), refreshDue: refreshDue(row, card.limit, now) },
        });
    } catch (error) {
        logger.error(`ask card read: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* Only one of two opens that find the same answer past its limit gets to ask: the claim is a conditional write. */
const claimRefresh = async (caller, card, now) => {
    const result = await store(caller.companyId, [
        { ...card.where, $or: [{ autoAskedAt: { $exists: false } }, { autoAskedAt: null }, { autoAskedAt: { $lte: new Date(now - card.limit) } }] },
        { $set: { autoAskedAt: new Date(now) } },
    ], 'updateOne');
    return Boolean(result && result.modifiedCount);
};

/* POST /api/v1/ai/ask/card/:dashboardId/:cardUid  body: { question, projectId?, fresh? }
 * Asks as the caller and keeps the answer for the caller. Without `fresh`, a kept answer to the same question and scope
 * is handed back instead, unless it is past the card's limit and no open has asked for it within that limit. */
const askAnswer = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const card = await cardOf(req, res, caller);
        if (!card) return undefined;
        const body = req.body || {};
        const question = questionOf(body.question);
        const projectId = String(body.projectId || '').slice(0, PROJECT_ID_MAX);
        if (!question) return res.send({ status: false, statusText: 'Ask a question first.', code: 'question_required' });

        const row = body.fresh === true ? null : await store(caller.companyId, [card.where, null, { lean: true }], 'findOne');
        if (row && row.question === question && (row.projectId || '') === projectId) {
            const now = Date.now();
            const claimed = refreshDue(row, card.limit, now) && await claimRefresh(caller, card, now);
            if (!claimed) return res.send({ status: true, statusText: 'OK', data: { configured: true, ...(await storedView(caller, row)), kept: true } });
        }

        const reply = await answerQuestion(req, { question, mode: 'ask', projectId });
        // No usage means the model was never called, so opening again costs nothing and there is nothing to keep.
        if (!reply.status || !reply.data || !reply.data.usage) return res.send(reply);

        const askedAt = new Date();
        const cited = (reply.data.cited || []).filter((s) => s && s.kind && s.id).map((s) => ({ kind: String(s.kind), sourceId: String(s.id), ref: String(s.ref || '') }));
        await store(caller.companyId, [card.where, { $set: { question, projectId, answer: reply.data.answer || '', cited, askedAt } }, { upsert: true }], 'updateOne');
        return res.send({ ...reply, data: { ...reply.data, askedAt: askedAt.getTime() } });
    } catch (error) {
        logger.error(`ask card: ${error.message}`);
        return res.send(failed(error));
    }
};

module.exports = { readAnswer, askAnswer, limitOf, REFRESH_HOURS, DEFAULT_REFRESH_HOURS };
