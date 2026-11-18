/* Rule recipes for the template gallery, shared with the frontend through the
 * `@automationTemplates` alias, so it must stay free of server requires.
 * tests/automation-templates.test.js holds every recipe to the engine registry. */

const CATEGORIES = Object.freeze(['status', 'assignment', 'dates', 'priority', 'subtasks', 'forms']);
const FILL_KINDS = Object.freeze(['status', 'text', 'person']);

const status = (type) => ({ fill: 'status', type });
const text = (id) => ({ fill: 'text', key: `AutomationTemplates.${id}_text` });
const PERSON = { fill: 'person' };

const recipe = (id, category, trigger, conditions, steps) => Object.freeze({
    id,
    category,
    nameKey: `AutomationTemplates.${id}_name`,
    descriptionKey: `AutomationTemplates.${id}_desc`,
    rule: {
        trigger: { type: 'event', event: trigger },
        conditions,
        steps: steps.map((step, i) => ({ id: `s${i + 1}`, type: 'action', ...step })),
    },
});

const TEMPLATES = Object.freeze([
    recipe('done_back_to_creator', 'status', 'task.status_changed',
        { op: 'changedTo', field: 'statusRef', value: status('close') },
        [{ action: 'assign', config: { mode: 'add', userIds: ['task_creator'] } }]),
    recipe('done_comment', 'status', 'task.status_changed',
        { op: 'changedTo', field: 'statusRef', value: status('close') },
        [{ action: 'add_comment', config: { body: text('done_comment') } }]),
    recipe('done_notify_creator', 'status', 'task.status_changed',
        { op: 'changedTo', field: 'statusRef', value: status('close') },
        [{ action: 'notify', config: { recipients: ['task_creator'], message: text('done_notify_creator') } }]),
    recipe('reopened_priority', 'status', 'task.status_changed',
        { op: 'changedFrom', field: 'statusRef', value: status('close') },
        [{ action: 'set_priority', config: { priority: 'HIGH' } }]),
    recipe('created_assign', 'assignment', 'task.created', {},
        [{ action: 'assign', config: { mode: 'add', userIds: [PERSON] } }]),
    recipe('created_take_turns', 'assignment', 'task.created', {},
        [{ action: 'assign', config: { mode: 'add', userIds: [PERSON, PERSON], roundRobin: true } }]),
    recipe('unassigned_comment', 'assignment', 'task.assignee_changed',
        { op: 'empty', field: 'AssigneeUserId' },
        [{ action: 'add_comment', config: { body: text('unassigned_comment') } }]),
    recipe('overdue_priority', 'dates', 'task.due_date_passed', {},
        [{ action: 'set_priority', config: { priority: 'HIGH' } }]),
    recipe('due_date_moved_comment', 'dates', 'task.due_date_changed', {},
        [{ action: 'add_comment', config: { body: text('due_date_moved_comment') } }]),
    recipe('due_date_moved_priority', 'dates', 'task.due_date_changed',
        { op: 'eq', field: 'Task_Priority', value: 'LOW' },
        [{ action: 'set_priority', config: { priority: 'MEDIUM' } }]),
    recipe('high_priority_assign', 'priority', 'task.priority_changed',
        { op: 'changedTo', field: 'Task_Priority', value: 'HIGH' },
        [{ action: 'assign', config: { mode: 'add', userIds: [PERSON] } }]),
    recipe('subtasks_done_close_parent', 'subtasks', 'task.subtasks_all_done', {},
        [{ action: 'set_status', config: { status: status('close') } }]),
    recipe('parent_done_comment', 'subtasks', 'task.status_changed',
        { op: 'and', args: [{ op: 'changedTo', field: 'statusRef', value: status('close') }, { op: 'eq', field: 'isParentTask', value: true }] },
        [{ action: 'add_comment', config: { body: text('parent_done_comment') } }]),
    recipe('created_review_subtask', 'subtasks', 'task.created', {},
        [{ action: 'create_subtask', config: { title: text('created_review_subtask') } }]),
    recipe('form_assign', 'forms', 'form.submitted', {},
        [{ action: 'assign', config: { mode: 'add', userIds: [PERSON] } }]),
    recipe('form_priority', 'forms', 'form.submitted', {},
        [{ action: 'set_priority', config: { priority: 'HIGH' } }]),
]);

const isFill = (node) => node !== null && typeof node === 'object' && !Array.isArray(node) && typeof node.fill === 'string';

const statusesOf = (project) => (Array.isArray(project && project.taskStatusData) ? project.taskStatusData : [])
    .map((row) => (row && row.convertStatus ? row.convertStatus : row))
    .filter((s) => s && s.key !== undefined && s.key !== null && s.name);

const TYPE_OP = Object.freeze({ in: 'eq', notIn: 'neq' });

/* A status of a type is a different key in every project, so the placeholder
 * becomes that project's refs. With no project to read, the rule names the type
 * itself: dropping the condition would widen the rule to every status. */
const fillStatus = (node, projects, projectId) => {
    const found = (projects || [])
        .filter((p) => !projectId || String(p._id) === String(projectId))
        .flatMap((p) => statusesOf(p).filter((s) => s.type === node.value.type).map((s) => ({ ref: `${p._id}:${s.key}`, name: String(s.name) })));
    if (!found.length) return { op: TYPE_OP[node.op] || node.op, field: 'statusType', value: node.value.type };
    return { op: node.op, field: node.field, value: found.map((s) => s.ref), label: found[0].name };
};

const fillConditions = (node, ctx) => {
    if (!node || !node.op) return {};
    if (Array.isArray(node.args)) return { ...node, args: node.args.map((arg) => fillConditions(arg, ctx)) };
    if (isFill(node.value)) return fillStatus(node, ctx.projects, ctx.projectId);
    return { ...node };
};

/* An action names its status, so the placeholder becomes the first status of that
 * type among the projects the rule covers; with none to read, a word in the
 * reader's language that the person replaces in the builder. */
const statusName = (fill, ctx) => {
    const found = (ctx.projects || [])
        .filter((p) => !ctx.projectId || String(p._id) === String(ctx.projectId))
        .flatMap((p) => statusesOf(p).filter((s) => s.type === fill.type));
    return found.length ? String(found[0].name) : ctx.translate(`AutomationTemplates.status_${fill.type}`);
};

const fillConfig = (value, ctx) => {
    if (Array.isArray(value)) return value.filter((v) => !(isFill(v) && v.fill === 'person')).map((v) => fillConfig(v, ctx));
    if (isFill(value)) {
        if (value.fill === 'text') return ctx.translate(value.key);
        return value.fill === 'status' ? statusName(value, ctx) : value;
    }
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillConfig(v, ctx)]));
    return value;
};

/* The rule a template becomes for one project ('' for every project): statuses
 * from that project, text in the reader's language, people left for the person
 * to pick in the builder. */
const fillTemplate = (template, { projects = [], projectId = '', translate = (key) => key } = {}) => ({
    version: 2,
    trigger: { ...template.rule.trigger },
    scope: projectId ? { allProjects: false, projectIds: [String(projectId)] } : { allProjects: true, projectIds: [] },
    conditions: fillConditions(template.rule.conditions, { projects, projectId }),
    steps: template.rule.steps.map((step) => ({ ...step, config: fillConfig(step.config, { projects, projectId, translate }) })),
});

module.exports = { TEMPLATES, CATEGORIES, FILL_KINDS, fillTemplate };
