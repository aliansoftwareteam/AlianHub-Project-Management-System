/**
 * Pure, framework-free rules for the Free Resources dashboard card.
 *
 * Extracted from FreeResourcesCard.vue so the tricky bits — the person-level
 * Assignee filter and the free/busy threshold — can be unit-tested (see
 * tests/free-resource-rules.test.js) without a DOM or the Vue runtime.
 *
 * CommonJS (like config/env.js) so both the Vue build and the Node/Jest
 * suite can consume it.
 *
 * Why the Assignee filter is handled HERE and not as a task filter: the card
 * classifies each *person* as free/busy from their real workload. Sending an
 * "Assignee Is Not X" row to the task query would strip X's tasks from every
 * co-assignee's tally, dropping busy people under the threshold so they'd
 * wrongly appear "free". Instead we treat the Assignee filter as an
 * include/exclude over the resulting user list and leave the workload numbers
 * untouched.
 */

const ASSIGNEE_FIELD = 'AssigneeUserId';
const NOT_OP = ':!=';

/**
 * Split the advanced filter rows into the Assignee (person) rows and the rest.
 * @param {Array} rows filter rows ({ name:{value}, comparison:{value}, values })
 * @returns {{ assigneeRows: Array, taskRows: Array }}
 */
function splitAssigneeRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const assigneeRows = [];
    const taskRows = [];
    list.forEach((r) => {
        if (r && r.name && r.name.value === ASSIGNEE_FIELD) assigneeRows.push(r);
        else taskRows.push(r);
    });
    return { assigneeRows, taskRows };
}

/**
 * Build the include/exclude user-id sets from the Assignee filter rows.
 * "Is Not" (`:!=`) rows exclude; any other operator (`:` / `:=`) includes.
 * @param {Array} rows all filter rows
 * @param {(ids:string[]) => string[]} resolveTeamIds expands team ids → user ids
 *        (pass a wrapper around commonFunction.teamIdToUserId; identity is fine
 *        when there are no teams)
 * @returns {{ include:Set<string>, exclude:Set<string>, hasInclude:boolean }}
 */
function resolveAssigneeFilter(rows, resolveTeamIds) {
    const resolve = typeof resolveTeamIds === 'function' ? resolveTeamIds : (x) => x;
    const include = new Set();
    const exclude = new Set();
    const { assigneeRows } = splitAssigneeRows(rows);
    assigneeRows.forEach((r) => {
        const ids = (resolve(r.values || []) || []).map(String);
        const target = r.comparison && r.comparison.value === NOT_OP ? exclude : include;
        ids.forEach((id) => target.add(id));
    });
    return { include, exclude, hasInclude: include.size > 0 };
}

/**
 * Does this user survive the person-level Assignee filter?
 * Excluded users are always dropped; when an include list exists, only listed
 * users pass.
 * @param {string} userId
 * @param {{include:Set<string>, exclude:Set<string>, hasInclude:boolean}} filter
 * @returns {boolean}
 */
function passesAssigneeFilter(userId, filter) {
    if (!filter) return true;
    const id = String(userId);
    if (filter.exclude && filter.exclude.has(id)) return false;
    if (filter.hasInclude && !(filter.include && filter.include.has(id))) return false;
    return true;
}

/**
 * Free/busy predicate — a user is FREE only when BOTH planned and logged sit
 * at/under their thresholds. Judged on the user's REAL workload so a busy user
 * can never slip through.
 * @param {number} plannedMinutes
 * @param {number} loggedMinutes
 * @param {number} plannedThresholdMin free when planned is strictly UNDER this
 * @param {number} loggedThresholdMin  free when logged is AT OR UNDER this
 * @returns {boolean}
 */
function isFree(plannedMinutes, loggedMinutes, plannedThresholdMin, loggedThresholdMin) {
    const planned = Number(plannedMinutes) || 0;
    const logged = Number(loggedMinutes) || 0;
    return planned < plannedThresholdMin && logged <= loggedThresholdMin;
}

module.exports = {
    ASSIGNEE_FIELD,
    splitAssigneeRows,
    resolveAssigneeFilter,
    passesAssigneeFilter,
    isFree,
};
