const crypto = require('crypto');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const tools = require('../Automations/engine/tools');
const catalogue = require('../Automations/engine/registry');
const access = require('../Automations/helpers/ruleAccess');
const { storedProject, whoOf } = require('./taskRequests');

// A rule an agent proposes for one project, in the catalogue's own terms. What is filed is the draft, never a rule:
// it is turned into one for whoever is looking (the preview) and for whoever approves, from the statuses and people
// that person may use, and saved by the Automations page's own create route as the approver. So who may save a
// rule, what it may hold and its limits are that page's, and the rule is the approver's, not the agent's.

const ACTION = 'automation.create';
const UNDO_KIND = 'automation';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAY_PROPOSE = Object.freeze(['set_status', 'set_priority', 'add_comment', 'create_subtask', 'assign', 'notify']);
const RUNS_AGENT = 'run_agent';
const CONDITIONS_MAX = 10;
const STEPS_MAX = 10;
const EXAMPLES_MAX = 3;
const KEY_MAX = 60;
const MADE_OF = Object.freeze(['name', 'trigger', 'scope', 'conditions', 'steps', 'reactToAutomation', 'limits']);

const REFUSED = Object.freeze({
    reacts: 'A rule that reacts to changes made by automations or agents cannot be proposed. A person can switch that on in AlianHub.',
    agentStep: 'A step that runs an AI agent cannot be proposed. A person can add it in AlianHub.',
    otherStep: `Only these steps can be proposed: ${MAY_PROPOSE.join(', ')}. A step that sends something outside the workspace (an email, a webhook, a Slack message) is added by a person in AlianHub.`,
    notATask: 'Only a rule that starts from a task can be proposed. A person can set up one that starts from a form or a schedule in AlianHub.',
    filer: 'Only owners and admins can manage automations, so a rule cannot be proposed for anyone else. Ask an owner or an admin.',
    project: 'That project was not found, or the person cannot open it.',
});

const ROUTES = Object.freeze({
    create: 'post /api/v2/automations',
    remove: 'delete /api/v2/automations/:id',
    backtest: 'post /api/v2/automations/backtest',
});

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const keyOf = (value) => (typeof value === 'string' ? value.trim().slice(0, KEY_MAX) : '');

let routes = null;

/* The guards and the handler the Automations module registers for one route, in the order a request meets them. */
const chainOf = (name) => {
    if (!routes) {
        const table = new Map();
        const take = (verb) => (path, ...handlers) => { table.set(`${verb} ${path}`, handlers.flat()); };
        require('../Automations/routes').init({ get: take('get'), post: take('post'), put: take('put'), patch: take('patch'), delete: take('delete'), use: take('use') });
        routes = table;
    }
    const chain = routes.get(ROUTES[name]);
    if (!chain) throw new Error(`${ROUTES[name]} is not a route`);
    return chain;
};

/* What that route answers to the person `uid`, with the status it set and no HTTP around it. */
const answerOf = (name, { companyId, uid, params = {}, body = {} }) => new Promise((resolve, reject) => {
    const chain = chainOf(name);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (sent) => { resolve({ code: res.statusCode, body: sent }); return res; };
    res.json = res.send;
    const req = { uid: String(uid), aud: String(companyId), headers: { companyid: String(companyId) }, params, query: {}, body };
    const step = (at) => Promise.resolve().then(() => chain[at](req, res, () => step(at + 1))).catch(reject);
    step(0);
});

const dataOf = (answer) => (answer.code === 200 && answer.body && answer.body.status === true ? answer.body.data || {} : null);
const reasonOf = (answer, fallback) => (answer.body && typeof answer.body.statusText === 'string' && answer.body.statusText) || fallback;

const taskTriggers = () => catalogue.availableTriggers().filter((trigger) => trigger.kind !== 'time' && trigger.entity === 'task');

/* What a caller names for a rule, kept to the parts a draft has. Anything else it sent is not carried. */
const draftOf = (given) => {
    const draft = objectOf(given);
    return {
        projectId: idOf(draft.projectId).slice(0, 40),
        trigger: keyOf(draft.trigger),
        conditions: listOf(draft.conditions).map(objectOf).map(({ field, op, value }) => ({ field: keyOf(field), op: keyOf(op), ...(value === undefined ? {} : { value }) })),
        actions: listOf(draft.actions).map(objectOf).map(({ action, config }) => ({ action: keyOf(action), config: objectOf(config) })),
        enabled: draft.enabled === true,
    };
};

