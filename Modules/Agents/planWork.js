const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const tools = require('../Automations/engine/tools');
const registry = require('./registry');
const permissions = require('./permissions');
const setup = require('./setupRequests');
const rules = require('./automationRequests');
const { TITLE_MAX, assignable } = require('./taskRequests');

// The automations and first tasks a plan for a project can hold beside its statuses, lists, fields and views
// (./projectSetup.js). A plan may ask for nothing its agent could not ask for one at a time, so each of these is not
// made here: it is handed to perform() as the action a call for it alone runs (automation.create, task.add). There
// it meets the registry, the skills the plan was filed with, the permissions of the person behind the agent and the
// project's rule for agents, and leaves its own audit row with its own undo. The approver is held to it first, as
// approving a change filed on its own holds them: an automation needs an owner or an admin.

const RULE = rules.ACTION;
const TASK = 'task.add';
const RULES_MAX = 5;
const TASKS_MAX = 30;
const LISTS_READ = 200;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const GATE_OWNER_ADMIN = 'owner_admin';
const DENIED = permissions.REASON;
const REFUSED = Object.freeze({
    startsOff: 'an automation of a plan starts switched off; the person switches it on in AlianHub',
    noRules: 'the automations of a plan are made as automation.create makes one, which this connection may not use',
    noTasks: 'the first tasks of a plan are made as task.create makes one with its details, which this connection may not use',
    needsAdmin: 'only an owner or an admin approves an automation, so it was not made; an owner or an admin can add it on the Automations page',
    unapproved: 'this part is made only once a person has approved the plan',
});

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const lower = (value) => String(value).trim().toLowerCase();
const sameName = (a, b) => lower(a) === lower(b);
const isDay = (value) => typeof value === 'string' && ISO_DAY.test(value) && DateTime.fromISO(value).isValid;
const ruleNameAt = (at) => `automation number ${at + 1}`;

/* A rule of a plan is the draft automation.create takes, without the project, which is the plan's, and never switched on. */
const ruleOf = (given) => {
    const { trigger, conditions, actions } = rules.draftOf(given);
    return { trigger, conditions, actions };
};

