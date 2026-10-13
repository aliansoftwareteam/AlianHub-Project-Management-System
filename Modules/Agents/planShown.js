const setup = require('./setupRequests');
const plans = require('./projectSetup');
const planWork = require('./planWork');
const planChoice = require('./planChoice');
const planFiling = require('./planFiling');

// Which parts of a stored plan its card has a line for (./intentPreview.js). A part with no name, or past what a
// card lists of its kind, is one nobody could have read: the card says how many there are and leaves them out, and
// an approval that keeps one is refused.

const NAME_MAX = 250;
const REFUSAL = Object.freeze({ error: 'A part of this plan has nothing to show, so it cannot be approved. Reload the page and approve the plan without it, or decline it.', status: 400 });

const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const textOf = (value, max) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '');
const { keyOf } = planChoice;

/* An automation always has a line: its sentence, or why it is not one that can be made. */
const LISTED = Object.freeze({
    statuses: { max: plans.STATUSES_MAX, shown: (name) => Boolean(textOf(name, plans.STATUS_NAME_MAX)) },
    lists: { max: plans.LISTS_MAX, shown: (name) => Boolean(textOf(name, NAME_MAX)) },
    fields: { max: setup.FIELDS_MAX, shown: (field) => Boolean(textOf(objectOf(field).name, setup.FIELD_NAME_MAX)) },
    views: { max: plans.VIEWS_MAX, shown: (view) => Boolean(textOf(objectOf(view).name, setup.VIEW_NAME_MAX)) },
    rules: { max: planWork.RULES_MAX, shown: () => true },
    tasks: { max: planWork.TASKS_MAX, shown: (task) => Boolean(planWork.taskOf(task).name) },
});

const isShown = (part, item, at) => at < LISTED[part].max && LISTED[part].shown(item);

/* The parts of a plan with nothing to show, each by its place in the stored plan. */
const blankIn = (action, given) => {
    if (!planChoice.isPlan(action)) return [];
    const params = planFiling.storedParams(action, given);
    return plans.ALL_PARTS.flatMap((part) => listOf(params[plans.PLAN_KEY[part]]).map((item, at) => (isShown(part, item, at) ? '' : keyOf(part, at))).filter(Boolean));
};

/* null where every part these changes keep can be shown; otherwise the refusal the approval answers. */
const approveRefusal = (changes) => (listOf(changes).some((change) => change && blankIn(change.action, change.params).length) ? { ...REFUSAL } : null);

module.exports = { REFUSAL, NAME_MAX, blankIn, approveRefusal };
