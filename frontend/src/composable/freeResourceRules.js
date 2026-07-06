// Pure rules for the Free Resources card (unit-tested in
// tests/free-resource-rules.test.js). CommonJS so both the Vue build and Jest
// can require it.

const ASSIGNEE_FIELD = 'AssigneeUserId';
const NOT_OP = ':!=';

// Split advanced-filter rows into the Assignee (person) rows and the rest.
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

// Build include/exclude user-id sets from the Assignee rows ("Is Not" excludes,
// else includes). resolveTeamIds expands team ids → user ids.
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

// Excluded users are dropped; when an include list exists, only listed users pass.
function passesAssigneeFilter(userId, filter) {
    if (!filter) return true;
    const id = String(userId);
    if (filter.exclude && filter.exclude.has(id)) return false;
    if (filter.hasInclude && !(filter.include && filter.include.has(id))) return false;
    return true;
}

// Free only when planned is under and logged is at/under their thresholds.
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
