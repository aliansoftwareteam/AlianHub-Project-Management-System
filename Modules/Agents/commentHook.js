// Agents — reacting to an @mention in a comment.
//
// An agent answers when it is NAMED, and only then. Being attached to a task does
// not make it answer every comment there: most of what gets said on a task is
// people talking to each other, and an agent that replies to all of it — including
// mentions of other people — is noise that gets it switched off.
//
// (This did briefly follow every comment on an attached task. In practice it
// answered "@someone-else, look at this" and bare remarks with nothing to do with
// it, so being named is the trigger. Assignment still fires it once, via the
// separate `assigned` trigger in the assign endpoint.)
//
// The comment editor writes a mention as "[Display Name](id)" and the id is a
// 24-hex ObjectId whether it names a user or an agent, so the token format needed
// no change. This module tells them apart by looking the ids up, then hands back
// the ones that are people so they can be notified normally.
//
// It lives here rather than inside the Comments controller because comment save is
// a core write path. Everything here is best-effort and cannot throw into it — a
// failing agent must never cost someone their comment.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const llm = require('./llm');
const executor = require('./runner/executor');

const LOG_PREFIX = '[agents:comment]';

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

/** Strip mention tokens so the agent reads "@Name" rather than a raw id. */
const readable = (message) => String(message || '')
    .replace(/@?\[([^\]]*)\]\([0-9a-fA-F]{24}\)/g, '@$1')
    .trim();

/**
 * Handle a saved comment: run the agents it concerns, return the people to notify.
 *
 * Resolves { humanIds, agentIds } and never rejects. On any internal failure it
 * returns every id as human, which is the behaviour that existed before agents —
 * so the worst case is the old behaviour, never a lost notification.
 */
const handleTaskComment = async ({ companyId, comment, mentionIds }) => {
    const all = (mentionIds || []).map((x) => String(x));
    const fallback = { humanIds: all, agentIds: [] };
    if (!companyId || !comment) return fallback;

    try {
        // An agent's own comment never triggers anything. runner/tools.js already
        // writes an empty mentionIds so an agent cannot name anyone, but a comment
        // authored by an agent is the one input that could close a loop, so it is
        // refused here outright rather than relying on that.
        if (comment.agentId) return fallback;

        const taskId = comment.taskId && String(comment.taskId) !== 'default' ? String(comment.taskId) : '';

        // ── who is mentioned ───────────────────────────────────────────────
        const mentionedIds = all.map(oid).filter(Boolean);
        const mentioned = mentionedIds.length
            ? await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.AGENTS,
                data: [{ _id: { $in: mentionedIds }, deletedStatusKey: 0, enabled: true }],
            }, 'find')
            : [];

        // Kept out of the notification list even when they will not be run — an
        // agent id in the user pipeline means a mention record and a push for
        // somebody who does not exist.
        const mentionedAgentIds = (mentioned || []).map((a) => String(a._id));
        const humanIds = all.filter((x) => !mentionedAgentIds.includes(x));

        if (!taskId) {
            if (mentionedAgentIds.length) logger.info(`${LOG_PREFIX} agent mentioned outside a task; not run`);
            return { humanIds, agentIds: mentionedAgentIds };
        }

        // ── decide who runs ────────────────────────────────────────────────
        // Named agents only, and only those whose mention trigger is on.
        const toRun = (mentioned || []).filter((a) => {
            if ((a.triggers || []).some((t) => t && t.type === 'mention')) return true;
            logger.info(`${LOG_PREFIX} ${a.name} mentioned but has no mention trigger; not run`);
            return false;
        });

        const agentIds = mentionedAgentIds;
        if (!toRun.length) return { humanIds, agentIds };

        const model = llm.status();
        if (!model.ready) {
            logger.error(`${LOG_PREFIX} ${toRun.length} agent(s) to run but no model: ${model.reason}`);
            return { humanIds, agentIds };
        }

        // The comment itself is the instruction. Without this the agent only saw
        // the task and answered it in general, which is why repeating a request
        // produced the same reply every time.
        const instruction = readable(comment.message);

        // Sequential: two agents named in one comment both read the task and post to
        // it, and interleaving their writes makes the thread read out of order.
        for (const agent of toRun) {
            const outcome = await executor.runAgentOnTask({
                companyId,
                agent,
                taskId,
                triggeredBy: String(comment.userId || ''),
                triggerType: 'mention',
                instruction,
                depth: 0,
            });
            if (!outcome.ok) logger.error(`${LOG_PREFIX} ${agent.name} did not reply: ${outcome.message}`);
        }

        return { humanIds, agentIds };
    } catch (e) {
        logger.error(`${LOG_PREFIX} handling failed, treating every mention as human: ${e.message}`);
        return fallback;
    }
};

module.exports = { handleTaskComment, readable };