const stepProblem = (step) => {
    if (MAY_PROPOSE.includes(step.action)) return '';
    return step.action === RUNS_AGENT ? REFUSED.agentStep : REFUSED.otherStep;
};

/* '' when the draft holds only what an agent may propose; otherwise the first thing it may not. */
const draftProblem = (given) => {
    if (objectOf(given).reactToAutomation !== undefined) return REFUSED.reacts;
    const draft = draftOf(given);
    const trigger = catalogue.availableTriggers().find((entry) => entry.key === draft.trigger);
    if (!trigger) return `there is no "${draft.trigger}" trigger; automation.catalogue lists the ones a rule can start from`;
    if (!taskTriggers().includes(trigger)) return REFUSED.notATask;
    if (!draft.actions.length || draft.actions.length > STEPS_MAX) return `actions needs 1 to ${STEPS_MAX} steps`;
    if (draft.conditions.length > CONDITIONS_MAX) return `conditions takes at most ${CONDITIONS_MAX}`;
    return draft.actions.map(stepProblem).find(Boolean) || '';
};

/* The catalogue an agent writes a draft from: the Automations page's own, less what an agent may not propose. */
const catalogueForAgents = () => {
    const schema = require('../Automations/helpers/aiDraftCheck').draftSchema();
    const offered = new Set(taskTriggers().map((trigger) => trigger.key));
    return {
        triggers: schema.triggers.filter((trigger) => offered.has(trigger.key)).map(({ key, label, carriesBeforeAndAfter }) => ({ key, label, carriesBeforeAndAfter })),
        conditionFields: schema.conditionFields.task || [],
        operatorsWithoutValue: schema.operatorsWithoutValue,
        operatorsTakingAList: schema.operatorsTakingAList,
        steps: schema.actions.filter((action) => MAY_PROPOSE.includes(action.key)).map(({ key, label, config }) => ({ key, label, config })),
    };
};

/* The statuses and people of one project that `uid` may name in a rule; null when they cannot open the project.
 * `planned` are statuses the same plan adds first (./planWork.js): a rule may name one before it is there, and only
 * to be checked and read. A rule is saved from the project as it is once they are made. */
const refsFor = async (companyId, uid, projectId, planned = []) => {
    const refs = await require('../Automations/aiDraft').loadRefs(companyId, String(uid));
    const project = refs.projects.find((entry) => entry.id === projectId);
    if (!project) return null;
    const onProject = new Set([...project.members, String(uid)]);
    const held = listOf(project.statuses).map((name) => String(name).trim().toLowerCase());
    const coming = [...new Set(listOf(planned).filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()))].filter((name) => !held.includes(name.toLowerCase()));
    return {
        ...refs,
        projects: [{ ...project, statuses: [...listOf(project.statuses), ...coming] }],
        people: refs.people.filter((person) => onProject.has(person.id)),
        statusCatalogue: [
            ...listOf(refs.statusCatalogue).filter((status) => status.projectId === projectId),
            ...coming.map((name, at) => ({ projectId, key: `planned-${at}`, name, type: 'active' })),
        ],
    };
};

/* { rule, people } for `uid`, or { rule: null, rejected } with why the draft is not a rule that person could save. */
const ruleFor = async ({ companyId, uid, draft, planned }) => {
    const refs = OBJECT_ID.test(draft.projectId) ? await refsFor(companyId, uid, draft.projectId, planned) : null;
    if (!refs) return { rule: null, people: [], rejected: [REFUSED.project] };
    const out = require('../Automations/helpers/aiDraftCheck').checkDraft({ trigger: draft.trigger, project: draft.projectId, conditions: draft.conditions, actions: draft.actions }, refs);
    return { rule: out.rule, people: refs.people, rejected: out.rejected };
};

/* '' when `uid` could save this draft as a rule by hand; otherwise why not. */
const proposalProblem = async ({ companyId, uid, draft, planned }) => {
    const built = await ruleFor({ companyId, uid, draft, planned });
    return built.rule ? '' : built.rejected.join(' ');
};

const mayManage = (companyId, uid) => access.canManageRules(companyId, String(uid));

const storedRule = (companyId, ruleId) => (OBJECT_ID.test(idOf(ruleId))
    ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: tools.oid(ruleId), deletedStatusKey: { $ne: 1 } }] }, 'findOne')
    : null);

const ordered = (value) => {
    if (Array.isArray(value)) return value.map(ordered);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
};

