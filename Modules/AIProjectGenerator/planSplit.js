// Labels every task and subtask of a generated plan with the agent/person
// split. Pure apart from the one read of the company's live agents.
'use strict';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { splitFor, splitSummary } = require('../Agents/taskSplit');

const blockText = (blocks) => (Array.isArray(blocks) ? blocks : []).flatMap((b) => {
    if (!b || !b.data) return [];
    if (typeof b.data.text === 'string') return [b.data.text];
    if (Array.isArray(b.data.items)) return b.data.items.map((i) => (typeof i === 'string' ? i : (i && i.content) || ''));
    return [];
}).join('\n').trim();

const asRouterTask = (task = {}) => ({
    TaskName: task.TaskName,
    rawDescription: blockText(task.descriptionBlocks),
    tagsArray: [],
    links: [],
});

/* Agents that could take work in a project that does not exist yet: live and
 * not pinned to other projects. Paused ones are left out of the plan view;
 * execute includes them so a pause shows up as a refusal, not a relabel. */
const loadLiveAgents = async (companyId, { includePaused = false } = {}) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENTS,
        data: [{ deletedStatusKey: { $ne: 1 }, ...(includePaused ? {} : { paused: { $ne: true } }) }],
    }, 'find');
    return (rows || []).filter((a) => !(Array.isArray(a.projectIds) && a.projectIds.length));
};

const labelPlan = (plan, agents) => {
    const splits = [];
    const sprints = (Array.isArray(plan.sprints) ? plan.sprints : []).map((sprint) => ({
        ...sprint,
        tasks: (Array.isArray(sprint.tasks) ? sprint.tasks : []).map((task) => {
            const split = splitFor({ task: asRouterTask(task), agents });
            splits.push(split);
            const subtasks = Array.isArray(task.subtasks) ? task.subtasks.map((sub) => {
                const subSplit = splitFor({ task: asRouterTask(sub), agents });
                splits.push(subSplit);
                return { ...sub, split: subSplit };
            }) : task.subtasks;
            return { ...task, split, ...(subtasks ? { subtasks } : {}) };
        }),
    }));
    return { ...plan, sprints, splitSummary: splitSummary(splits) };
};

const attachSplit = async (plan, { companyId, assumptions, agents } = {}) => {
    const live = agents || await loadLiveAgents(companyId);
    const labelled = labelPlan(plan || {}, live);
    labelled.assumptions = Array.isArray(assumptions) ? assumptions : (Array.isArray(plan && plan.assumptions) ? plan.assumptions : []);
    return labelled;
};

module.exports = { attachSplit, labelPlan, loadLiveAgents, asRouterTask };
