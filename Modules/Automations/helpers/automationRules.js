// AUTO-03 — pure automation-rule logic (no DB/IO). A rule = conditions (which
// tasks) + actions (what to do). The safe executable action is set_priority,
// applied as an on-demand bulk update; event-triggered execution (task_created /
// task_status_changed) is stored on the rule and documented as the gated
// extension so we never mutate inside core task-event flows. Unit-tested in
// tests/automation-rules.test.js.

const { STATUS_TYPES, resolveStatusName, statusRef, refProject, refKey } = require('./statusConditions');

const TRIGGERS = ['manual', 'task_created', 'task_status_changed'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const ACTION_TYPES = ['set_priority'];

const validateRule = (cfg = {}) => {
    const errors = [];
    const name = String(cfg.name || '').trim();
    if (!name) errors.push('name is required');
    const trigger = TRIGGERS.includes(cfg.trigger) ? cfg.trigger : 'manual';
    const c = (cfg.conditions && typeof cfg.conditions === 'object' && !Array.isArray(cfg.conditions)) ? cfg.conditions : {};
    const conditions = {};
    if (c.projectId) conditions.projectId = String(c.projectId);
    if (c.priority && PRIORITIES.includes(c.priority)) conditions.priority = c.priority;
    if (c.statusType) conditions.statusType = String(c.statusType);
    const rawActions = Array.isArray(cfg.actions) ? cfg.actions : [];
    const actions = [];
    for (const a of rawActions) {
        if (a && a.type === 'set_priority' && PRIORITIES.includes(a.value)) actions.push({ type: 'set_priority', value: a.value });
    }
    if (!actions.length) errors.push('at least one valid action is required (set_priority)');
    return { valid: errors.length === 0, errors, value: errors.length ? null : { name, trigger, conditions, actions } };
};

/* `statusType` holds whatever was typed, usually a status name. A name is matched
 * by project and key among `statuses` (statusConditions.catalogueOf); one that
 * names no status is kept as a type, which matches nothing, as before. */
const statusRefsOf = (conditions, statuses = []) => {
    const value = conditions.statusType;
    if (!value || STATUS_TYPES.includes(value)) return null;
    const pool = conditions.projectId ? statuses.filter((s) => s.projectId === String(conditions.projectId)) : statuses;
    return resolveStatusName(value, pool, { generic: false }).refs || null;
};

// Mongo match for a rule's conditions (parent tasks, not deleted). `oid` is passed
// in to keep this module pure (no mongoose require).
const buildMatch = (conditions = {}, oid, statuses = []) => {
    const m = { deletedStatusKey: 0, isParentTask: true };
    if (conditions.projectId && oid) { const o = oid(conditions.projectId); if (o) m.ProjectID = o; }
    if (conditions.priority) m.Task_Priority = conditions.priority;
    const refs = statusRefsOf(conditions, statuses);
    if (refs) m.$or = refs.map((ref) => ({ ProjectID: (oid && oid(refProject(ref))) || refProject(ref), statusKey: refKey(ref) }));
    else if (conditions.statusType) m.statusType = conditions.statusType;
    return m;
};

const matchTask = (task = {}, conditions = {}, statuses = []) => {
    if (conditions.projectId && String(task.ProjectID) !== String(conditions.projectId)) return false;
    if (conditions.priority && task.Task_Priority !== conditions.priority) return false;
    const refs = statusRefsOf(conditions, statuses);
    if (refs) return refs.includes(statusRef(task.ProjectID, task.statusKey));
    if (conditions.statusType && task.statusType !== conditions.statusType) return false;
    return true;
};

const describe = (rule = {}) => {
    const conds = Object.keys(rule.conditions || {}).map((k) => `${k}=${rule.conditions[k]}`).join(', ') || 'any task';
    const acts = (rule.actions || []).map((a) => `set priority ${a.value}`).join('; ');
    return `${conds} → ${acts}`;
};

module.exports = { TRIGGERS, PRIORITIES, ACTION_TYPES, validateRule, buildMatch, matchTask, describe };