const taskOf = (given) => {
    const task = objectOf(given);
    const list = setup.lineOf(task.list, require('./workRequests').LIST_NAME_MAX);
    const status = setup.lineOf(task.status, setup.LOOK_MAX.status);
    const assigneeId = OBJECT_ID.test(idOf(task.assigneeId)) ? idOf(task.assigneeId).toLowerCase() : '';
    return {
        name: setup.lineOf(task.name, TITLE_MAX),
        ...(list ? { list } : {}),
        ...(status ? { status } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(isDay(task.dueDate) ? { dueDate: task.dueDate } : {}),
    };
};

/* What a caller names, kept to what each is made of; a part left out is left out. */
const partsOf = (given) => {
    const plan = objectOf(given);
    const [ruleDrafts, tasks] = [listOf(plan.rules).map(ruleOf), listOf(plan.tasks).map(taskOf)];
    return { ...(ruleDrafts.length ? { rules: ruleDrafts } : {}), ...(tasks.length ? { tasks } : {}) };
};

const isAsked = (given) => { const plan = objectOf(given); return plan.rules !== undefined || plan.tasks !== undefined; };

const rulesProblem = (given) => {
    if (given === undefined) return '';
    const drafts = listOf(given);
    if (!drafts.length || drafts.length > RULES_MAX) return `rules needs 1 to ${RULES_MAX} automations`;
    for (const [at, draft] of drafts.entries()) {
        const wrong = objectOf(draft).enabled !== undefined ? REFUSED.startsOff : rules.draftProblem(draft);
        if (wrong) return `rules[${at}]: ${wrong}`;
    }
    return '';
};

const tasksProblem = (given) => {
    if (given === undefined) return '';
    const asked = listOf(given);
    if (!asked.length || asked.length > TASKS_MAX) return `tasks needs 1 to ${TASKS_MAX} tasks`;
    for (const [at, entry] of asked.entries()) {
        const [raw, task] = [objectOf(entry), taskOf(entry)];
        const where = `tasks[${at}]${task.name ? ` (${task.name})` : ''}`;
        if (!task.name) return `${where} needs a name`;
        if (raw.assigneeId !== undefined && !task.assigneeId) return `${where}: assigneeId needs the id of a member of the project`;
        if (raw.dueDate !== undefined && !task.dueDate) return `${where}: dueDate needs a day as YYYY-MM-DD`;
    }
    return '';
};

/* '' when the automations and first tasks of a plan can be asked for; otherwise what is wrong with the first that cannot. */
const problemIn = (given) => { const plan = objectOf(given); return rulesProblem(plan.rules) || tasksProblem(plan.tasks); };

/* The statuses a rule names, in its conditions and in the settings of its steps, as written. */
const statusWordsOf = (rule) => {
    const { draftSchema, kindOf } = require('../Automations/helpers/aiDraftCheck');
    const schema = draftSchema();
    const isStatus = (spec) => Boolean(spec) && kindOf(spec) === 'status';
    const fields = schema.conditionFields.task || [];
    const draft = ruleOf(rule);
    const tested = draft.conditions.filter((condition) => isStatus(fields.find((field) => field.field === condition.field))).flatMap((condition) => [].concat(condition.value === undefined ? [] : condition.value));
    const set = draft.actions.flatMap((step) => {
        const action = schema.actions.find((entry) => entry.key === step.action);
        return action ? Object.keys(action.config).filter((key) => isStatus(action.config[key])).flatMap((key) => [].concat(step.config[key] === undefined ? [] : step.config[key])) : [];
    });
    return [...tested, ...set].filter((word) => typeof word === 'string').flatMap((word) => [word, ...word.split(/\s+or\s+/i)]);
};

/* What the automations and first tasks of a plan cannot be made without: `add(key, part, name)` is told each list or status of the same plan one names. */
const needsIn = (params, add) => {
    listOf(params && params.tasks).forEach((entry, at) => {
        const task = taskOf(entry);
        add(`tasks:${at}`, 'lists', task.list);
        add(`tasks:${at}`, 'statuses', task.status);
    });
    listOf(params && params.rules).forEach((rule, at) => statusWordsOf(rule).forEach((word) => add(`rules:${at}`, 'statuses', word)));
};

/* The actions the parts of a filed plan run beside the plan's own. */
const actionsIn = (params) => {
    const plan = objectOf(params);
    return [...(listOf(plan.rules).length ? [RULE] : []), ...(listOf(plan.tasks).length ? [TASK] : [])];
};

const fieldsOf = (task) => ({
    ...(task.status ? { status: task.status } : {}),
    ...(task.assigneeId ? { AssigneeUserId: [task.assigneeId] } : {}),
    ...(task.dueDate ? { DueDate: task.dueDate } : {}),
});

/* The live list of the project by that name which every one of `uids` may open, or ''. */
const listNamed = async (companyId, projectId, name, uids) => {
    const { listFor } = require('./listSetup');
    const found = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS, data: [{ projectId: { $in: idForms(projectId) }, deletedStatusKey: { $in: [0, null] } }, { name: 1 }, { sort: { createdAt: 1 }, limit: LISTS_READ }],
    }, 'find');
    for (const row of (found || []).filter((list) => sameName(list.name || '', name))) {
        let open = true;
        for (const uid of uids) open = open && Boolean(await listFor(companyId, uid, projectId, row._id));
        if (open) return idOf(row._id);
    }
    return '';
};

const statusNamesOf = (project) => listOf(project.taskStatusData).map((row) => (row && row.convertStatus ? row.convertStatus : row)).filter(Boolean).map((status) => status.name || '');
const named = (names, name) => listOf(names).some((held) => sameName(held, name));

const taskMisfit = async ({ companyId, actor, uid, project, plan, task }) => {
    const projectId = idOf(project._id);
    if (task.list && !named(plan.lists, task.list) && !(await listNamed(companyId, projectId, task.list, [uid]))) return { error: `"${task.list}" is not a list of this plan or of the project` };
    if (task.status && !named(plan.statuses, task.status) && !named(statusNamesOf(project), task.status)) return { error: `"${task.status}" is not a status of this plan or of the project` };
    if (task.assigneeId) {
        const cannot = await assignable(companyId, projectId, [task.assigneeId]).then(() => '', (error) => error.message);
        if (cannot) return { error: cannot };
    }
    if (!task.status) return null;
    const projectPolicy = require('./projectPolicy');
    const rule = await projectPolicy.ask({ companyId, actor, action: TASK, params: { projectId, fields: fieldsOf(task) } });
    return rule.decision === projectPolicy.DECISION.REFUSE ? { refused: rule.reason } : null;
};

/* What stops the automations and first tasks of a plan from being filed for this caller, who would be stopped the
 * same way asking for one alone: { refused } where the caller may not, { error } where the plan names what is not
 * there, null where nothing does. `mayManage` says whether the connection holds what the task tools need. */
