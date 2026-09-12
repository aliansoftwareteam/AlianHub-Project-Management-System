/**
 * The tenant budget reservation: what a call is about to cost, held against
 * the workspace's month before the vendor request and settled after it.
 *
 * The spend ledger (`ai_usage`) is still the one record of what was spent.
 * This is not a second ledger: a reservation exists only while a call is in
 * flight, and the month's number the budget reads is the booked ledger plus
 * whatever is currently held. Without it, ten runs starting at once each read
 * the same "spent so far" and each decide it fits.
 *
 * **A crash between reserve and settle.** The row stays `held`, and a held row
 * that nobody will ever settle would block the budget for the rest of the
 * month. So every reservation carries `expiresAt` (AI_RESERVATION_TTL_MS from
 * its creation, comfortably longer than the slowest call): the sum below
 * counts unexpired holds only, so a stranded one stops holding budget as soon
 * as it expires, and the collection's TTL index deletes the row after that.
 * Two independent mechanisms, because the query is what protects the budget on
 * a cluster whose index has not finished building.
 *
 * The trade is deliberate: an expired hold on a call that is somehow still
 * running can let the month go slightly over, and money already spent is
 * always booked to the ledger by the meter. Over-holding forever is the worse
 * failure, because it refuses work nobody is doing.
 */
'use strict';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { routerEnabled } = require('./llmProvider/normalise');
const { RESERVATION } = require('./decision');

const LOG_PREFIX = '[ai-reservation]';
const BUDGET_EXHAUSTED = 'ai_budget_exhausted';
const DEFAULT_TTL_MS = 900000;

const money = (n) => Math.round(Number(n || 0) * 10000) / 10000;
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

const ttlMs = () => {
    const ms = Number(process.env.AI_RESERVATION_TTL_MS);
    return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TTL_MS;
};

const monthRange = (month) => {
    const from = new Date(`${month}-01T00:00:00.000Z`);
    return { from, to: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)) };
};

/**
 * USD held by calls in flight this month: unsettled, unexpired holds only.
 *
 * `upTo` is the tie-break that decides a race. Two calls that each fit alone
 * but not together would otherwise both see both holds and both back out, so a
 * call totals the holds up to and including its own row: the one that got its
 * row in first sees only itself and goes, the later one sees both and is
 * refused. Insertion order is the ObjectId's, which is what `_id` sorts by.
 */
async function heldUsd(companyId, month = monthKey(), { now = new Date(), upTo = null } = {}) {
    if (!companyId) return 0;
    const { from, to } = monthRange(month);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_RESERVATIONS,
        data: [[
            { $match: { state: RESERVATION.HELD, at: { $gte: from, $lt: to }, expiresAt: { $gt: now }, ...(upTo ? { _id: { $lte: upTo } } : {}) } },
            { $group: { _id: null, usd: { $sum: '$amountUsd' } } },
        ]],
    }, 'aggregate').catch((e) => {
        logger.error(`${LOG_PREFIX} ${companyId}: held total unavailable, treated as 0: ${e.message}`);
        return [];
    });
    return money((rows && rows[0] && rows[0].usd) || 0);
}

const settings = (companyId) => require('../Agents/budget').settings(companyId);
const booked = (companyId, month) => require('./spend').monthly(companyId, month);

const refusal = ({ estimate, usd, budgetUsd, usedUsd, held }) => ({
    ok: false,
    state: RESERVATION.REFUSED,
    code: BUDGET_EXHAUSTED,
    usd,
    budgetUsd,
    usedUsd,
    heldUsd: held,
    estimate,
    reason: `${BUDGET_EXHAUSTED}: this call is estimated at $${money(usd).toFixed(4)} and the workspace budget of $${budgetUsd} has $${money(budgetUsd - usedUsd - (held - usd)).toFixed(4)} left this month`,
});

const pass = (state) => ({ ok: true, state, usd: 0, id: null });

