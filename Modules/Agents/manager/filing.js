const proposals = require('../proposals');
const findings = require('./findings');

const SYSTEM_AGENT_ID = 'project-manager';
const SYSTEM_ACTIONS = Object.freeze(['task.comment', 'task.update']);

const propose = async (companyId, project, row, finding) => {
    const { action, params, label, what, why } = finding.fix;
    const proposal = await proposals.create(companyId, {
        agent: { _id: SYSTEM_AGENT_ID, name: `System for ${project.ProjectName || 'this project'}` },
        taskId: params.taskId, projectId: String(project._id), what, why, changes: [{ action, params, label }],
        source: proposals.SOURCE_SYSTEM, allowedActions: SYSTEM_ACTIONS,
        finding: { id: String(row._id), rule: finding.rule, facts: finding.facts, projectName: project.ProjectName || '' },
    });
    await findings.attach(companyId, row, proposal._id);
};

module.exports = { SYSTEM_AGENT_ID, SYSTEM_ACTIONS, propose };
