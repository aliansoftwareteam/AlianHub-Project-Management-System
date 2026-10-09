const rules = require('./automationRequests');
const planWork = require('./planWork');

// The lines a plan's card shows for its automations and first tasks (frontend IntentPreview), for one viewer who can
// open the project. A rule is read as that person could save it, from the statuses and people they may use and the
// statuses the same plan adds, and shows why instead when it is not a rule they could save. An assignee is named
// only where the viewer may see them.

const SENTENCE_MAX = 600;
const NOT_READ = 'It could not be read as an automation.';

const listOf = (value) => (Array.isArray(value) ? value : []);
const paramsOf = (change) => (change && change.params && typeof change.params === 'object' ? change.params : {});

const peopleIn = (change) => listOf(paramsOf(change).tasks).map((task) => planWork.taskOf(task).assigneeId).filter(Boolean);

const ruleLine = async (given, at, { companyId, uid, projectId, planned }) => {
    const pick = `rules:${at}`;
    const problem = rules.draftProblem(given);
    const built = problem
        ? { rule: null, rejected: [problem] }
        : await rules.ruleFor({ companyId, uid, draft: { ...planWork.ruleOf(given), projectId, enabled: false }, planned });
    if (!built.rule) return { kind: 'planRule', problem: String(built.rejected[0] || NOT_READ).slice(0, SENTENCE_MAX), pick };
    const { describeRule } = require('../Automations/helpers/sentenceRules');
    return { kind: 'planRule', text: describeRule(built.rule, { people: built.people }).slice(0, SENTENCE_MAX), pick };
};

const taskLine = (given, at, projectId, named) => {
    const task = planWork.taskOf(given);
    if (!task.name) return null;
    const assignee = (task.assigneeId && named.person(task.assigneeId, projectId).name) || '';
    return {
        kind: 'planTask', name: task.name, list: task.list || '', status: task.status || '',
        assignee, hidden: task.assigneeId && !assignee ? 1 : 0, due: task.dueDate || '', pick: `tasks:${at}`,
    };
};

const lines = async (change, { named, companyId, uid }) => {
    const params = paramsOf(change);
    const projectId = String(params.projectId || '');
    const context = { companyId, uid, projectId, planned: listOf(params.statuses) };
    const ruleLines = await Promise.all(listOf(params.rules).slice(0, planWork.RULES_MAX).map((rule, at) => ruleLine(rule, at, context)));
    return [...ruleLines, ...listOf(params.tasks).slice(0, planWork.TASKS_MAX).map((task, at) => taskLine(task, at, projectId, named))];
};

module.exports = { lines, peopleIn };
