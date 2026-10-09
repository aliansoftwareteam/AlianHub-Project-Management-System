const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { createAgentRecord } = require('../../Agents/agentRecord');
const roleSkill = require('../../Agents/roleSkill');
const skillRecord = require('../../Agents/skillRecord');
const overrides = require('../../Agents/rolePlaybookOverrides');
const agentAudit = require('../../Agents/agentAudit');
const runs = require('../../Agents/runs');
const knowledgeMemory = require('../../Knowledge/memory/publish');
const settings = require('./settings');

const AGENT_ROWS = 500;
const SKILL_PROMPT_MAX = 19000;
const REPLY_MAX = 1500;
const SKILL_ACTIONS = Object.freeze(['task.get', 'task.comment']);
const AUTONOMY = 1;
const SMALL_WORDS = Object.freeze({ it: 'IT' });

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const find = async (companyId, type, data) => ((await MongoDbCrudOpration(companyId, { type, data }, 'find')) || []).map(plain);
const madeBy = (blueprint) => `team-pack:${blueprint}`;
const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
const idsOf = (agent) => [...new Set((agent.projectIds || []).map(String))];

const blueprintLabel = (blueprint) => String(blueprint).split('-')
    .map((word, i) => SMALL_WORDS[word] || (i === 0 ? `${word[0].toUpperCase()}${word.slice(1)}` : word)).join(' ');

const agentName = (role) => `${role.name} · ${blueprintLabel(role.blueprint)}`.slice(0, 80);

const skillKeyOf = (role) => ['role', role.slug].join('.');

/* The skill is one per role and company, written from the company's current playbook text; an edited copy a person
 * made of it is theirs and is not overwritten. */
async function ensureSkill(companyId, role, actorId) {
    const key = skillKeyOf(role);
    if (await skillRecord.findData(companyId, key)) return key;
    const body = await overrides.findFor(companyId, role.blueprint, role.slug);
    await skillRecord.createSkill(companyId, {
        key,
        name: role.name,
        description: roleSkill.skillDescription(role),
        gather: [{ reader: 'task', params: { maxChars: 6000 } }],
        prompt: {
            partials: ['in_tool', 'data_not_instructions', 'ground_in_data'],
            instructions: ((body || role).body).slice(0, SKILL_PROMPT_MAX),
            template: 'TASK: {{gather.task.title}}\n\n{{gather.task.brief}}',
            output: '{"reply":"what you did or recommend, in plain sentences"}',
            maxTokens: 2000,
        },
        emit: [{ action: 'task.comment', label: `Post the ${role.name}'s reply`, params: { body: `{{answer.reply | clip:${REPLY_MAX}}}` } }],
        summary: '{{answer.reply | clip:300}}',
    }, { createdBy: actorId });
    return key;
}

const sameRole = (agent, roleKey, projectIds) => agent.role === roleKey && sameIds(idsOf(agent), projectIds);

/* One agent per role for exactly these projects. A role that already has an agent for the same projects is left as it
 * is, whoever made that agent. The agents start below L3, which is what keeps them off every schedule until a person
 * raises their autonomy; routed work reaches them at once because they are not paused. */
async function create(companyId, roleKeys, projectIds, actorId) {
    const existing = await find(companyId, SCHEMA_TYPE.AGENTS, [{ role: { $in: roleKeys }, deletedStatusKey: { $ne: 1 } }, { role: 1, projectIds: 1, name: 1 }, { limit: AGENT_ROWS }]);
    const made = [];
    const kept = [];
    for (const key of roleKeys) {
        const have = existing.find((agent) => sameRole(agent, key, projectIds));
        if (have) {
            kept.push({ roleKey: key, agentId: String(have._id), name: have.name || '' });
            continue;
        }
        const role = settings.roleOf(key);
        const skill = await ensureSkill(companyId, role, actorId);
        const saved = await createAgentRecord(companyId, {
            name: agentName(role),
            description: roleSkill.skillDescription(role),
            role: key,
            projectIds,
            skills: [{ key: skill, name: role.name, enabled: true }],
            allowedActions: [...SKILL_ACTIONS],
            autonomy: AUTONOMY,
            trigger: 'mention',
            madeBy: madeBy(role.blueprint),
        }, { ownerId: actorId });
        made.push({ roleKey: key, agentId: String(saved._id), name: saved.name });
    }
    return { made, kept };
}

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const count = (companyId, type, match) => MongoDbCrudOpration(companyId, { type, data: [match] }, 'countDocuments').then((n) => Number(n) || 0);

/* Work the agent has done or been handed: a run of its own, or a task in a role queue that names it. */
const hasWorked = async (companyId, agentId) => {
    const id = String(agentId);
    const [ran, handed] = await Promise.all([
        count(companyId, SCHEMA_TYPE.AGENT_RUNS, { agentId: id }),
        count(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, { 'facts.agentId': id }),
    ]);
    return ran + handed > 0;
};

/* Removes the agents a pack made, as its answer listed them, when nobody has used them. An agent that has worked, was
 * not made by this pack, or reaches a project outside the ones the undo was checked for, stays and is named. */
async function remove(companyId, blueprint, agentIds, projectIds, actor) {
    const removed = [];
    const kept = [];
    for (const id of agentIds) {
        const agent = plain(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: oid(id), deletedStatusKey: { $ne: 1 } }] }, 'findOne'));
        if (!agent) continue;
        const entry = { agentId: String(agent._id), name: agent.name || '' };
        let why = '';
        if (agent.madeBy !== madeBy(blueprint)) why = 'not_made_by_pack';
        else if (!idsOf(agent).every((one) => projectIds.includes(one))) why = 'other_projects';
        else if (await hasWorked(companyId, agent._id)) why = 'has_worked';
        if (why) {
            kept.push({ ...entry, why });
            continue;
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: [{ _id: agent._id }, { $set: { deletedStatusKey: 1, deletedAt: new Date(), deletedBy: String(actor.id), paused: true, pausedReason: 'deleted' } }],
        }, 'updateOne');
        await agentAudit.recordAgentDeleted(companyId, { kind: 'human', userId: String(actor.id) }, { agentId: entry.agentId, agentName: entry.name });
        runs.emitAgent(companyId, { agentId: entry.agentId, deleted: true });
        knowledgeMemory.agentDeleted(companyId, entry.agentId);
        removed.push(entry);
    }
    return { removed, kept };
}

module.exports = { agentName, skillKeyOf, create, remove, hasWorked };