/**
 * Hold this call's estimated cost against the workspace's month.
 *
 * Insert first, then total: two calls racing each other both see the other's
 * hold and at most one of them fits, which is the point. The loser backs its
 * own hold out — the same read-back-after-write the per-run gate uses.
 *
 * @returns {Promise<{ok:boolean, state:string, usd:number, id:string|null, code?:string, reason?:string}>}
 */
async function reserve(context, estimate, provider) {
    if (!routerEnabled()) return pass(RESERVATION.OFF);
    if (!context.billedToWorkspace || !context.companyId) return pass(RESERVATION.UNBILLED);
    if (!estimate || !estimate.priced) return pass(RESERVATION.UNBILLED);

    const { monthlyBudgetUsd: budgetUsd } = await settings(context.companyId);
    if (!(budgetUsd > 0)) return pass(RESERVATION.NO_BUDGET);

    const usd = money(estimate.costUsd);
    const at = new Date();
    const month = monthKey(at);
    const row = await MongoDbCrudOpration(context.companyId, {
        type: SCHEMA_TYPE.AI_RESERVATIONS,
        data: {
            companyId: String(context.companyId), feature: context.feature, state: RESERVATION.HELD,
            amountUsd: usd, model: estimate.model || null, provider: provider || null,
            taskClass: estimate.taskClass || null,
            estimatedInputTokens: Number(estimate.inputTokens || 0), estimatedOutputTokens: Number(estimate.outputTokens || 0),
            actualInputTokens: null, actualOutputTokens: null, actualUsd: null,
            runId: context.runId, userId: context.userId,
            at, settledAt: null, expiresAt: new Date(at.getTime() + ttlMs()),
        },
    }, 'save');

    const id = row && row._id ? row._id : null;
    const ticket = { ok: true, state: RESERVATION.HELD, usd, id: id ? String(id) : null, estimate, companyId: String(context.companyId), month };
    const [spent, held] = await Promise.all([booked(context.companyId, month), heldUsd(context.companyId, month, { now: at, upTo: id })]);
    const usedUsd = money(spent.usedUsd);
    if (money(usedUsd + held) <= budgetUsd) return ticket;

    await close(ticket, RESERVATION.RELEASED);
    const refused = refusal({ estimate, usd, budgetUsd, usedUsd, held });
    logger.info(`${LOG_PREFIX} ${context.companyId}: ${context.feature} refused — ${refused.reason}`);
    return refused;
}

async function close(ticket, state, actual) {
    if (!ticket || !ticket.id) return;
    const set = { state, settledAt: new Date() };
    if (actual) {
        set.actualInputTokens = Number(actual.inputTokens || 0);
        set.actualOutputTokens = Number(actual.outputTokens || 0);
        set.actualUsd = actual.priced ? money(actual.costUsd) : null;
    }
    await MongoDbCrudOpration(ticket.companyId, {
        type: SCHEMA_TYPE.AI_RESERVATIONS, data: [{ _id: ticket.id, state: RESERVATION.HELD }, { $set: set }],
    }, 'updateOne').catch((e) => logger.error(`${LOG_PREFIX} ${ticket.companyId}: reservation ${ticket.id} not closed as ${state}: ${e.message}`));
}

/** The call happened: the hold stops counting and the real cost is the ledger's. */
const reconcile = (ticket, actual) => close(ticket, RESERVATION.SETTLED, actual);

/** The call did not happen: the hold stops counting and nothing was spent. */
const release = (ticket) => close(ticket, RESERVATION.RELEASED);

/**
 * Holds that expired without being settled — a process killed mid-call. They
 * already stopped holding budget when they expired; this is what a console or
 * a test asks to see them.
 */
async function stranded(companyId, now = new Date()) {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_RESERVATIONS, data: [{ state: RESERVATION.HELD, expiresAt: { $lte: now } }],
    }, 'find').catch(() => []);
    return rows || [];
}

module.exports = { reserve, reconcile, release, heldUsd, stranded, monthKey, ttlMs, BUDGET_EXHAUSTED, DEFAULT_TTL_MS };
