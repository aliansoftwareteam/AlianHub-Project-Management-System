'use strict';

// Hours by source (handoff 27c). Pure — the caller does the loading.
//
// The four buckets are people, and agent runs split by the AI account they went
// through. `viaAccount` is an AI-account axis: it says which subscription paid
// for the model, so it exists on a run and cannot exist on a person's hours.
// Modules/Agents/actor.js and Modules/Tasks/helpers/completion.js both hard-set
// a human actor to 'workspace' for exactly that reason. People are therefore one
// bucket here, and splitting them further would be a number nothing recorded.

const VIA_ACCOUNTS = Object.freeze(['workspace', 'personal', 'local']);
const AGENT_ACTOR = 'agent';

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

const via = (value) => (VIA_ACCOUNTS.includes(value) ? value : 'workspace');

/* Timesheet rows store LogTimeDuration in minutes. Agent-written rows carry
 * actorType 'agent' (Modules/Agents/actions.js); everything else is a person. */
function humanHoursFromEntries(entries) {
    const rows = Array.isArray(entries) ? entries : [];
    const minutes = rows.reduce((sum, row) => {
        if (!row || row.actorType === AGENT_ACTOR) return sum;
        const value = Number(row.LogTimeDuration);
        return Number.isFinite(value) && value > 0 ? sum + value : sum;
    }, 0);
    return round(minutes / 60);
}

function agentHoursFromRuns(runs) {
    const out = { workspace: 0, personal: 0, local: 0 };
    (Array.isArray(runs) ? runs : []).forEach((run) => {
        if (!run) return;
        const ms = Number(run.elapsedMs);
        if (!Number.isFinite(ms) || ms <= 0) return;
        out[via(run.viaAccount)] += ms / 3600000;
    });
    VIA_ACCOUNTS.forEach((key) => { out[key] = round(out[key]); });
    return out;
}

/**
 * Segments for the stacked bar: people first, then each agent account that has
 * hours. Empty buckets are dropped so the legend never carries a 0h entry, and
 * an empty result means there is nothing to chart at all.
 *
 * @returns {{segments: Array<{key:string, hours:number, pct:number}>, total:number}}
 */
function buildHoursBySource({ peopleHours = 0, runs = [], agentHours = null } = {}) {
    const people = round(peopleHours);
    const agents = agentHours || agentHoursFromRuns(runs);
    const rows = [
        { key: 'people', hours: people },
        ...VIA_ACCOUNTS.map((key) => ({ key: `agent-${key}`, hours: round(agents[key]) })),
    ].filter((row) => row.hours > 0);

    const total = round(rows.reduce((sum, row) => sum + row.hours, 0));
    if (!total) return { segments: [], total: 0 };
    return {
        segments: rows.map((row) => ({ ...row, pct: round((row.hours / total) * 100) })),
        total,
    };
}

module.exports = { VIA_ACCOUNTS, humanHoursFromEntries, agentHoursFromRuns, buildHoursBySource };
