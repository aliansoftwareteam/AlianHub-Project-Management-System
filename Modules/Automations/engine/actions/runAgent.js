const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../../utils/mongo-handler/mongoQueries');
const skillIndex = require('../../../Agents/skills');
const logger = require('../../../../Config/loggerConfig');

// The bridge between the two engines (ADR 002): an agent is one more automation
// action, not a second system. A rule-triggered run goes through the same
// runs.create → executeSkill path as a manual one, so the agent's pause switch,
// spend cap, daily limit, allowed actions, audit rows and undo all apply.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const refuse = (reason) => {
    const err = new Error(reason);
    err.deterministic = true;
    return err;
};

const findAgent = (companyId, ref) => {
    const wanted = String(ref || '').trim();
    if (!wanted) return null;
    const match = OBJECT_ID.test(wanted)
        ? { _id: new mongoose.Types.ObjectId(wanted) }
        : { name: new RegExp(`^${escapeRe(wanted)}$`, 'i') };
    return MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ ...match, deletedStatusKey: { $ne: 1 } }] }, 'findOne');
};

const ruleOwner = async (companyId, ruleId) => {
    if (!OBJECT_ID.test(String(ruleId || ''))) return null;
    const rule = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: new mongoose.Types.ObjectId(String(ruleId)) }, 'createdBy'] }, 'findOne').catch(() => null);
    return rule && rule.createdBy ? String(rule.createdBy) : null;
};

const recordLoopRefusal = (companyId, agent, { taskId, context, check }) => require('../../../Agents/agentAudit').recordRefusal(companyId,
    { kind: 'agent', userId: null, agentId: String(agent._id), agentName: agent.name, runId: null, viaAccount: agent.account, tokenId: null },
    { action: 'run.start', reason: check.reason, entityId: taskId, params: { ruleId: context.ruleId, ruleName: context.ruleName, eventId: context.eventId || null, depth: check.depth, maxDepth: check.maxDepth } });

module.exports = {
    key: 'run_agent',
    label: 'Run an AI agent',
    appliesTo: ['task'],
    scopes: ['task.read', 'task.subtask.create', 'task.comment'],
    schema: {
        agent: { type: 'text', label: 'Agent (name)', required: true },
        skill: { type: 'select', label: 'Skill', required: true, options: skillIndex.ALL.map((s) => s.slug) },
    },
    async run({ companyId, entity, config, context }) {
        const runs = require('../../../Agents/runs');
        const proposals = require('../../../Agents/proposals');
        const actions = require('../../../Agents/actions');
        const task = context.task || {};

        if (!String(config.agent || '').trim()) throw refuse('This rule does not name an agent — pick one so its pause switch, spend cap and allowed actions apply.');
        const agent = await findAgent(companyId, config.agent);
        if (!agent) throw refuse(`No agent named "${config.agent}" in this workspace.`);
        const check = await runs.canStart(agent, { trigger: 'rule', companyId, depth: context.depth });
        if (!check.ok) {
            if (check.code === runs.LOOP_DEPTH_EXCEEDED) await recordLoopRefusal(companyId, agent, { taskId: entity.id, context, check });
            throw refuse(`${agent.name} cannot run: ${check.reason}`);
        }
        if (agent.projectIds && agent.projectIds.length && !agent.projectIds.map(String).includes(String(task.ProjectID))) {
            throw refuse(`${agent.name} is not scoped to this project.`);
        }

        const startedBy = await ruleOwner(companyId, context.ruleId);
        // The automation run id is stable across redeliveries of the same job,
        // so a retried job finds the agent run its first delivery started.
        const { run, deduplicated } = await runs.start(companyId, {
            agent, taskId: entity.id, projectId: task.ProjectID, skill: runs.skillSlugOf(agent, config.skill), trigger: 'rule',
            startedBy, viaAccount: agent.account, note: context.ruleName ? `rule "${context.ruleName}"` : null, ref: context.runId,
            triggerDepth: context.depth, triggerEventId: context.eventId,
        });
        const base = { runId: String(run._id), agent: agent.name, skill: run.skill, status: run.status };
        if (deduplicated) {
            logger.debug(`[automation-engine] run_agent: automation run ${context.runId} already started agent run ${run._id} (${run.status})`);
            return { ...base, changed: false, verdict: 'deduplicated', reason: 'A run for this agent and task is already in progress.' };
        }
        const actor = { kind: 'agent', userId: startedBy, agentId: String(agent._id), agentName: agent.name, runId: String(run._id), viaAccount: run.viaAccount, tokenId: null };
        const out = await runs.executeSkill(companyId, run, agent, task, { proposals, actions, actor });
        base.status = out.status;
        if (out.status === runs.STATUS.SKIPPED) return { ...base, changed: false, verdict: 'skipped', reason: out.outcome };
        if (out.status === runs.STATUS.FAILED) throw refuse(out.error || out.outcome || 'agent run failed');
        if (out.status === 'abandoned') return { ...base, changed: false, verdict: 'stopped', reason: out.outcome };
        if (out.status === runs.STATUS.WAITING) return { ...base, changed: false, verdict: 'proposed', proposalId: out.proposalId };
        return { ...base, changed: out.status === runs.STATUS.DONE, verdict: 'applied', outcome: out.outcome, refusals: out.refusals || 0 };
    },
};
