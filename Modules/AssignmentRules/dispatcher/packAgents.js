const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const agentRecord = require('../../Agents/agentRecord');
const roleSkill = require('../../Agents/roleSkill');
const skillRecord = require('../../Agents/skillRecord');
const overrides = require('../../Agents/rolePlaybookOverrides');
const agentAudit = require('../../Agents/agentAudit');
const runs = require('../../Agents/runs');
const registry = require('../../Agents/registry');
const knowledgeMemory = require('../../Knowledge/memory/publish');
const settings = require('./settings');
const { RuleError } = require('../rules');

const SKILL_PROMPT_MAX = 19000;
const REPLY_MAX = 1500;
const SKILL_ACTIONS = Object.freeze(['task.get', 'task.comment']);
const AUTONOMY = 1;
const PAUSED_REASON = 'team_pack';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const OPEN_RUNS = Object.freeze(['queued', 'running', 'waiting_approval']);
const SMALL_WORDS = Object.freeze({ it: 'IT' });

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const find = async (companyId, type, data) => ((await MongoDbCrudOpration(companyId, { type, data }, 'find')) || []).map(plain);
const madeBy = (blueprint) => `team-pack:${blueprint}`;
const idsOf = (agent) => [...new Set((agent.projectIds || []).map(String))];

const blueprintLabel = (blueprint) => String(blueprint).split('-')
    .map((word, i) => SMALL_WORDS[word] || (i === 0 ? `${word[0].toUpperCase()}${word.slice(1)}` : word)).join(' ');

const agentName = (role) => `${role.name} · ${blueprintLabel(role.blueprint)}`.slice(0, 80);

const skillKeyOf = (role) => ['role', role.slug].join('.');

/* The skill is one per role and company, written from the company's current playbook text; an edited copy a person
 * made of it is theirs and is not overwritten. */
async function skillInputFor(companyId, role) {
    const key = skillKeyOf(role);
    if (await skillRecord.findData(companyId, key)) return null;
    const body = await overrides.findFor(companyId, role.blueprint, role.slug);
    const input = {
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
    };
    const checked = skillRecord.validateSkill(input);
    if (!checked.ok) throw new RuleError(`The skill for ${role.name} cannot be made from its playbook.`, 400);
    return input;
}

/* The playbook names MCP tools; the ones the registry does not know as agent actions are left out by allowedActionsToStore. */
const actionsOf = (role) => registry.allowedActionsToStore([...new Set([...SKILL_ACTIONS, ...role.tools, ...role.toolsOptional])]);

/* An agent with no projects named may work in any, so it already covers every project. */
const overlaps = (agent, projectIds) => !idsOf(agent).length || idsOf(agent).some((id) => projectIds.includes(id));

/* A role that already has an agent whose projects overlap these, whoever made it, reuses and widens that agent rather
 * than getting a second one. */
async function plan(companyId, roleKeys, projectIds) {
    const existing = await find(companyId, SCHEMA_TYPE.AGENTS, [{ role: { $in: roleKeys }, deletedStatusKey: { $ne: 1 } }, { role: 1, projectIds: 1, name: 1 }, { sort: { createdAt: 1, _id: 1 } }]);
    const reuse = [];
    const create = [];
    for (const key of roleKeys) {
        const have = existing.find((agent) => agent.role === key && overlaps(agent, projectIds));
        if (have) {
            reuse.push({ roleKey: key, agent: have, missing: idsOf(have).length ? projectIds.filter((id) => !idsOf(have).includes(id)) : [] });
            continue;
        }
        const role = settings.roleOf(key);
        create.push({ roleKey: key, role, skill: await skillInputFor(companyId, role) });
    }
    return { projectIds, reuse, create };
}

/* A new agent starts paused and with no mention trigger, so neither a mention nor routed work reaches it until a person
 * switches it on. Each write is handed to `written`, which takes it back if a later step of the pack fails. */
