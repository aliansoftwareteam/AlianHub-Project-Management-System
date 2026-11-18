const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { canReadProject } = require('../../Config/projectAccess');
const { nonMembersOf } = require('../../Config/companyMembers');
const { hiddenSprintIds } = require('../Sprints/helpers/sprintVisibility');
const { FEATURES } = require('../AICore/features');
const aiSwitch = require('../AICore/aiSwitch');
const { isAnyProviderConfigured } = require('../AICore/llmProvider');
const { askModel } = require('../AICore/modelCall');
const { RuleError, namesOf, idOf, plain } = require('./rules');
const engine = require('./engine');
const prompts = require('./prompts');

const MAX_PEOPLE = 10;
const RECENT_TASKS = 15;

const bothForms = (ids) => ids.flatMap((id) => [String(id), new mongoose.Types.ObjectId(String(id))]);

/* Only tasks the editor can open go into the prompt: a private sprint they are not on stays out. */
async function recentTasks(companyId, projectId, userId, hidden) {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            {
                ProjectID: { $in: bothForms([projectId]) },
                AssigneeUserId: userId,
                deletedStatusKey: { $ne: 1 },
                mainChat: { $ne: true },
                ...(hidden.length ? { sprintId: { $nin: bothForms(hidden) } } : {}),
            },
            { TaskName: 1, TaskType: 1, TaskTypeKey: 1, tagsArray: 1 },
            { sort: { updatedAt: -1 }, limit: RECENT_TASKS },
        ],
    }, 'find');
    return (rows || []).map(plain);
}

async function draftRules({ companyId, projectId, uid, userIds }) {
    const asked = [...new Set((Array.isArray(userIds) ? userIds : []).map(idOf).filter(Boolean))];
    if (!asked.length) throw new RuleError('Add at least one person before asking for suggestions.');
    if (asked.length > MAX_PEOPLE) throw new RuleError(`Suggestions cover at most ${MAX_PEOPLE} people at a time.`);
    if (!(await aiSwitch.allowed(companyId)) || !isAnyProviderConfigured()) throw new RuleError('AI is off or no model is configured.', 409);

    const outsiders = new Set(await nonMembersOf(companyId, asked));
    const people = [];
    for (const id of asked) {
        if (!outsiders.has(id) && (await canReadProject(companyId, id, projectId)).allowed) people.push(id);
    }
    if (!people.length) return [];

    const privileged = isPrivileged(await getRoleType(companyId, uid));
    const hidden = privileged ? [] : (await hiddenSprintIds(companyId, uid, [projectId])).map(String);
    const project = await engine.readProject(companyId, projectId);
    const names = await namesOf(companyId, people);
    const described = [];
    for (const userId of people) {
        const tasks = await recentTasks(companyId, projectId, userId, hidden);
        described.push({
            userId,
            name: names.get(userId) || '',
            tasks: tasks.map((task) => ({
                title: task.TaskName || '',
                type: task.TaskType || '',
                tags: engine.tagNames(task, project),
            })),
        });
    }

    const answer = await askModel(prompts.DRAFT, {
        prompt: prompts.draftPrompt(described),
        budget: {},
        spend: { feature: FEATURES.ASSIGNMENT_RULES, companyId: String(companyId), userId: String(uid) },
    });
    if (!answer.raw) throw new RuleError('The model did not return suggestions. Try again.', 502);
    return prompts.readDrafts(answer.raw, people);
}

module.exports = { draftRules, MAX_PEOPLE };
