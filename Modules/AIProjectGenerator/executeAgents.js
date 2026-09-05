// What execute does beyond creating the project: the split, defaults for
// person tasks, the brief on the project, the Guide agent, and the runs for
// agent-labelled tasks. Kept apart from the orchestrator so it can be tested
// without its creation dependencies.
'use strict';

const logger = require('../../Config/loggerConfig');
const planRules = require('./planRules');
const { attachSplit, loadLiveAgents } = require('./planSplit');
const { normaliseGuide } = require('./guideController');

const EDITORJS_VERSION = '2.30.7';
const SPRINT_DUE_WEEKDAY_OFFSET = 4;
const GUIDE_ACTIONS = ['task.get', 'task.comment', 'subtask.create'];
const GUIDE_AUTONOMY = 1;

const text = (v) => String(v == null ? '' : v);
const assumptionTexts = (assumptions) => (Array.isArray(assumptions) ? assumptions : [])
    .map((a) => (typeof a === 'string' ? a : a && a.text)).map(text).map((t) => t.trim()).filter(Boolean);

/* Markdown headings, bullets and paragraphs into Editor.js blocks — enough
 * for the brief the /brief step produces. */
const markdownToBlocks = (markdown) => {
    const blocks = [];
    let list = null;
    const flushList = () => { if (list) { blocks.push({ type: 'list', data: { style: 'unordered', items: list } }); list = null; } };
    text(markdown).replace(/\r\n/g, '\n').split('\n').forEach((raw) => {
        const line = raw.trim();
        if (!line) { flushList(); return; }
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) { flushList(); blocks.push({ type: 'header', data: { text: heading[2].trim(), level: Math.min(4, heading[1].length + 1) } }); return; }
        const bullet = line.match(/^[-*+]\s+(.*)$/);
        if (bullet) { list = list || []; list.push({ content: bullet[1].trim(), items: [] }); return; }
        flushList();
        blocks.push({ type: 'paragraph', data: { text: line } });
    });
    flushList();
    return blocks;
};

const blocksToText = (blocks) => blocks.flatMap((b) => {
    if (b.type === 'list') return b.data.items.map((i) => i.content);
    return [b.data.text];
}).join('\n').trim();

/* The project's description: the approved brief, with an Assumptions section
 * appended unless the brief already carries one. */
const briefDescription = ({ approvedBrief, assumptions }) => {
    const lines = assumptionTexts(assumptions);
    const hasSection = /^#{1,6}\s+assumptions\b/im.test(text(approvedBrief));
    const markdown = [text(approvedBrief).trim(), lines.length && !hasSection ? `\n## Assumptions\n${lines.map((l) => `- ${l}`).join('\n')}` : ''].filter(Boolean).join('\n');
    const blocks = markdownToBlocks(markdown);
    return { description: blocksToText(blocks), descriptionBlock: { time: Date.now(), version: EDITORJS_VERSION, blocks } };
};

/* Fields written onto the project doc for the new flow; empty for a legacy execute. */
const projectFields = ({ approvedBrief, assumptions, guide }) => {
    const fields = {};
    if (text(approvedBrief).trim()) Object.assign(fields, briefDescription({ approvedBrief, assumptions }));
    if (Array.isArray(assumptions) && assumptions.length) fields.aiAssumptions = assumptions.map((a) => (typeof a === 'string' ? { point: null, text: a } : { point: a && a.point ? String(a.point) : null, text: text(a && a.text) })).filter((a) => a.text);
    const stored = normaliseGuide(guide);
    if (stored) fields.aiGuide = stored;
    return fields;
};

/* Sprints are the consecutive weeks the orchestrator names them after; the
 * due date is that week's Friday, end of day, local time. */
const dueDateInSprint = (sprintIndex, from = new Date()) => {
    const day = planRules.mondayOf(from);
    day.setDate(day.getDate() + sprintIndex * 7 + SPRINT_DUE_WEEKDAY_OFFSET);
    day.setHours(23, 59, 0, 0);
    return day.toISOString();
};

const personDefaults = (task, { sprintIndex, fallbackAssignee, from }) => {
    if (!task.split || task.split.label !== 'person') return task;
    const assignees = Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId.filter(Boolean) : [];
    return {
        ...task,
        AssigneeUserId: assignees.length || !fallbackAssignee ? assignees : [String(fallbackAssignee)],
        DueDate: task.DueDate || dueDateInSprint(sprintIndex, from),
    };
};

const withPersonDefaults = (plan, { fallbackAssignee, from } = {}) => ({
    ...plan,
    sprints: (plan.sprints || []).map((sprint, sprintIndex) => ({
        ...sprint,
        tasks: (sprint.tasks || []).map((task) => {
            const t = personDefaults(task, { sprintIndex, fallbackAssignee, from });
            return Array.isArray(t.subtasks) ? { ...t, subtasks: t.subtasks.map((s) => personDefaults(s, { sprintIndex, fallbackAssignee, from })) } : t;
        }),
    })),
});

