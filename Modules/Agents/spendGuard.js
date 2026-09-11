const logger = require('../../Config/loggerConfig');
const usage = require('../AICore/usage');
const runs = require('./runs');
const budget = require('./budget');
const agentAudit = require('./agentAudit');

// The pre-call spend gate for one run. Every model call is priced from an
// estimate first and refused before the vendor request when it does not fit
// the run's cap or the company's month; the post-call check in the graph
// remains, booking the real cost and catching an under-estimate.
//
// The hold is an atomic $inc on the run row: two calls in flight in one run
// each add their estimate and read the total back, so the second sees the
// first's hold and backs out rather than both fitting the same remainder.

const REASON = 'spend_cap_exceeded';
const ACTION = 'model.call';
const money = (n) => Math.round(Number(n || 0) * 10000) / 10000;
const dollars = (n) => `$${money(n).toFixed(4)}`;

const billed = (run) => run.viaAccount !== 'personal' && run.viaAccount !== 'local';

const hold = (companyId, runId, usd) => runs.patch(companyId, runId, {}, { $inc: { reservedUsd: money(usd) } });

const refusal = ({ estimate, cap, limit, remaining }) => {
    const reason = `${REASON}: the next call is estimated at ${dollars(estimate.costUsd)} (${estimate.totalTokens} tokens) but the ${cap} cap of ${dollars(limit)} has ${dollars(remaining)} left`;
    return { ok: false, code: REASON, reason, cap, limit: money(limit), remaining: money(remaining), estimate };
};

const forRun = ({ companyId, run, actor }) => {
    const runId = run._id;
    const cap = Number(run.spendCapUsd) > 0 ? Number(run.spendCapUsd) : 0;

    const exceeded = async (held, usd) => {
        const spent = money(held.spend && held.spend.usd);
        const others = money(Number(held.reservedUsd || 0) - usd);
        if (cap && money(spent + others + usd) > cap) return { cap: 'run', limit: cap, remaining: cap - spent - others };
        const month = await budget.headroom(companyId);
        if (month.budgetUsd > 0 && money(month.usedUsd + month.reservedUsd) > month.budgetUsd) {
            return { cap: 'company', limit: month.budgetUsd, remaining: month.budgetUsd - month.usedUsd - (month.reservedUsd - usd) };
        }
        return null;
    };

    const audit = (ticket) => agentAudit.recordRefusal(companyId, actor || { kind: 'agent', agentId: run.agentId, agentName: run.agentName, runId: String(runId), viaAccount: run.viaAccount }, {
        action: ACTION, reason: ticket.reason, entityType: 'agent_run', entityId: runId,
        params: { runId: String(runId), cap: ticket.cap, limitUsd: ticket.limit, remainingUsd: ticket.remaining, estimatedUsd: money(ticket.estimate.costUsd), estimatedTokens: ticket.estimate.totalTokens, model: ticket.estimate.model },
    });

    return {
        async reserve(estimate) {
            if (!billed(run)) return { ok: true, usd: 0, estimate };
            if (!estimate.priced) {
                const reason = usage.unpricedMessage(estimate.model);
                const ticket = { ok: false, code: usage.UNPRICED_MODEL, reason, cap: 'run', limit: cap, remaining: cap, estimate };
                await audit(ticket);
                return ticket;
            }
            const usd = money(estimate.costUsd);
            const held = await hold(companyId, runId, usd);
            if (!held) return { ok: false, code: 'run_missing', reason: 'the run no longer exists', estimate };
            const over = await exceeded(held, usd);
            if (!over) return { ok: true, usd, estimate };
            await hold(companyId, runId, -usd);
            const ticket = refusal({ estimate, ...over });
            logger.info(`[agent-run] ${runId}: ${ticket.reason}`);
            await audit(ticket);
            return ticket;
        },
        async reconcile(ticket, tally, model) {
            if (!ticket.usd) return;
            const actual = usage.summarize(tally || {}, model || ticket.estimate.model);
            const inc = { reservedUsd: -ticket.usd, 'spend.usd': actual.priced ? money(actual.costUsd) : 0, 'spend.tokens': actual.totalTokens };
            await runs.patch(companyId, runId, {}, { $inc: inc });
        },
        async release(ticket) {
            if (!ticket.usd) return;
            await hold(companyId, runId, -ticket.usd);
        },
    };
};

module.exports = { forRun, REASON, ACTION };