async function write(companyId, planned, actorId, written) {
    const kept = [];
    const widened = [];
    const made = [];
    for (const { roleKey, agent, missing } of planned.reuse) {
        if (missing.length) {
            await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: agent._id }, { $addToSet: { projectIds: { $each: missing } } }] }, 'updateOne');
            written.done(`the projects of the agent ${agent.name || agent._id}`, () => MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.AGENTS, data: [{ _id: agent._id }, { $pull: { projectIds: { $in: missing } } }],
            }, 'updateOne'));
            runs.emitAgent(companyId, { agentId: String(agent._id) });
            widened.push({ roleKey, agentId: String(agent._id), name: agent.name || '', projectIds: missing });
        }
        kept.push({ roleKey, agentId: String(agent._id), name: agent.name || '' });
    }
    const madeSkills = new Set();
    for (const { roleKey, role, skill } of planned.create) {
        if (skill && !madeSkills.has(skill.key)) {
            const saved = await skillRecord.createSkill(companyId, skill, { createdBy: actorId });
            madeSkills.add(skill.key);
            written.done(`the skill ${skill.key}`, () => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SKILLS, data: [{ _id: saved._id }] }, 'deleteOne'));
        }
        const saved = await agentRecord.createAgentRecord(companyId, {
            name: agentName(role),
            description: roleSkill.skillDescription(role),
            role: roleKey,
            projectIds: [...planned.projectIds],
            skills: [{ key: skillKeyOf(role), name: role.name, enabled: true }],
            allowedActions: actionsOf(role),
            autonomy: AUTONOMY,
            paused: true,
            pausedReason: PAUSED_REASON,
            pausedAt: new Date(),
            madeBy: madeBy(role.blueprint),
        }, { ownerId: actorId });
        const by = { kind: 'human', userId: String(actorId) };
        written.done(`the agent ${saved.name}`, async () => {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.AGENTS, data: [{ _id: saved._id }, { $set: { deletedStatusKey: 1, deletedAt: new Date(), deletedBy: String(actorId), paused: true, pausedReason: 'deleted' } }],
            }, 'updateOne');
            await agentAudit.recordAgentDeleted(companyId, by, { agentId: String(saved._id), agentName: saved.name });
            runs.emitAgent(companyId, { agentId: String(saved._id), deleted: true });
        });
        await agentAudit.recordAgentCreated(companyId, by, { agentId: String(saved._id), agentName: saved.name, madeBy: madeBy(role.blueprint) });
        made.push({ roleKey, agentId: String(saved._id), name: saved.name });
    }
    return { made, kept, widened, skills: [...madeSkills] };
}

const ignoreTakeBack = { done: () => {} };
const create = async (companyId, roleKeys, projectIds, actorId) => write(companyId, await plan(companyId, roleKeys, projectIds), actorId, ignoreTakeBack);

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

const isRunning = async (companyId, agentId) => (await count(companyId, SCHEMA_TYPE.AGENT_RUNS, { agentId: String(agentId), status: { $in: OPEN_RUNS } })) > 0;

/* The pack's own create writes the first revision; any later one is a person's save or rollback. */
const isEdited = async (companyId, agentId) => (await count(companyId, SCHEMA_TYPE.AGENT_REVISIONS, { agentId: String(agentId) })) > 1;

const whyKept = async (companyId, agent, blueprint, projectIds) => {
    if (agent.madeBy !== madeBy(blueprint)) return 'not_made_by_pack';
    if (!idsOf(agent).every((one) => projectIds.includes(one))) return 'other_projects';
    if (await isRunning(companyId, agent._id)) return 'running';
    if (await isEdited(companyId, agent._id)) return 'edited';
    if (await hasWorked(companyId, agent._id)) return 'has_worked';
    return '';
};

async function remove(companyId, blueprint, agentIds, projectIds, actor) {
    const removed = [];
    const kept = [];
    for (const id of agentIds) {
        const agent = plain(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: oid(id), deletedStatusKey: { $ne: 1 } }] }, 'findOne'));
        if (!agent) continue;
        const entry = { agentId: String(agent._id), name: agent.name || '' };
        const why = await whyKept(companyId, agent, blueprint, projectIds);
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

async function dropUnusedSkills(companyId, keys) {
    const dropped = [];
    for (const key of [...new Set(keys || [])]) {
        const users = await count(companyId, SCHEMA_TYPE.AGENTS, { deletedStatusKey: { $ne: 1 }, skills: { $elemMatch: { key } } });
        if (users) continue;
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SKILLS, data: [{ key }] }, 'deleteOne');
        dropped.push(key);
    }
    return dropped;
}

async function narrow(companyId, widened) {
    const narrowed = [];
    for (const { agentId, projectIds } of widened) {
        if (!OBJECT_ID.test(String(agentId)) || !(projectIds || []).length) continue;
        const result = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS, data: [{ _id: oid(agentId), deletedStatusKey: { $ne: 1 } }, { $pull: { projectIds: { $in: projectIds.map(String) } } }],
        }, 'updateOne');
        if (result && (result.modifiedCount || result.nModified)) {
            runs.emitAgent(companyId, { agentId: String(agentId) });
            narrowed.push({ agentId: String(agentId), projectIds: projectIds.map(String) });
        }
    }
    return narrowed;
}

module.exports = { agentName, skillKeyOf, plan, write, create, remove, narrow, dropUnusedSkills, hasWorked };
