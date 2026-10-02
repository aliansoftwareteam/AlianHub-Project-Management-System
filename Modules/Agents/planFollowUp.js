const registry = require('./registry');
const permissions = require('./permissions');
const plans = require('./projectSetup');
const planChoice = require('./planChoice');
const planFiling = require('./planFiling');
const planLocks = require('./planLocks');
const planShown = require('./planShown');

// What the approval of a plan leaves to be made later. Each is a plan of its own for the project, which waits for
// a person like any other and holds only parts that were not made, so nothing is made twice:
//   - the parts the approver may not approve (./planLocks.js), with the parts that cannot be made without them and
//     the parts they cannot be made without, wait for someone who may;
//   - the parts that were tried and not made, for a reason other than who asked or who approved, can be tried once
//     more by the same approver: a plan that is itself a second try leaves none.

const SETUP = 'project.setup';
const WHY_MAX = 300;

const listOf = (value) => (Array.isArray(value) ? value : []);
const { keyOf, keysIn } = planChoice;
const itemsOf = (params, part) => listOf(params[plans.PLAN_KEY[part]]);

/* The parts that stay waiting when `kept` are made and `locked` may not be: the locked ones, whatever was left out
 * that needs one of them, and whatever was left out that one of them needs. */
const waitingKeys = (params, kept, locked) => {
    const needs = planChoice.needsOf(params);
    const waiting = new Set(locked.filter((key) => !kept.includes(key)));
    const joins = (key) => (needs[key] || []).some((needed) => waiting.has(needed)) || [...waiting].some((held) => (needs[held] || []).includes(key));
    const next = () => keysIn(params).find((key) => !kept.includes(key) && !waiting.has(key) && joins(key));
    for (let key = next(); key; key = next()) waiting.add(key);
    return keysIn(params).filter((key) => waiting.has(key));
};

/* For each change the approver chose parts of (`keptKeys`, by the change's place): the parts of its stored plan
 * that stay waiting, as the plan they make; a change that leaves none is left out. */
const heldBack = async (companyId, person, stored, keptKeys) => {
    const held = [];
    for (const [at, kept] of Object.entries(keptKeys || {})) {
        const change = listOf(stored)[Number(at)];
        const locked = await planLocks.lockedIn(companyId, person, change);
        if (!locked.length) continue;
        const params = planFiling.storedParams(change.action, change.params);
        const blank = planShown.blankIn(change.action, params);
        const waiting = waitingKeys(params, kept, locked).filter((key) => !blank.includes(key));
        if (waiting.length) held.push({ at: Number(at), params: planChoice.keep(params, waiting) });
    }
    return held;
};

const isRefused = (failure) => Boolean(failure.refused) || String(failure.error || '').startsWith(permissions.REASON);

/* The parts of a plan that were tried and not made for a reason that trying again may change, each with that
 * reason, by their place in the plan as it was run. */
const failedIn = (outcome, params) => {
    const failed = [];
    const note = (part, at, error) => { if (at < itemsOf(params, part).length) failed.push({ key: keyOf(part, at), error: String(error) }); };
    for (const made of listOf(outcome && (outcome.ok ? outcome.result && outcome.result.parts : outcome.parts))) {
        if (!made || !plans.ALL_PARTS.includes(made.part)) continue;
        if (made.error) {
            if (!isRefused(made)) itemsOf(params, made.part).forEach((item, at) => note(made.part, at, made.error));
        } else {
            listOf(made.items).forEach((item, at) => { if (item && item.error && !isRefused(item)) note(made.part, at, item.error); });
        }
    }
    return failed;
};

const partsOnly = (params) => Object.fromEntries(Object.values(plans.PLAN_KEY).filter((key) => listOf(params[key]).length).map((key) => [key, params[key]]));

/* The project a plan was for, once it has been run: its own, or the one a new project's plan has just made. */
const projectOf = (change, outcome) => (change.action === SETUP
    ? String((change.params && change.params.projectId) || '')
    : String((outcome && outcome.ok && outcome.result && outcome.result.projectId) || ''));

const setupOf = (change, projectId, params) => {
    const entry = registry.get(SETUP) || {};
    const own = change.action === SETUP;
    return {
        action: SETUP, params: { projectId, ...partsOnly(params) },
        label: (own && change.label) || entry.label || SETUP, rating: own ? change.rating || null : null,
    };
};

/* What is left of the changes of an approval once they have run: `waiting` for someone who may approve them, and
 * `retry` for the approver to try once more, each { projectId, change } and a retry with why it was not made.
 * `held` is what heldBack answered before anything ran; `secondTry` says the approval was itself a second try. */
const leftBy = ({ stored, changes, applied, held, secondTry }) => {
    const left = { waiting: [], retry: [] };
    listOf(changes).forEach((change, at) => {
        if (!change || !planChoice.isPlan(change.action)) return;
        const outcome = listOf(applied)[at];
        const projectId = projectOf(change, outcome);
        if (!projectId) return;
        const waiting = listOf(held).find((entry) => entry.at === at);
        if (waiting) left.waiting.push({ projectId, change: setupOf(listOf(stored)[at] || change, projectId, waiting.params) });
        const params = planFiling.storedParams(change.action, change.params);
        const failed = secondTry ? [] : failedIn(outcome, params);
        if (failed.length) {
            left.retry.push({ projectId, why: failed[0].error.slice(0, WHY_MAX), change: setupOf(change, projectId, planChoice.keep(params, failed.map((entry) => entry.key))) });
        }
    });
    return left;
};

module.exports = { heldBack, failedIn, leftBy, waitingKeys };
