/**
 * Why this call landed on this model.
 *
 * One decision is built per `chat()` and travels on the chat options, so the
 * router (which knows who was skipped and how often it retried) and the spend
 * meter (which knows the task class, the estimate, the reservation and the real
 * usage) write into the same record. It ends up in two places: the attributes
 * of the model-call span, and the `decision` block of the replay row.
 *
 * It is built whether or not AI_MODEL_ROUTER is on, because with the flag off
 * there is exactly one candidate and recording that costs nothing — the same
 * bargain health.js already makes.
 */
'use strict';

/* Why a candidate did not answer. The first four are the router's; `unpriced`
 * is the meter's, and `pin_dropped` says the caller's pinned model could not
 * travel to this candidate because a model id belongs to one vendor. */
const SKIP = Object.freeze({
    BREAKER_OPEN: 'breaker_open',
    BREAKER_HALF_OPEN: 'breaker_half_open',
    RATE_LIMITED: 'rate_limited',
    UNPRICED: 'unpriced',
    PIN_DROPPED: 'pin_dropped',
});

const RESERVATION = Object.freeze({
    NONE: 'none', OFF: 'off', UNBILLED: 'unbilled', NO_BUDGET: 'no_budget',
    HELD: 'held', SETTLED: 'settled', RELEASED: 'released', REFUSED: 'refused',
});

const KEY = 'decision';
const MAX_SKIPPED = 12;

const nameOf = (value) => (value === undefined || value === null || value === '' ? null : String(value));
const round = (n) => Math.round(Number(n || 0) * 10000) / 10000;

function begin({ routerEnabled = false, provider = null, model = null } = {}) {
    const state = {
        routerEnabled: Boolean(routerEnabled),
        feature: null,
        taskClass: null,
        requested: { provider: nameOf(provider), model: nameOf(model), pinned: Boolean(model) },
        chosen: { provider: null, model: null },
        last: { provider: null, model: null },
        attempts: 0,
        retries: 0,
        skipped: [],
        estimate: null,
        actual: null,
        reservation: { state: RESERVATION.NONE, usd: 0, id: null },
    };

    const decision = {
        state,
        /* A candidate that was never asked, or asked and refused. Recorded once
         * per reason per candidate: a breaker skipped on every attempt of a
         * retry loop is one line, not five. */
        skip(provider_, model_, reason) {
            const row = { provider: nameOf(provider_), model: nameOf(model_), reason: nameOf(reason) || 'unknown' };
            const seen = state.skipped.some((s) => s.provider === row.provider && s.reason === row.reason);
            if (!seen && state.skipped.length < MAX_SKIPPED) state.skipped.push(row);
            return decision;
        },
        /* One vendor request about to be made. A second one on the provider
         * that just failed is a retry; one on the next provider is a failover. */
        attempt(provider_, model_) {
            state.attempts += 1;
            if (state.attempts > 1 && state.last.provider === nameOf(provider_)) state.retries += 1;
            state.last = { provider: nameOf(provider_), model: nameOf(model_) };
            return decision;
        },
        answered(provider_, model_) {
            state.chosen = { provider: nameOf(provider_), model: nameOf(model_) };
            return decision;
        },
        classified(feature, taskClass) {
            state.feature = nameOf(feature);
            state.taskClass = nameOf(taskClass);
            return decision;
        },
        estimated(estimate) {
            if (!estimate) return decision;
            state.estimate = {
                inputTokens: Number(estimate.inputTokens || 0),
                outputTokens: Number(estimate.outputTokens || 0),
                costUsd: estimate.priced ? round(estimate.costUsd) : null,
                priced: Boolean(estimate.priced),
                inputBudgetTokens: Number(estimate.inputBudgetTokens || 0) || null,
                overInputBudget: Boolean(estimate.overInputBudget),
            };
            if (estimate.taskClass) state.taskClass = nameOf(estimate.taskClass);
            return decision;
        },
        used(summary) {
            if (!summary) return decision;
            state.actual = {
                inputTokens: Number(summary.inputTokens || 0),
                outputTokens: Number(summary.outputTokens || 0),
                costUsd: summary.priced ? round(summary.costUsd) : null,
            };
            return decision;
        },
        reserved(ticket) {
            if (!ticket) return decision;
            state.reservation = { state: nameOf(ticket.state) || RESERVATION.NONE, usd: round(ticket.usd), id: nameOf(ticket.id) };
            return decision;
        },
        settled(stateName) {
            state.reservation = { ...state.reservation, state: nameOf(stateName) || state.reservation.state };
            return decision;
        },
        /* The stored shape: numbers and provider names only, so nothing here
         * needs redacting before it reaches a span or a replay row. */
        record() {
            const drift = state.estimate && state.actual ? {
                inputTokens: state.actual.inputTokens - state.estimate.inputTokens,
                outputTokens: state.actual.outputTokens - state.estimate.outputTokens,
                costUsd: state.estimate.costUsd === null || state.actual.costUsd === null ? null : round(state.actual.costUsd - state.estimate.costUsd),
            } : null;
            return {
                routerEnabled: state.routerEnabled,
                taskClass: state.taskClass,
                requested: { ...state.requested },
                chosen: { ...state.chosen },
                attempts: state.attempts,
                retries: state.retries,
                skipped: state.skipped.map((s) => ({ ...s })),
                estimate: state.estimate ? { ...state.estimate } : null,
                actual: state.actual ? { ...state.actual } : null,
                drift,
                reservation: { ...state.reservation },
            };
        },
        attributes() {
            const row = decision.record();
            return {
                'ai.routing.enabled': row.routerEnabled,
                'ai.routing.task_class': row.taskClass,
                'ai.routing.requested_model': row.requested.model,
                'ai.routing.pinned': row.requested.pinned,
                'ai.routing.provider': row.chosen.provider,
                'ai.routing.model': row.chosen.model,
                'ai.routing.attempts': row.attempts,
                'ai.routing.retries': row.retries,
                'ai.routing.skipped': row.skipped.map((s) => `${s.provider}:${s.reason}`).join(', ') || null,
                'ai.routing.estimated_input_tokens': row.estimate ? row.estimate.inputTokens : null,
                'ai.routing.estimated_output_tokens': row.estimate ? row.estimate.outputTokens : null,
                'ai.routing.estimated_cost_usd': row.estimate ? row.estimate.costUsd : null,
                'ai.routing.input_budget_tokens': row.estimate ? row.estimate.inputBudgetTokens : null,
                'ai.routing.input_over_budget': row.estimate ? row.estimate.overInputBudget : null,
                'ai.routing.actual_input_tokens': row.actual ? row.actual.inputTokens : null,
                'ai.routing.actual_output_tokens': row.actual ? row.actual.outputTokens : null,
                'ai.budget.reservation_state': row.reservation.state,
                'ai.budget.reservation_usd': row.reservation.usd,
            };
        },
    };
    return decision;
}

/** The decision on these chat options, created and attached on first sight. */
function attach(opts, seed) {
    if (opts && opts[KEY] && typeof opts[KEY].record === 'function') return opts[KEY];
    const decision = begin(seed);
    if (opts) opts[KEY] = decision;
    return decision;
}

const of = (opts) => (opts && opts[KEY] && typeof opts[KEY].record === 'function' ? opts[KEY] : null);

module.exports = { begin, attach, of, SKIP, RESERVATION, KEY };
