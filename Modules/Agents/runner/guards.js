// Agents — the guards that stop a runaway.
//
// Three separate failure modes, three separate checks:
//
//   budget   an agent that keeps working through the night on someone's bill
//   depth    an agent whose own comment re-triggers it, forever
//   cooldown two agents ping-ponging on the same task, or one reacting to
//            every edit in a burst
//
// All three fail CLOSED: if a check cannot be evaluated, the run is refused. A
// guard that silently passes when the database is unreachable is not a guard.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');

const LOG_PREFIX = '[agents:guards]';

// An agent must never react to its own work. 0 = a human started this.
const MAX_DEPTH = 1;

// Two AUTOMATIC runs of the same agent on the same entity inside this window is
// almost always a loop or a burst of events, not two things worth answering.
const COOLDOWN_MS = Number(process.env.AGENT_COOLDOWN_MS) || 60 * 1000;

/**
 * Triggers that mean "a person just asked for this, now".
 *
 * The cooldown deliberately does NOT apply to these. It exists to stop an agent
 * reacting to its own work, or to a burst of automated events — not to ignore
 * someone who typed @agent a second time because the first answer was not what
 * they needed. Silently dropping an explicit request is the worst possible
 * outcome: no reply, no error, and nothing to look at.
 *
 * Cost is still bounded for these, by the daily budget below, and loops are still
 * prevented by the depth guard.
 */
const EXPLICIT_TRIGGERS = Object.freeze(['mention', 'manual', 'test', 'assigned']);

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

/**
 * May this agent run right now? Resolves { ok } or { ok:false, reason, code }.
 *
 * `code` is machine-readable so the caller can distinguish "over budget" (tell
 * the user) from "cooldown" (stay quiet — it is working as intended).
 */
const check = async ({ companyId, agent, entityId, depth = 0, triggerType = '' }) => {
    // ── depth ──────────────────────────────────────────────────────────────
    if (Number(depth) > MAX_DEPTH) {
        return { ok: false, code: 'depth', reason: 'Stopped to avoid an agent reacting to its own work.' };
    }

    const agentObjId = oid(agent._id);
    if (!agentObjId) return { ok: false, code: 'invalid', reason: 'That agent id is not valid.' };

    try {
        // ── daily budget ───────────────────────────────────────────────────
        const limit = Number((agent.limits || {}).runsPerDay) || 50;
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);

        const todaysRuns = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: [{
                agentId: agentObjId,
                startedAt: { $gte: dayStart },
                // A refusal is not a run — don't let cooldowns eat the budget.
                status: { $nin: ['skipped'] },
            }],
        }, 'countDocuments');

        if (Number(todaysRuns) >= limit) {
            return {
                ok: false,
                code: 'budget',
                reason: `This agent has reached its limit of ${limit} runs today. It will resume tomorrow, or raise the limit in its settings.`,
            };
        }

        // ── cooldown (automatic triggers only) ─────────────────────────────
        // An explicit request is never rate-limited away. Asking twice on purpose
        // is a normal thing to do, and the answer can legitimately differ — the
        // task may have changed between the two asks.
        if (entityId && !EXPLICIT_TRIGGERS.includes(String(triggerType))) {
            const since = new Date(Date.now() - COOLDOWN_MS);
            const recent = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.AGENT_RUNS,
                data: [{
                    agentId: agentObjId,
                    entityId: String(entityId),
                    startedAt: { $gte: since },
                    status: { $nin: ['skipped'] },
                }],
            }, 'countDocuments');
            if (Number(recent) > 0) {
                return {
                    ok: false,
                    code: 'cooldown',
                    reason: `Already ran on this item in the last ${Math.round(COOLDOWN_MS / 1000)} seconds.`,
                };
            }
        }

        return { ok: true, runsToday: Number(todaysRuns), limit };
    } catch (e) {
        // Fail closed. An unreadable run log means we cannot prove the agent is
        // under budget, and "probably fine" is not good enough for something that
        // spends money and writes to the workspace.
        logger.error(`${LOG_PREFIX} check failed for agent ${agent._id}: ${e.message}`);
        return { ok: false, code: 'error', reason: 'Could not verify this agent\'s limits, so it did not run.' };
    }
};

module.exports = { check, MAX_DEPTH, COOLDOWN_MS, EXPLICIT_TRIGGERS };