/* The split and the person defaults, recomputed on the server: the labels the
 * client shows are never trusted, and a pause since /plan must surface as a
 * refusal rather than a quiet relabel. */
const prepare = async ({ plan, companyId, assumptions, fallbackAssignee, from }) => {
    const agents = await loadLiveAgents(companyId, { includePaused: true });
    const labelled = await attachSplit(plan, { companyId, assumptions, agents });
    return { plan: withPersonDefaults(labelled, { fallbackAssignee, from }), agents };
};

/* createTasksForSprint inserts every parent first, then the sub-tasks in the
 * order they were flattened; pairing by position gives each plan entry its doc. */
const pairDocs = (planTasks, docs) => {
    const parents = planTasks.map((planTask, i) => ({ planTask, doc: docs[i] }));
    let cursor = planTasks.length;
    const subs = planTasks.flatMap((planTask) => (Array.isArray(planTask.subtasks) ? planTask.subtasks : []).map((sub) => ({ planTask: sub, doc: docs[cursor++] })));
    return parents.concat(subs).filter((p) => p.doc);
};

const createGuideAgent = async ({ companyId, projectId, projectName, ownerId }) => {
    const { createAgentRecord } = require('../Agents/agentRecord');
    return createAgentRecord(companyId, {
        name: `${text(projectName).trim().slice(0, 70) || 'Project'} Guide`,
        description: 'Answers "what next" on any task in this project from its stored guide and plan. Mention it in a comment.',
        skills: [{ key: 'project.guide', name: 'Project Guide', enabled: true }],
        allowedActions: GUIDE_ACTIONS,
        projectIds: [String(projectId)],
        autonomy: GUIDE_AUTONOMY,
        trigger: 'mention',
    }, { ownerId });
};

const queueRuns = async ({ companyId, uid, projectId, pairs, agents }) => {
    const runs = require('../Agents/runs');
    const proposals = require('../Agents/proposals');
    const actions = require('../Agents/actions');
    const byId = new Map(agents.map((a) => [String(a._id), a]));
    let runsQueued = 0;
    const runsRefused = [];
    for (const { planTask, doc } of pairs) {
        const split = planTask.split;
        if (!split || split.label !== 'agent') continue;
        const taskId = String(doc._id);
        const agent = byId.get(String(split.agentId));
        if (!agent) { runsRefused.push({ taskId, reason: 'The agent is no longer available.' }); continue; }
        if (Array.isArray(agent.projectIds) && agent.projectIds.length && !agent.projectIds.map(String).includes(String(projectId))) {
            runsRefused.push({ taskId, reason: 'This agent is not scoped to that project.' });
            continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const check = await runs.canStart(agent, { trigger: 'assignment', companyId });
        if (!check.ok) { runsRefused.push({ taskId, reason: check.reason }); continue; }
        // eslint-disable-next-line no-await-in-loop
        const run = await runs.create(companyId, {
            agent, taskId, projectId, skill: split.skill, trigger: 'assignment', startedBy: uid, viaAccount: agent.account,
            note: `Queued from the AI project plan — ${split.reason}`,
        });
        const actor = { kind: 'agent', userId: String(uid), agentId: String(agent._id), agentName: agent.name, runId: String(run._id), viaAccount: run.viaAccount, tokenId: null };
        setImmediate(() => {
            Promise.resolve(runs.executeSkill(companyId, run, agent, doc, { proposals, actions, actor }))
                .catch((e) => logger.error(`[AIPG] run ${run._id} failed to start: ${e && e.message ? e.message : e}`));
        });
        runsQueued += 1;
    }
    return { runsQueued, runsRefused };
};

/* Everything after the tasks exist. Never throws: the project is already
 * created, and a failure here must not roll it back. */
const start = async ({ companyId, uid, projectId, projectName, pairs, agents, withGuide }) => {
    const out = { guideAgentId: null, runsQueued: 0, runsRefused: [] };
    if (withGuide) {
        try {
            const agent = await createGuideAgent({ companyId, projectId, projectName, ownerId: uid });
            out.guideAgentId = String(agent._id);
        } catch (e) { logger.error(`[AIPG] guide agent not created: ${e && e.message ? e.message : e}`); }
    }
    try {
        Object.assign(out, await queueRuns({ companyId, uid, projectId, pairs, agents }));
    } catch (e) { logger.error(`[AIPG] agent runs not queued: ${e && e.message ? e.message : e}`); }
    return out;
};

module.exports = { prepare, projectFields, pairDocs, start, createGuideAgent, queueRuns, withPersonDefaults, dueDateInSprint, briefDescription, markdownToBlocks, GUIDE_ACTIONS, GUIDE_AUTONOMY };
