const { evaluate, readField, CHANGE_OPS, LOGICAL_OPS } = require('../engine/expression');
const { render, placeholdersIn } = require('../engine/template');
const { getAction } = require('../engine/registry');
const { contextFor, inScope } = require('../engine/matcher');
const { trimTask } = require('../../../event/domainEventBus');

// Plans what a rule would do to one stored task. Pure: it only evaluates and
// renders, and never touches an action's run(), so nothing here can write, emit
// or call out — the controller loads the rule and task, this decides.

const MAX_STEPS = 25;

const shown = (value) => {
    if (value === undefined || value === null || value === '') return 'empty';
    if (Array.isArray(value)) return value.length ? `[${value.map(String).join(', ')}]` : 'empty';
    return `"${String(value)}"`;
};

const leavesOf = (node, out = []) => {
    if (!node || typeof node !== 'object' || !node.op) return out;
    if (LOGICAL_OPS.includes(node.op)) {
        const args = node.op === 'not' ? [node.args?.[0] ?? node.arg] : (node.args || []);
        args.forEach((child) => leavesOf(child, out));
        return out;
    }
    out.push(node);
    return out;
};

const rootField = (field) => {
    const parts = String(field || '').split('.');
    return parts[0] === 'task' && parts.length > 1 ? parts[1] : parts[0];
};

/* A stored task has no before/after, so a change clause is read as though its
 * field had just changed to the value the task holds now. */
const changedFieldsFor = (conditions) => [...new Set(leavesOf(conditions).filter((n) => CHANGE_OPS.includes(n.op)).map((n) => rootField(n.field)))];

const describeLeaf = (node, ctx) => {
    const passed = evaluate(node, ctx);
    const actual = readField(node.field, ctx);
    const clause = { field: node.field, op: node.op, value: node.value, actual: actual === undefined ? null : actual, passed };
    if (node.op === 'changedFrom') clause.note = 'A stored task has no earlier value, so a "changed from" clause cannot be checked.';
    else if (CHANGE_OPS.includes(node.op)) clause.note = `Read as though ${node.field} had just changed.`;
    return clause;
};

const failureReason = (clause) => {
    if (clause.op === 'changedFrom') return `${clause.field} changed from ${shown(clause.value)} cannot be checked on a stored task.`;
    const wanted = ['empty', 'notEmpty', 'changed'].includes(clause.op) ? clause.op : `${clause.op} ${shown(clause.value)}`;
    return `${clause.field} is ${shown(clause.actual)}, and the rule needs ${clause.field} ${wanted}.`;
};

const envelopeFor = ({ rule, task, uid }) => {
    const data = trimTask(task);
    return {
        type: rule.trigger?.event || rule.trigger,
        data,
        previous: {},
        actor: { kind: 'user', userId: uid ? String(uid) : null },
        scope: { projectId: data.ProjectID, sprintId: data.sprintId },
        entity: { kind: 'task', id: data._id, key: data.TaskKey },
        changedFields: changedFieldsFor(rule.conditions),
    };
};

const planSteps = (steps, ctx, matched) => {
    let stoppedBy = matched ? null : 'The rule does not match this task.';
    return (Array.isArray(steps) ? steps.slice(0, MAX_STEPS) : []).map((step, i) => {
        const id = step.id || `s${i + 1}`;
        if (step.type === 'condition') {
            const passed = evaluate(step.condition, ctx);
            const entry = { id, type: 'condition', action: null, label: 'Condition', params: null, passed, wouldRun: !stoppedBy && passed };
            if (!stoppedBy && !passed) {
                entry.note = `This condition does not hold, so the run would stop here. ${leavesOf(step.condition).map((n) => describeLeaf(n, ctx)).filter((c) => !c.passed).map(failureReason).join(' ')}`.trim();
                stoppedBy = `Stopped by condition ${id}.`;
            } else if (stoppedBy) entry.note = stoppedBy;
            return entry;
        }
        const action = step.type === 'action' ? getAction(step.action) : null;
        const entry = {
            id,
            type: step.type,
            action: step.action || null,
            label: action ? action.label : String(step.action || step.type || ''),
            params: render(step.config || {}, ctx),
            wouldRun: !stoppedBy && !!action,
        };
        if (!action) entry.note = `Unknown step "${step.action || step.type}", so the run would fail here.`;
        else if (stoppedBy) entry.note = stoppedBy;
        else if ([...placeholdersIn(step.config || {})].some((p) => p.startsWith('$s'))) entry.note = 'Uses an earlier step\'s output, which a dry run does not produce.';
        return entry;
    });
};

const plan = ({ rule, task, uid, triggerLabel }) => {
    const envelope = envelopeFor({ rule, task, uid });
    const ctx = contextFor(envelope);
    const scoped = inScope(rule, envelope);
    const conditions = leavesOf(rule.conditions).map((n) => describeLeaf(n, ctx));
    const conditionsHold = evaluate(rule.conditions, ctx);
    const matched = scoped && conditionsHold;
    const label = envelope.data.TaskKey || envelope.data.TaskName || 'This task';

    const reasons = [];
    if (!scoped) reasons.push(`${label} is in a project this rule is not scoped to.`);
    if (!conditionsHold) reasons.push(...conditions.filter((c) => !c.passed).map(failureReason));
    if (!conditionsHold && !conditions.some((c) => !c.passed)) reasons.push('The conditions do not hold for this task.');
    if (matched) reasons.push(conditions.length ? 'Every condition holds for this task.' : 'The rule has no conditions, so it runs on every such event.');
    if (rule.enabled !== true) reasons.push('The rule is switched off, so it will not run until it is switched on.');

    return {
        rule: { id: String(rule._id), name: rule.name || '', enabled: rule.enabled === true, trigger: envelope.type },
        task: { id: envelope.data._id, key: envelope.data.TaskKey, name: envelope.data.TaskName, projectId: envelope.data.ProjectID },
        matched,
        inScope: scoped,
        reasons,
        conditions,
        actions: planSteps(rule.steps, ctx, matched),
        basis: `Evaluated against the task as it is stored now, as though "${triggerLabel || envelope.type}" had just happened to it. Nothing was saved and no action ran.`,
    };
};

module.exports = { plan, leavesOf, changedFieldsFor };