const filingProblem = async ({ companyId, actor, uid, allowedActions, mayManage, project, plan }) => {
    const projectId = idOf(project._id);
    const usable = (action, params) => registry.has(action) && registry.evaluate(action, { ...params, __proposal: true }, { allowedActions }).allowed;
    if (plan.rules) {
        if (!usable(RULE, {})) return { refused: `${DENIED}: ${REFUSED.noRules}` };
        if (!(await rules.mayManage(companyId, uid))) return { refused: rules.REFUSED.filer };
        const held = await permissions.holderMay(companyId, actor, RULE, { projectId });
        if (!held.allowed) return { refused: held.reason };
        for (const [at, rule] of plan.rules.entries()) {
            const wrong = await rules.proposalProblem({ companyId, uid, draft: { ...rule, projectId, enabled: false }, planned: plan.statuses });
            if (wrong) return { error: `rules[${at}]: ${wrong}` };
        }
    }
    if (plan.tasks) {
        const fields = Object.assign({}, ...plan.tasks.map(fieldsOf));
        if (!mayManage || !usable(TASK, { fields })) return { refused: `${DENIED}: ${REFUSED.noTasks}` };
        const held = await permissions.holderMay(companyId, actor, TASK, { projectId, fields });
        if (!held.allowed) return { refused: held.reason };
        for (const [at, task] of plan.tasks.entries()) {
            const wrong = await taskMisfit({ companyId, actor, uid, project, plan, task });
            if (wrong) return wrong.error ? { error: `tasks[${at}] (${task.name}): ${wrong.error}` } : wrong;
        }
    }
    return null;
};

const isAdmin = async (companyId, uid) => {
    const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
    return isPrivileged(await getRoleType(companyId, uid));
};

const performPart = async ({ companyId, actor, depth, approvedBy, within }, action, params) => {
    const entry = registry.get(action);
    if (!entry) throw refuse(`${action} is switched off here`);
    if (!OBJECT_ID.test(idOf(approvedBy))) throw refuse(REFUSED.unapproved);
    if (entry.gate === GATE_OWNER_ADMIN && !(await isAdmin(companyId, approvedBy))) throw refuse(REFUSED.needsAdmin);
    const own = await permissions.holderMay(companyId, { kind: 'human', userId: approvedBy }, action, params);
    if (!own.allowed) throw refuse(`the approver may not make this part: ${own.reason}`);
    const given = objectOf(within);
    return require('./actions').perform({
        companyId, actor, action, params: { ...params, __proposal: true }, reason: `part of a plan approved by ${approvedBy}`, ip: given.ip || '',
        allowedActions: given.allowedActions, depth, approved: true, approvedBy, ...(given.taint ? { taint: given.taint } : {}),
    });
};

/* Each rule in turn, answered on its own: made, or why not. */
const addRules = async ({ projectId, plan, ...context }) => {
    const items = [];
    for (const [at, rule] of plan.rules.entries()) {
        try {
            const out = await performPart(context, RULE, { ...rule, projectId, enabled: false });
            items.push({ name: out.result.sentence || out.result.name || ruleNameAt(at), made: true, ruleId: out.result.ruleId, auditId: idOf(out.auditId) });
        } catch (error) {
            items.push({ name: ruleNameAt(at), made: false, error: error.message });
        }
    }
    return items;
};

/* A task goes in the list of that name the plan has just made, else in the project's own list of that name that
 * both the person behind the agent and the approver may open. */
const addTasks = async ({ projectId, plan, made, who, ...context }) => {
    const fresh = ((listOf(made).find((entry) => entry.part === 'lists') || {}).items || []).filter((item) => item.made);
    const items = [];
    for (const task of plan.tasks) {
        try {
            const inPlan = task.list ? fresh.find((item) => sameName(item.name, task.list)) : null;
            const sprintId = inPlan ? idOf(inPlan.sprintId) : (task.list ? await listNamed(context.companyId, projectId, task.list, [who.uid, context.approvedBy]) : '');
            if (task.list && !sprintId) throw refuse(`the list "${task.list}" was not found in this project`);
            const out = await performPart(context, TASK, { projectId, sprintId, title: task.name, fields: fieldsOf(task) });
            items.push({ name: task.name, made: true, taskId: out.result.taskId, auditId: idOf(out.auditId) });
        } catch (error) {
            items.push({ name: task.name, made: false, error: error.message });
        }
    }
    return items;
};

const MAKERS = Object.freeze({ rules: addRules, tasks: addTasks });
const namesOf = (plan, part) => (part === 'rules' ? listOf(plan.rules).map((rule, at) => ruleNameAt(at)) : listOf(plan.tasks).map((task) => task.name));

module.exports = {
    RULE, TASK, RULES_MAX, TASKS_MAX, PARTS: Object.freeze(Object.keys(MAKERS)), REFUSED, MAKERS,
    ruleOf, taskOf, partsOf, isAsked, problemIn, needsIn, actionsIn, filingProblem, namesOf, fieldsOf,
};
