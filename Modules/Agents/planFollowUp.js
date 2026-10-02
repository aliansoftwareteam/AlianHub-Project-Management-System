const registry = require('./registry');
const plans = require('./projectSetup');
const planChoice = require('./planChoice');
const planFiling = require('./planFiling');
const planLocks = require('./planLocks');
const planShown = require('./planShown');

// What the approval of a plan leaves to be made later. Each is a plan of its own for the project, which waits for
// a person like any other and holds only parts that were not made, so nothing is made twice:
//   - the parts the approver may not approve (./planLocks.js), with the parts that cannot be made without them and
//     the parts they cannot be made without, wait for someone who may;
//   - the parts that were tried and not made, where trying again may change that, can be tried once more by the
//     same approver: a plan that is itself a second try leaves none.
// A part the plan cannot make for anyone, and a part that failed for a reason that stands, is in neither. A plan
// left this way stands on its own: what it names of the first plan that is already made, it names as the project has it.

const SETUP = 'project.setup';
const WHY_MAX = 300;

const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const lower = (value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase();
const { keyOf, keysIn } = planChoice;
const itemsOf = (params, part) => listOf(params[plans.PLAN_KEY[part]]);

/* The parts that stay waiting when `kept` are made and `locked` may not be: the locked ones, whatever was left out
 * that needs one of them, and whatever was left out that one of them needs. `never` are never among them. */
const waitingKeys = (params, kept, locked, never = []) => {
    const needs = planChoice.needsOf(params);
    const free = (key) => !kept.includes(key) && !never.includes(key);
    const waiting = new Set(locked.filter(free));
    const joins = (key) => (needs[key] || []).some((needed) => waiting.has(needed)) || [...waiting].some((held) => (needs[held] || []).includes(key));
    const next = () => keysIn(params).find((key) => free(key) && !waiting.has(key) && joins(key));
    for (let key = next(); key; key = next()) waiting.add(key);
    return keysIn(params).filter((key) => waiting.has(key));
};

/* For each change the approver chose parts of (`keptKeys`, by the change's place): the parts of its stored plan
 * that stay waiting, as the plan they make; a change that leaves none is left out. */
const heldBack = async (companyId, person, proposal, keptKeys) => {
    const held = [];
    for (const [at, kept] of Object.entries(keptKeys || {})) {
        const change = listOf(proposal.changes)[Number(at)];
        const locks = await planLocks.locksIn(companyId, person, change, proposal);
        const locked = planLocks.keysLocked(locks, planLocks.RIGHTS);
        if (!locked.length) continue;
        const params = planFiling.storedParams(change.action, change.params);
        const never = [...planLocks.neverMadeIn(params, locks), ...planShown.blankIn(change.action, params)];
        const waiting = waitingKeys(params, kept, locked, never);
        if (waiting.length) held.push({ at: Number(at), params: planChoice.keep(params, waiting) });
    }
    return held;
};

const partsOf = (outcome) => listOf(outcome && (outcome.ok ? outcome.result && outcome.result.parts : outcome.parts));

/* The parts of a plan that were tried and not made where trying again may change that (./projectSetup.js
 * mayPassLater), each with why it was not made, by their place in the plan as it was run. */
const failedIn = (outcome, params) => {
    const failed = [];
    const note = (part, at, error) => { if (at < itemsOf(params, part).length) failed.push({ key: keyOf(part, at), error: String(error) }); };
    for (const made of partsOf(outcome)) {
        if (!made || !plans.ALL_PARTS.includes(made.part)) continue;
        if (made.error) {
            if (made.tryAgain) itemsOf(params, made.part).forEach((item, at) => note(made.part, at, made.error));
        } else {
            listOf(made.items).forEach((item, at) => { if (item && item.error && item.tryAgain) note(made.part, at, item.error); });
        }
    }
    return failed;
};

const fieldsOf = (outcome) => listOf((partsOf(outcome).find((made) => made && made.part === 'fields') || {}).items).filter((item) => item && item.fieldId);

/* A view shows a field of its plan by the field's name. In a plan left without that field, the name becomes the
 * id of the field as the approval made it, or as the project already had it; a name with neither is dropped. */
const withFieldsAsMade = (params, outcome) => {
    const planned = listOf(params.definitions).map((field) => lower(objectOf(field).name));
    const made = fieldsOf(outcome);
    const idOf = (name) => String((made.find((field) => lower(field.name) === lower(name)) || {}).fieldId || '');
    const settled = (view) => {
        const named = listOf(objectOf(view).showFields);
        const gone = named.filter((name) => !planned.includes(lower(name)));
        if (!gone.length) return view;
        const ids = [...new Set([...listOf(objectOf(view.look).showFieldIds), ...gone.map(idOf).filter(Boolean)])];
        const stay = named.filter((name) => planned.includes(lower(name)));
        const rest = Object.fromEntries(Object.entries(view).filter(([key]) => key !== 'showFields'));
        return { ...rest, look: { ...objectOf(view.look), ...(ids.length ? { showFieldIds: ids } : {}) }, ...(stay.length ? { showFields: stay } : {}) };
    };
    return listOf(params.views).length ? { ...params, views: listOf(params.views).map(settled) } : params;
};

const partsOnly = (params) => Object.fromEntries(Object.values(plans.PLAN_KEY).filter((key) => listOf(params[key]).length).map((key) => [key, params[key]]));

/* The project a plan was for, once it has been run: its own, or the one a new project's plan has just made. */
const projectOf = (change, outcome) => (change.action === SETUP
    ? String((change.params && change.params.projectId) || '')
    : String((outcome && outcome.ok && outcome.result && outcome.result.projectId) || ''));

const setupOf = (change, projectId, params, outcome) => {
    const entry = registry.get(SETUP) || {};
    const own = change.action === SETUP;
    return {
        action: SETUP, params: { projectId, ...partsOnly(withFieldsAsMade(params, outcome)) },
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
        if (waiting) left.waiting.push({ projectId, change: setupOf(listOf(stored)[at] || change, projectId, waiting.params, outcome) });
        const params = planFiling.storedParams(change.action, change.params);
        const failed = secondTry ? [] : failedIn(outcome, params);
        if (failed.length) {
            left.retry.push({ projectId, why: failed[0].error.slice(0, WHY_MAX), change: setupOf(change, projectId, planChoice.keep(params, failed.map((entry) => entry.key)), outcome) });
        }
    });
    return left;
};

/* What the changes of an approval answered that they did not make, so the finished proposal can say it: the parts
 * of a plan, each with why, or a whole change. */
const notMadeBy = (changes, applied) => listOf(applied).flatMap((outcome, at) => {
    if (!outcome) return [];
    if (outcome.ok) return listOf(outcome.result && outcome.result.notMade);
    const change = listOf(changes)[at] || {};
    if (change.action === SETUP && partsOf(outcome).length) return plans.notMadeIn(partsOf(outcome), planFiling.storedParams(SETUP, change.params));
    return [{ part: '', name: String(change.label || change.action || ''), error: String(outcome.error || '') }];
}).map((entry) => ({ part: String(entry.part || ''), name: String(entry.name || ''), error: String(entry.error || '').slice(0, WHY_MAX) }));

module.exports = { heldBack, failedIn, leftBy, waitingKeys, notMadeBy };
