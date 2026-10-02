const plans = require('./projectSetup');
const projects = require('./projectCreate');
const planFiling = require('./planFiling');

// The parts of a plan a person keeps when they approve it. A choice names parts of the stored plan by their place in
// it ("lists": [0, 2]), so it can take parts out and never put one in or reword one: whatever it names that the
// stored plan does not hold is refused, and a kind of part it does not name is not made at all. A part that cannot
// be made without one that is left out is refused with both named, so nothing is made by halves. The plan is read
// in the shape it is kept in (./planFiling.js), as its card and its executor read it.

const PLANS = Object.freeze({ 'project.setup': { mayBeEmpty: false }, [projects.ACTION]: { mayBeEmpty: true } });
const NOUN = Object.freeze({ statuses: 'status', lists: 'list', fields: 'field', views: 'view', rules: 'automation', tasks: 'task' });
const REFUSED = Object.freeze({
    shape: 'The chosen parts must name, for each change, the parts of its plan to keep.',
    both: 'Send the chosen parts or edited changes, not both.',
    change: 'The chosen parts name a change this proposal does not have.',
    whole: 'Only the parts of a setup plan can be chosen; this change is approved or declined whole.',
    nothing: 'Keep at least one part of the plan, or decline it.',
});

const listOf = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const lower = (value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase();
const keyOf = (part, at) => `${part}:${at}`;
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

const itemsOf = (params, part) => listOf(params && params[plans.PLAN_KEY[part]]);
const nameOf = (params, part, at) => {
    const item = itemsOf(params, part)[at];
    return typeof item === 'string' ? item : String((item && item.name) || '');
};
const placeOf = (params, part, name) => itemsOf(params, part).findIndex((item) => lower(typeof item === 'string' ? item : item && item.name) === lower(name));

/* What each part of a plan cannot be made without, by key: a view the fields of the plan it shows, a rollup the
 * field it reads, and what the automations and first tasks of a plan name (./planWork.js). */
const needsOf = (params) => {
    const needs = {};
    const add = (key, part, name) => {
        const at = name ? placeOf(params, part, name) : -1;
        if (at >= 0 && keyOf(part, at) !== key) needs[key] = [...new Set([...(needs[key] || []), keyOf(part, at)])];
    };
    itemsOf(params, 'fields').forEach((field, at) => add(keyOf('fields', at), 'fields', field && field.source));
    itemsOf(params, 'views').forEach((view, at) => listOf(view && view.showFields).forEach((name) => add(keyOf('views', at), 'fields', name)));
    require('./planWork').needsIn(params, add);
    return needs;
};

const labelOf = (params, key) => {
    const [part, at] = key.split(':');
    const name = nameOf(params, part, Number(at));
    return name ? `${NOUN[part]} "${name}"` : `${NOUN[part]} number ${Number(at) + 1}`;
};

const partsIn = (params) => plans.ALL_PARTS.filter((part) => itemsOf(params, part).length > 0);
const keysIn = (params) => partsIn(params).flatMap((part) => itemsOf(params, part).map((item, at) => keyOf(part, at)));

/* The plan with only the parts `keys` name, each kind in the order the plan holds it; a kind none of them names is gone. */
const keep = (params, keys) => {
    const kept = { ...params };
    for (const part of partsIn(params)) {
        const items = itemsOf(params, part).filter((item, at) => keys.includes(keyOf(part, at)));
        if (items.length) kept[plans.PLAN_KEY[part]] = items;
        else delete kept[plans.PLAN_KEY[part]];
    }
    return kept;
};

/* `keys`, and with them every part of the plan that cannot be made without one of them. */
const withDependents = (params, keys) => {
    const needs = needsOf(params);
    const out = new Set(keys);
    const pull = () => keysIn(params).find((key) => !out.has(key) && (needs[key] || []).some((needed) => out.has(needed)));
    for (let key = pull(); key; key = pull()) out.add(key);
    return keysIn(params).filter((key) => out.has(key));
};

/* The places of one kind of part to keep, or why the choice is not one of this plan. */
const placesOf = (params, part, chosen) => {
    if (!plans.ALL_PARTS.includes(part)) return { error: `This plan has no part called "${part}".` };
    const held = itemsOf(params, part).length;
    if (!held) return { error: `This plan has no ${part} to choose from.` };
    const valid = Array.isArray(chosen) && chosen.every((at) => Number.isInteger(at) && at >= 0 && at < held) && new Set(chosen).size === chosen.length;
    return valid ? { places: [...chosen].sort((a, b) => a - b) } : { error: `The chosen ${part} do not match this plan. Reload the page and choose again.` };
};

const unmet = (params, kept) => {
    const needs = needsOf(params);
    for (const key of kept) {
        const missing = (needs[key] || []).find((needed) => !kept.includes(needed));
        if (missing) return `The ${labelOf(params, key)} needs the ${labelOf(params, missing)}, which is left out. Keep both, or leave both out.`;
    }
    return '';
};

const narrowOne = (change, chosen) => {
    if (!isRecord(chosen)) return { error: REFUSED.shape };
    const plan = Object.hasOwn(PLANS, change.action) ? PLANS[change.action] : null;
    if (!plan) return { error: REFUSED.whole };
    const params = planFiling.storedParams(change.action, change.params);
    const places = {};
    for (const [part, list] of Object.entries(chosen)) {
        const read = placesOf(params, part, list);
        if (read.error) return read;
        places[part] = read.places;
    }
    const kept = partsIn(params).flatMap((part) => (places[part] || []).map((at) => keyOf(part, at)));
    if (!kept.length && !plan.mayBeEmpty) return { error: REFUSED.nothing };
    const problem = unmet(params, kept);
    if (problem) return { error: problem };
    return { change: { ...change, params: keep(params, kept) }, leftOut: keysIn(params).length - kept.length, kept };
};

const given = (choice) => choice !== undefined && choice !== null;

/* The changes of a proposal with each plan kept to its chosen parts, how many parts that left out, and for each
 * change the choice names the parts it kept, by their place in the stored plan; or why the choice cannot be followed. */
const narrow = (stored, choice) => {
    if (!isRecord(choice)) return { error: REFUSED.shape };
    const changes = listOf(stored).map(plain);
    const keptKeys = {};
    let leftOut = 0;
    for (const [index, chosen] of Object.entries(choice)) {
        const at = /^\d+$/.test(index) ? Number(index) : -1;
        if (at < 0 || at >= changes.length) return { error: REFUSED.change };
        const read = narrowOne(changes[at], chosen);
        if (read.error) return read;
        changes[at] = read.change;
        keptKeys[at] = read.kept;
        leftOut += read.leftOut;
    }
    return { changes, leftOut, keptKeys };
};

const isPlan = (action) => Object.hasOwn(PLANS, String(action));
const mayBeEmpty = (action) => isPlan(action) && PLANS[String(action)].mayBeEmpty;

module.exports = { given, narrow, needsOf, keyOf, keysIn, keep, withDependents, isPlan, mayBeEmpty, REFUSED };
