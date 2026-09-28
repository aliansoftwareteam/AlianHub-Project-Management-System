'use strict';

const crypto = require('crypto');
const logger = require('../../Config/loggerConfig');
const aiSwitch = require('../AICore/aiSwitch');
const { isAnyProviderConfigured } = require('../AICore/llmProvider');
const { commentThreadAccess, refuseThread } = require('../Comments/helpers/threadAccess');
const { canPostToThread } = require('../Comments/helpers/threadWriteAccess');
const { tokenProjectIdsOf, aboutOf } = require('./ask');
const aiMention = require('./aiMention');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CHANNEL_THREAD = 'default';
const QUESTION_MAX = 1000;
const ANSWER_MAX = 20000;
const SHARE_TTL_MS = 30 * 60 * 1000;

const isId = (value) => typeof value === 'string' && OBJECT_ID.test(value);

const threadFrom = (body) => {
    const { projectId, sprintId, taskId } = body || {};
    if (!isId(projectId) || !isId(sprintId) || !(taskId === CHANNEL_THREAD || isId(taskId))) return null;
    return { projectId, sprintId, taskId };
};

const citedKey = (cited) => (Array.isArray(cited) ? cited : [])
    .map((c) => [String((c && c.kind) || ''), String((c && c.id) || ''), String((c && c.ref) || ''), String((c && c.projectId) || '')]);

/* A private answer can later be posted as it was given, by the person it was given to, and in the same conversation:
 * the signature covers all of it, so posting needs no stored copy and no second model call. */
const signatureOf = ({ companyId, uid, thread, question, answer, cited, issuedAt }) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set.');
    const payload = JSON.stringify([companyId, uid, thread.projectId, thread.sprintId, thread.taskId, question, answer, citedKey(cited), issuedAt]);
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
};

const shareTokenFor = (fields) => `${fields.issuedAt}.${signatureOf(fields)}`;

const shareTokenValid = (token, fields, now = Date.now()) => {
    const [issued, signature] = String(token || '').split('.');
    const issuedAt = Number(issued);
    if (!Number.isFinite(issuedAt) || !signature || now - issuedAt > SHARE_TTL_MS || issuedAt > now + 60 * 1000) return false;
    const expected = Buffer.from(signatureOf({ ...fields, issuedAt }), 'hex');
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

const companyOf = (req) => String(req.headers['companyid'] || '');
const questionIn = (body) => String((body && body.question) || '').trim().slice(0, QUESTION_MAX);

/** POST /api/v1/ai/chat-ask { projectId, sprintId, taskId, question }: answers the asker alone; nothing is posted. */
async function chatAskHandler(req, res) {
    const companyId = companyOf(req);
    if (!isId(companyId)) return res.status(400).json({ status: false, statusText: 'companyId header required' });
    const thread = threadFrom(req.body);
    const question = questionIn(req.body);
    if (!thread) return res.status(400).json({ status: false, statusText: 'projectId, sprintId and taskId are required.' });
    if (!question) return res.status(400).json({ status: false, statusText: 'Ask a question first.', code: 'question_required' });

    try {
        const access = await commentThreadAccess(companyId, req.uid, thread);
        if (!access.allowed) return refuseThread(res, access);
        await aiSwitch.assertAllowed(companyId);
        if (!isAnyProviderConfigured()) return res.status(200).json({ status: false, code: 'unconfigured', statusText: 'No model configured.' });
        if (!aiMention.hasRoom(companyId, req.uid)) return res.status(429).json({ status: false, code: 'rate_limited', statusText: 'Too many questions. Try again in a few minutes.' });
        aiMention.recordAsk(companyId, req.uid);

        const { answer, cited } = await aiMention.answerFor(companyId, {
            askerId: req.uid, question, thread, accessMatch: access.match, tokenProjectIds: tokenProjectIdsOf(req),
            about: await aboutOf(req, companyId, req.uid),
        });
        if (!answer) return res.status(200).json({ status: false, code: 'empty', statusText: 'No answer came back.' });
        const issuedAt = Date.now();
        const shareToken = shareTokenFor({ companyId, uid: String(req.uid), thread, question, answer, cited, issuedAt });
        return res.status(200).json({ status: true, data: { question, answer, cited, shareToken } });
    } catch (error) {
        if (aiSwitch.isAiOff(error)) return res.status(403).json({ status: false, code: aiSwitch.AI_OFF, statusText: error.message });
        logger.error(`chatAsk: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, statusText: 'Could not answer about this conversation.' });
    }
}

/** POST /api/v1/ai/chat-ask/post { projectId, sprintId, taskId, question, answer, cited, shareToken }: the asker's choice to share. */
async function chatAskPostHandler(req, res) {
    const companyId = companyOf(req);
    if (!isId(companyId)) return res.status(400).json({ status: false, statusText: 'companyId header required' });
    const thread = threadFrom(req.body);
    const question = questionIn(req.body);
    const answer = String((req.body && req.body.answer) || '');
    const cited = Array.isArray(req.body && req.body.cited) ? req.body.cited : [];
    if (!thread || !question || !answer || answer.length > ANSWER_MAX) {
        return res.status(400).json({ status: false, statusText: 'The conversation, question and answer are required.' });
    }

    try {
        const fields = { companyId, uid: String(req.uid || ''), thread, question, answer, cited };
        if (!shareTokenValid(req.body.shareToken, fields)) {
            return res.status(403).json({ status: false, code: 'share_refused', statusText: 'Ask again to post an answer here.' });
        }
        const access = await canPostToThread(companyId, req.uid, thread);
        if (!access.allowed) return refuseThread(res, access);
        const saved = await aiMention.postAnswer(companyId, {
            chat: true,
            thread,
            askerId: req.uid,
            answer,
            cited: citedKey(cited).map(([kind, id, ref, projectId]) => ({ kind, id, ref, projectId })),
            question: { userId: req.uid, message: aiMention.escapeStored(question) },
        });
        return res.status(200).json({ status: true, data: saved });
    } catch (error) {
        logger.error(`chatAsk post: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, statusText: 'Could not post the answer.' });
    }
}

module.exports = { chatAskHandler, chatAskPostHandler, _internal: { shareTokenFor, shareTokenValid } };
