const mongoose = require('mongoose');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const logger = require('../../Config/loggerConfig');
const { getProvider, isAnyProviderConfigured } = require('../AICore/llmProvider');
const { FEATURES } = require('../AICore/features');
const { keepStreamOpen } = require('../Agents/engine/timeouts');
const {
    gather, promptFor, tokenProjectIdsOf, aboutOf, SYSTEM, RESEARCH_SYSTEM, MAX_PER_TYPE, ASK_TOKENS, RESEARCH_TOKENS,
} = require('./ask');
const threads = require('./askThreads');
const askContext = require('./askContext');

const FOLLOW_UP = `
- Earlier turns of this conversation come before the QUESTION. Use them to understand what the
  QUESTION refers to, and answer it from the SOURCES sent with it: they are gathered again for every
  question, so a source an earlier answer used may be gone.`;

const EMPTY = 'Nothing in the projects you can open matches that. Try naming the project or the task.';

const piecesOf = (text) => {
    const words = String(text).match(/\S+\s*/g) || [];
    const pieces = [];
    for (let i = 0; i < words.length; i += 4) pieces.push(words.slice(i, i + 4).join(''));
    return pieces;
};

const openStream = (req, res) => {
    keepStreamOpen(req);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    const stream = { open: true };
    res.on('close', () => { stream.open = false; });
    stream.send = (payload) => {
        if (stream.open) res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    return stream;
};

/* POST /api/v1/ai/ask/stream  body: { question, mode?, projectId?, threadId?, context?: [{ kind, id }], skill? }
 * Refusals and answers that need no model come back as JSON, as /ask sends them. A model answer comes
 * as server-sent events: `token` pieces, then one `done` with the citations, model and turn, or one
 * `error`. A turn is stored only when the answer finished and the asker was still there. */
const askStream = async (req, res) => {
    try {
        const caller = threads.callerOf(req, res);
        if (!caller) return undefined;
        const { companyId, uid } = caller;
        const { question, mode, projectId, threadId, context } = req.body || {};
        const asked = String(question || '').trim();
        if (!asked) return res.send({ status: false, statusText: 'Ask a question first.', code: 'question_required' });

        let thread = null;
        if (threadId) {
            thread = await threads.findThread(companyId, uid, threadId);
            if (!thread) return res.status(404).send({ status: false, statusText: 'That thread does not exist, or it is not yours.', code: 'thread_not_found' });
        }

        const research = mode === 'research';
        const modeName = research ? 'research' : 'ask';
        const gatherFor = (text) => gather(companyId, uid, {
            question: text,
            projectId: projectId || askContext.pinnedProjectId(context),
            limit: research ? MAX_PER_TYPE * 2 : MAX_PER_TYPE,
            tokenProjectIds: tokenProjectIdsOf(req),
        });
        // The follow-up is read on its own first, so its filter is its own; a bare "who owns it" borrows the words
        // of the question before it.
        const previous = threads.lastQuestionOf(thread);
        let gathered = await gatherFor(asked);
        if (!gathered.sources.length && previous) gathered = await gatherFor(`${asked} ${previous}`);
        const explicit = await askContext.pin(companyId, uid, gathered, req.body || {});
        gathered = explicit.gathered;
        const roleType = await getRoleType(companyId, uid).catch(() => null);
        const scope = { projects: gathered.projects.length, privileged: isPrivileged(roleType) };
        const threadIdOut = thread ? String(thread._id) : '';
        const found = gathered.intent ? { intent: gathered.intent } : {};

        if (!isAnyProviderConfigured()) {
            return res.send({ status: true, statusText: 'No model configured.', data: { configured: false, answer: '', sources: gathered.sources, scope, mode: modeName, threadId: threadIdOut, ...found } });
        }
        if (!gathered.sources.length) {
            return res.send({ status: true, data: { configured: true, answer: '', sources: [], mode: modeName, empty: EMPTY, emptyCode: 'no_match', scope, threadId: threadIdOut, ...found } });
        }

        const about = await aboutOf(req, companyId, uid);
        const stream = openStream(req, res);
        let streamed = false;
        try {
            const result = await getProvider().chat({
                systemPrompt: `${research ? RESEARCH_SYSTEM : SYSTEM}${thread ? FOLLOW_UP : ''}${explicit.system}`,
                messages: [...threads.historyOf(thread), { role: 'user', content: promptFor(asked, gathered.sources, gathered.intent, about) }],
                maxTokens: research ? RESEARCH_TOKENS : ASK_TOKENS,
                temperature: 0.2,
                spend: { feature: FEATURES.ASK, companyId, userId: uid },
                onText: (text) => {
                    if (!text) return;
                    streamed = true;
                    stream.send({ event: 'token', text });
                },
            });
            if (!stream.open) return undefined;
            const answer = String(result.content || '').trim();
            if (!streamed) piecesOf(answer).forEach((text) => stream.send({ event: 'token', text }));
            const cited = gathered.sources.filter((s) => answer.includes(`[${s.ref}]`));
            const turn = {
                turnId: new mongoose.Types.ObjectId().toString(),
                question: asked,
                answer,
                mode: modeName,
                model: result.model || '',
                cited: cited.map((s) => ({ kind: s.kind, sourceId: String(s.id), ref: s.ref || '' })),
                createdAt: new Date(),
            };
            const savedId = answer ? await threads.appendTurn(companyId, uid, thread, turn) : threadIdOut;
            stream.send({
                event: 'done',
                configured: true,
                mode: modeName,
                threadId: savedId,
                turnId: answer ? turn.turnId : '',
                answer,
                cited,
                sources: gathered.sources,
                scope,
                usage: { tokens: result.totalTokens, model: result.model },
                ...found,
            });
        } catch (error) {
            logger.error(`ai ask stream: ${error.message}`);
            stream.send({ event: 'error', statusText: error.message, code: typeof error.code === 'string' && error.code ? error.code : 'ask_failed' });
        } finally {
            if (stream.open) res.end();
        }
        return undefined;
    } catch (error) {
        logger.error(`ai ask stream: ${error.message}`);
        if (res.headersSent) return res.end();
        return res.send({ status: false, statusText: error.message });
    }
};

module.exports = { askStream };
