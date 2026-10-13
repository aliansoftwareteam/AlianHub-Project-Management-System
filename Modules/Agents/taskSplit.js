// The agent/person split, shared by the project generator and the router.
// What a task is comes from workKinds.js; what a skill needs comes from the
// skill manifest through skills/inputRules.js — neither is restated here.

const { WORK_KINDS, FALLBACK_KIND, READ_ACTIONS, classifyTask, indexSkills, words, text } = require('./workKinds');
const { missingInputFor } = require('./skills/inputRules');
const codeSkills = require('./skills');

const CODE_SKILL_INDEX = indexSkills(codeSkills.ALL);

const skillKeys = (agent) => (Array.isArray(agent.skills) ? agent.skills : [])
    .filter((s) => !(s && typeof s === 'object' && s.enabled === false))
    .map((s) => text(s && typeof s === 'object' ? (s.key || s.slug || s.name) : s).toLowerCase())
    .filter(Boolean);

const allowed = (agent) => (Array.isArray(agent.allowedActions) ? agent.allowedActions : []);
const canDo = (agent, action) => { const list = allowed(agent); return list.length ? list.includes(action) : true; };

const coversWork = (agent, work) => {
    const needed = work.actions.filter((a) => !READ_ACTIONS.includes(a));
    return !needed.length || needed.some((a) => canDo(agent, a));
};

const scopedTo = (agent, task) => {
    const projectId = task && task.ProjectID;
    if (!projectId || !Array.isArray(agent.projectIds) || !agent.projectIds.length) return true;
    return agent.projectIds.map(String).includes(String(projectId));
};

const skillFitsWork = (skill, work) => {
    const own = words(skill);
    return work.skills.some((w) => own.some((o) => o.includes(w) || w.includes(o)));
};

const person = (reason) => ({ label: 'person', skill: null, reason, need: null, agentId: null, agentName: null });

/* One task against the workspace's live agents. An agent takes the task only
 * through a named, runnable skill whose input the task already carries;
 * "agent-after" names the input a person still has to add. */
const splitFor = ({ task = {}, agents = [], skills = null } = {}) => {
    const work = classifyTask(task);
    if (work.needsPerson) return person(work.why);
    const index = skills ? indexSkills(skills) : CODE_SKILL_INDEX;
    let after = null;
    for (const agent of agents) {
        if (!agent || !scopedTo(agent, task) || !canDo(agent, 'task.get') || !coversWork(agent, work)) continue;
        for (const key of skillKeys(agent)) {
            const entry = index.get(key);
            if (!entry || !skillFitsWork(key, work)) continue;
            const missing = missingInputFor(entry, task);
            if (!missing) {
                return { label: 'agent', skill: key, reason: `${agent.name || 'An agent'} can run ${key} on it`, need: null, agentId: String(agent._id || ''), agentName: agent.name || '' };
            }
            if (!after) after = { label: 'agent-after', skill: key, reason: `${agent.name || 'An agent'} could run ${key} once a person adds what it needs — ${missing.reason}`, need: missing.code, agentId: String(agent._id || ''), agentName: agent.name || '' };
        }
    }
    if (after) return after;
    if (work.kind === 'general') return person('no agent here has a skill for this kind of work');
    return person(`no agent here has a skill that would ${work.label}`);
};

const splitSummary = (splits = []) => splits.reduce((acc, s) => {
    if (!s) return acc;
    if (s.label === 'agent') acc.agent += 1;
    else if (s.label === 'agent-after') acc.agentAfter += 1;
    else acc.person += 1;
    return acc;
}, { agent: 0, agentAfter: 0, person: 0 });

module.exports = { WORK_KINDS, FALLBACK_KIND, READ_ACTIONS, classifyTask, splitFor, splitSummary, skillKeys, indexSkills };