/* What the rule does, as a mark that changes when someone edits the rule and not when it is switched on or off, or runs. */
const madeOf = (rule) => {
    const plain = JSON.parse(JSON.stringify(rule));
    return crypto.createHash('sha256').update(JSON.stringify(ordered(Object.fromEntries(MADE_OF.map((key) => [key, plain[key]]))))).digest('hex');
};

const createRule = async ({ companyId, filer, approver, params }) => {
    const problem = draftProblem(params);
    if (problem) throw refuse(problem);
    const draft = draftOf(params);
    const project = await storedProject(companyId, draft.projectId);
    if (!(await mayManage(companyId, filer))) throw refuse(REFUSED.filer);
    const built = await ruleFor({ companyId, uid: approver, draft });
    if (!built.rule) throw refuse(built.rejected.join(' '));
    const answer = await answerOf('create', { companyId, uid: approver, body: { ...built.rule, enabled: draft.enabled } });
    const saved = dataOf(answer);
    if (!saved || !saved._id) throw refuse(reasonOf(answer, 'The automation was not saved. Try again, or tell the person.'));
    const ruleId = idOf(saved._id);
    return {
        project, projectId: idOf(project._id), ruleId, name: saved.name || '', sentence: saved.sentence || '', enabled: saved.enabled === true,
        ownerId: String(approver), made: madeOf(await storedRule(companyId, ruleId)),
    };
};

/* Taking back a rule an agent proposed deletes it as the Automations page does, as the person undoing, and only
 * while it still does what it was approved to do: a rule someone has edited since is theirs, and it stays. */
const withdrawRule = async ({ companyId, uid, ruleId, made }) => {
    const rule = await storedRule(companyId, ruleId);
    if (!rule) return { removed: false };
    if (madeOf(rule) !== made) throw refuse(`The automation "${rule.name || ''}" was changed after it was made, so it was left as it is. Switch it off or delete it on the Automations page.`);
    const answer = await answerOf('remove', { companyId, uid, params: { id: idOf(ruleId) } });
    if (!dataOf(answer)) throw refuse(reasonOf(answer, 'The automation was not removed. Try again, or tell the person.'));
    return { removed: true, name: rule.name || '' };
};

/* How many stored tasks the rule matches over the Automations page's own backtest, for `uid`. That count is taken
 * over whole projects, so it is given only to someone who may manage rules, and never with a task they cannot open. */
const pastRuns = async ({ companyId, uid, rule }) => {
    if (!(await mayManage(companyId, uid))) return null;
    const data = dataOf(await answerOf('backtest', { companyId, uid, body: { rule } }));
    if (!data) return null;
    const sample = listOf(data.sample);
    const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');
    const readable = await readableTaskIds(companyId, String(uid), sample.map((task) => task.id));
    if (readable.length < sample.length) return null;
    return {
        count: Number(data.matched) || 0,
        days: Number(data.windowDays) || 0,
        examples: sample.slice(0, EXAMPLES_MAX).map((task) => [task.key, task.name].filter(Boolean).join(' ')).filter(Boolean),
    };
};

const executors = {
    async [ACTION]({ companyId, actor, params, depth, approvedBy }) {
        const filer = whoOf(actor, depth).uid;
        const made = await createRule({ companyId, filer, approver: OBJECT_ID.test(idOf(approvedBy)) ? idOf(approvedBy) : filer, params });
        return {
            result: { projectId: made.projectId, ruleId: made.ruleId, name: made.name, sentence: made.sentence, enabled: made.enabled, ownerId: made.ownerId },
            undo: { kind: UNDO_KIND, projectId: made.projectId, ruleId: made.ruleId, made: made.made },
            entityType: 'project', entityId: made.projectId, entityName: made.project.ProjectName || '',
        };
    },
};

const inverses = {
    async [UNDO_KIND](companyId, u, actor) {
        const out = await withdrawRule({ companyId, uid: whoOf(actor).uid, ruleId: u.ruleId, made: u.made });
        return { projectId: u.projectId, ruleId: u.ruleId, ...out };
    },
};

module.exports = {
    ACTION, UNDO_KIND, MAY_PROPOSE, CONDITIONS_MAX, STEPS_MAX, KEY_MAX, REFUSED,
    executors, inverses, draftOf, draftProblem, catalogueForAgents, ruleFor, proposalProblem, mayManage, pastRuns, taskTriggers,
};
