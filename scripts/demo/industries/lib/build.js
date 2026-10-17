const crypto = require('crypto');
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MARK, emailFor, isShowcasePerson } = require('./guard');
const {
    OWNER, validateScenario, taskRef, projectOf, agentOf, statusOf, fullName, guideMarkdown, rolesIn, ownWorkflow, stepsBeforeGate, shortName,
} = require('./scenario');

const randomPassword = () => crypto.randomBytes(18).toString('base64url');
const listOf = (value) => (Array.isArray(value) ? value : []);
const tagUid = (projectCode, name) => `${projectCode.toLowerCase()}-${name}`.replace(/[^a-z0-9-]/g, '').slice(0, 40);
const DAY_MS = 24 * 60 * 60 * 1000;
// A seeded approval outlives the engine's three-day default, so a demo between nightly resets never shows it expired.
const APPROVAL_DEADLINE_MS = 7 * DAY_MS;

const playbooks = () => require('../../../../Modules/Agents/rolePlaybooks');
const roleExists = (key) => {
    const [blueprint, slug] = String(key).split('/');
    return Boolean(playbooks().find(blueprint, slug));
};
const roleName = (key) => {
    const [blueprint, slug] = String(key).split('/');
    const role = playbooks().find(blueprint, slug);
    return role ? role.name : key;
};
const workflowTemplates = () => require('../../../../Modules/Workflows/templates');
const templateExists = (key) => Boolean(workflowTemplates().find(key));
const templateName = (key) => (workflowTemplates().find(key) || { name: key }).name;

const assertCoherent = (scenario) => {
    const problems = validateScenario(scenario, { roleExists, templateExists });
    if (problems.length) throw new Error(`The ${scenario.key} scenario is not coherent:\n  ${problems.join('\n  ')}`);
};

const actionOfChange = (change) => {
    if (change.comment !== undefined) return 'task.comment';
    if (change.assign) return 'task.assign';
    if (change.subtask) return 'subtask.create';
    return 'task.update';
};

/* The change a proposal asks for, written as the agent action it is. */
const changeOf = (change, { taskId, people }) => {
    if (change.comment !== undefined) return { action: 'task.comment', params: { taskId, body: change.comment }, label: 'Post a comment' };
    if (change.priority) return { action: 'task.update', params: { taskId, fields: { Task_Priority: change.priority } }, label: `Set priority to ${change.priority}` };
    if (change.assign) return { action: 'task.assign', params: { taskId, assigneeIds: change.assign.map((key) => people[key].userId) }, label: `Assign ${change.assign.map((key) => people[key].name).join(' and ')}` };
    if (change.subtask) return { action: 'subtask.create', params: { taskId, title: change.subtask.title, description: change.subtask.description || '' }, label: `Add the subtask "${change.subtask.title}"` };
    if (change.due !== undefined) {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() + Number(change.due));
        return { action: 'task.update', params: { taskId, fields: { DueDate: date.toISOString() } }, label: 'Move the due date' };
    }
    throw new Error('a proposal change does nothing');
};

const ruleStep = (step, index, { people, project }) => {
    const id = `s${index + 1}`;
    if (step.comment !== undefined) return { id, type: 'action', action: 'add_comment', config: { body: step.comment } };
    if (step.priority) return { id, type: 'action', action: 'set_priority', config: { priority: step.priority } };
    if (step.assign) return { id, type: 'action', action: 'assign', config: { mode: 'add', userIds: step.assign.map((key) => people[key].userId) } };
    if (step.notify) return { id, type: 'action', action: 'notify', config: { recipients: step.notify.people.map((key) => people[key].userId), message: step.notify.message } };
    if (step.status) return { id, type: 'action', action: 'set_status', config: { status: step.status } };
    if (step.subtask) return { id, type: 'action', action: 'create_subtask', config: { title: step.subtask } };
    throw new Error(`an automation step in ${project.name} does nothing`);
};

/* A status condition carries its name as `label`, as the rule builder saves it; the rule's sentence reads it. */
const ruleCondition = (rule, made) => {
    if (!rule.when.statusTo) return { op: 'changedTo', field: 'Task_Priority', value: rule.when.priorityTo };
    const status = made.statuses.get(rule.when.statusTo);
    return { op: 'changedTo', field: 'statusRef', value: [`${made.projectId}:${status.key}`], label: status.name };
};

async function seedPeople({ scenario, companyId, owner, adapter, report, log }) {
    const roles = await adapter.companyRoles(companyId);
    const designationOf = await adapter.designationResolver(companyId);
    const people = { [OWNER]: { userId: owner.userId, name: owner.name, email: owner.email } };
    for (const person of listOf(scenario.people)) {
        const email = emailFor(scenario.company.domain, person);
        const existing = await adapter.findUserByEmail(email);
        if (existing && !isShowcasePerson(existing)) throw new Error(`${email} belongs to an account the demo did not create; nothing was changed.`);
        const userId = existing ? String(existing._id) : await adapter.createUser({ firstName: person.firstName, lastName: person.lastName, email, password: randomPassword() });
        await adapter.addMember({ companyId, userId, email, roleType: roles[person.role].key, designation: designationOf(person.designations || [person.title]) });
        people[person.key] = { userId, name: fullName(person), email };
        report.people += 1;
    }
    log(`  ${listOf(scenario.people).length} people`);
    return people;
}

async function seedProject({ scenario, project, companyId, owner, people, adapter }) {
    const statuses = await adapter.projectStatuses(companyId, project.statuses);
    const types = await adapter.projectTaskTypes(companyId, project.types);
    const tags = listOf(project.tags).map((tag) => ({ uid: tagUid(project.code, tag.name), tagName: tag.name, tagColor: tag.color, tagBgColor: `${tag.color}35` }));
    const memberIds = listOf(project.members).map((key) => people[key].userId);
    const projectId = await adapter.createProject({
        companyId,
        ownerId: owner.userId,
        project,
        taskStatusData: statuses,
        taskTypeCounts: types,
        memberIds,
        leadIds: [people[project.lead].userId],
        tags,
    });
    await adapter.describeProject({
        companyId,
        projectId,
        summary: project.summary,
        guide: listOf(project.stages).length ? { stages: project.stages, essentials: project.essentials, escalations: project.escalations, style: project.style } : null,
    });
    const fields = await adapter.createFields({ companyId, projectId, ownerId: owner.userId, fields: listOf(project.fields) });
    const record = await adapter.getProject(companyId, projectId);
    return {
        project,
        projectId,
        statuses: asSaved(project.statuses, statuses, listOf(record.taskStatusData).map((status) => status.convertStatus || status)),
        types: asSaved(project.types, types, listOf(record.taskTypeCounts)),
        tags: new Map(tags.map((tag) => [tag.tagName, tag.uid])),
        fields,
        tasks: new Map(),
        record,
        list: await adapter.listOf(companyId, projectId),
    };
}

/* A name the company already has keeps the company's spelling ("In Progress"), so tasks take each entry as the
 * project stored it, found by key, under the name the scenario uses. */
const asSaved = (named, merged, saved) => new Map(named.map((entry, index) => [
    entry.name,
    saved.find((stored) => String(stored.key) === String(merged[index].key)) || merged[index],
]));

async function seedTasks({ made, companyId, owner, people, adapter, report }) {
    const { project } = made;
    const actorOf = (key) => ({ id: people[key].userId, Employee_Name: people[key].name });
    const defaultType = made.types.get(project.types[0].name);
    const createOne = async (task, parentId, inherited = {}) => {
        const lead = task.lead || inherited.lead || project.lead;
        const assignees = listOf(task.assignees).length ? task.assignees : listOf(inherited.assignees);
        return adapter.createTask({
            companyId,
            project: made.record,
            list: made.list,
            actor: actorOf(lead),
            ownerId: owner.userId,
            task,
            status: made.statuses.get(task.status),
            taskType: made.types.get(task.type || inherited.type) || defaultType,
            assigneeIds: assignees.map((key) => people[key].userId),
            leaderId: people[lead].userId,
            parentId,
            tagIds: listOf(task.tags).map((tag) => made.tags.get(tag)),
            customField: adapter.fieldValues(made.fields, task.fields),
        });
    };
    for (const task of listOf(project.tasks)) {
        const taskId = await createOne(task, null);
        made.tasks.set(task.key, taskId);
        report.tasks += 1;
        for (const sub of listOf(task.subtasks)) {
            await createOne(sub, taskId, { lead: task.lead, assignees: task.assignees, type: task.type });
            report.tasks += 1;
        }
    }
}

async function seedRelations({ scenario, made, byProject, people, adapter }) {
    const actor = { id: people[made.project.lead].userId, Employee_Name: people[made.project.lead].name };
    for (const task of listOf(made.project.tasks)) {
        for (const ref of listOf(task.blockedBy)) {
            const target = taskRef(scenario, ref.includes('.') ? ref : `${made.project.key}.${ref}`);
            await adapter.relate({ companyId: made.record.CompanyId, taskId: made.tasks.get(task.key), blockedById: byProject.get(target.project.key).tasks.get(target.task.key), actor });
        }
    }
}

async function seedAgents({ scenario, companyId, owner, byProject, adapter, report, log }) {
    const agents = {};
    const proposalActions = (key) => [...new Set(listOf(scenario.story)
        .filter((event) => event.proposal === key)
        .flatMap((event) => listOf(event.changes).map(actionOfChange)))];
    for (const agent of listOf(scenario.agents)) {
        const projectIds = listOf(agent.projects).map((key) => byProject.get(key).projectId);
        let agentId;
        if (agent.role) {
            const [made] = await adapter.createRoleAgents({ companyId, roleKeys: [agent.role], projectIds, ownerId: owner.userId });
            agentId = made.agentId;
            await adapter.configureAgent({ companyId, agentId, name: agent.name || roleName(agent.role), actions: proposalActions(agent.key), spendCapUsd: 2 });
        } else {
            agentId = (await adapter.createSkillAgent({ companyId, ownerId: owner.userId, agent, projectIds })).agentId;
        }
        agents[agent.key] = await adapter.agentById(companyId, agentId);
        report.agents += 1;
    }
    log(`  ${listOf(scenario.agents).length} agents`);
    return agents;
}

async function seedAutomations({ scenario, companyId, owner, people, byProject, adapter, report }) {
    for (const rule of listOf(scenario.automations)) {
        const made = byProject.get(rule.project);
        await adapter.createRule({
            companyId,
            ownerId: owner.userId,
            rule: {
                name: rule.name,
                version: 2,
                trigger: { type: 'event', event: rule.when.statusTo ? 'task.status_changed' : 'task.priority_changed' },
                scope: { allProjects: false, projectIds: [made.projectId] },
                conditions: ruleCondition(rule, made),
                steps: listOf(rule.then).map((step, index) => ruleStep(step, index, { people, project: made.project })),
            },
        });
        report.automations += 1;
    }
}

/* The story runs in order: what people said and did, what the automations answered, and what the agents
 * (simulated) did. Each simulated run sits a few minutes before the next, newest last. */
async function playStory({ scenario, companyId, owner, people, agents, byProject, adapter, report }) {
    const events = listOf(scenario.story);
    let minutesAgo = events.length * 7 + 15;
    for (const event of events) {
        const target = taskRef(scenario, event.comment || event.move || event.task);
        const made = byProject.get(target.project.key);
        const taskId = made.tasks.get(target.task.key);
        minutesAgo -= 7;
        if (event.comment !== undefined) {
            await adapter.personComment({ companyId, project: made.record, taskId, userId: people[event.by].userId, text: event.text });
            report.comments += 1;
        } else if (event.move !== undefined) {
            await adapter.moveTask({ companyId, project: made.record, taskId, status: made.statuses.get(event.to), actor: { id: people[event.by].userId, Employee_Name: people[event.by].name } });
            report.moves += 1;
        } else if (event.agentRun !== undefined) {
            const agent = agents[event.agentRun];
            const run = await adapter.simulatedRun({
                companyId, agent, taskId, projectId: made.projectId, minutesAgo, outcome: event.summary,
                actions: event.text ? [{ action: 'task.comment', taskId: String(taskId), at: new Date() }] : [],
                decisions: event.text ? [{ action: 'task.comment', decision: 'act', reason: 'Low risk: a comment on the task.', rating: 'low', at: new Date() }] : [],
            });
            if (event.text) await adapter.agentComment({ companyId, agent, taskId, runId: run._id, actingUserId: owner.userId, text: event.text });
            report.simulatedRuns += 1;
        } else if (event.proposal !== undefined) {
            const agent = agents[event.proposal];
            const changes = listOf(event.changes).map((change) => changeOf(change, { taskId: String(taskId), people }));
            const run = await adapter.simulatedRun({
                companyId, agent, taskId, projectId: made.projectId, minutesAgo, outcome: event.summary, waiting: true,
                decisions: changes.map((change) => ({ action: change.action, decision: 'propose', reason: 'Needs a person: it changes the work, not just a note.', rating: 'medium', at: new Date() })),
            });
            await adapter.simulatedProposal({ companyId, agent, run, taskId, projectId: made.projectId, what: event.what, why: event.why, changes, priority: event.priority || 'normal' });
            report.proposals += 1;
        }
    }
}

async function seedGoals({ scenario, companyId, owner, byProject, adapter }) {
    for (const goal of listOf(scenario.goals)) {
        const targets = listOf(goal.targets).map((target) => (target.kind === 'tasks'
            ? {
                name: target.name,
                kind: 'tasks',
                sources: {
                    taskIds: listOf(target.tasks).map((ref) => {
                        const found = taskRef(scenario, ref);
                        return byProject.get(found.project.key).tasks.get(found.task.key);
                    }),
                    sprintIds: listOf(target.lists).map((key) => String(byProject.get(key).list._id)),
                },
            }
            : { name: target.name, kind: 'boolean', done: Boolean(target.done) }));
        await adapter.createGoal({ companyId, ownerId: owner.userId, goal: { name: goal.name, description: goal.description || '', color: goal.color || '', targets } });
    }
}

/* A scenario rule names types, statuses and tags; the dispatcher stores the project's own keys and tag ids. */
const routingRule = (scenario, rule, made) => ({
    role: agentOf(scenario, rule.agent).role,
    when: {
        ...(listOf(rule.types).length ? { taskTypeKeys: rule.types.map((name) => Number(made.types.get(name).key)) } : {}),
        ...(listOf(rule.statuses).length ? { statusKeys: rule.statuses.map((name) => Number(made.statuses.get(name).key)) } : {}),
        ...(listOf(rule.tags).length ? { tags: rule.tags.map((name) => made.tags.get(name)) } : {}),
    },
});

/* Every project with a role agent gets its dispatcher in suggest mode, its roles on and the scenario's rules. */
async function seedDispatcher({ scenario, companyId, owner, byProject, adapter, report }) {
    for (const made of byProject.values()) {
        const roles = rolesIn(scenario, made.project.key);
        if (!roles.length) continue;
        const rules = listOf((scenario.routing || {})[made.project.key]).map((rule) => routingRule(scenario, rule, made));
        await adapter.saveDispatcher({ companyId, projectId: made.projectId, userId: owner.userId, settings: { mode: 'suggest', roles, rules } });
        report.routingRules += rules.length;
    }
}

/* The dispatcher's own routing of every open task in a project that has rules: suggestions, or Needs routing. */
async function routeWork({ scenario, companyId, byProject, adapter, report }) {
    for (const made of byProject.values()) {
        if (!listOf((scenario.routing || {})[made.project.key]).length) continue;
        for (const task of listOf(made.project.tasks)) {
            const decision = await adapter.routeTask({ companyId, taskId: made.tasks.get(task.key) });
            if (decision && decision.state === 'suggested') report.suggestions += 1;
            if (decision && decision.state === 'needs_routing') report.needsRouting += 1;
        }
    }
}

/* A lead accepting the suggestion puts the task in the suggested role's queue. */
async function seedHandOvers({ scenario, companyId, people, byProject, adapter, report }) {
    for (const handOver of listOf(scenario.handOvers)) {
        const { project, task } = taskRef(scenario, handOver.task);
        await adapter.acceptSuggestion({
            companyId,
            taskId: byProject.get(project.key).tasks.get(task.key),
            actor: { id: people[handOver.by].userId, Employee_Name: people[handOver.by].name },
        });
        report.handOvers += 1;
    }
}

const workflowSteps = (scenario, own, people) => listOf(own.steps).map((step, index, steps) => {
    const dependsOn = index ? [steps[index - 1].id] : [];
    if (step.agent) return { id: step.id, type: 'role_handoff', dependsOn, config: { role: agentOf(scenario, step.agent).role } };
    return {
        id: step.id,
        type: 'human_approval',
        dependsOn,
        config: { title: step.approval.title, prompt: step.approval.prompt, ownerUserId: people[step.approval.owner].userId, deadlineMs: APPROVAL_DEADLINE_MS, onReject: 'skip' },
    };
});

/* The fitting ready-made workflows, installed switched off, and the scenario's own, switched on and run on its task.
 * The engine hands the task to each role for real; each role finishing its part before the approval is simulated. */
async function seedWorkflows({ scenario, companyId, owner, people, agents, byProject, adapter, report, log }) {
    for (const key of listOf(scenario.workflows.templates)) {
        await adapter.installTemplate({ companyId, userId: owner.userId, key });
        report.workflows += 1;
    }
    const own = ownWorkflow(scenario);
    if (!own) return;
    const definitionId = await adapter.createWorkflow({
        companyId, userId: owner.userId, definition: { name: own.name, description: own.description, steps: workflowSteps(scenario, own, people) },
    });
    report.workflows += 1;
    await adapter.enableWorkflow({ companyId, userId: owner.userId, definitionId });
    const { project, task } = taskRef(scenario, own.run.task);
    const made = byProject.get(project.key);
    const runId = await adapter.startWorkflow({
        companyId,
        userId: people[own.run.by].userId,
        definitionId,
        taskId: made.tasks.get(task.key),
        projectId: made.projectId,
        name: `${own.name} · ${shortName(task)}`,
    });
    report.workflowRuns += 1;
    for (const step of stepsBeforeGate(own)) {
        await adapter.finishHandOver({ companyId, runId, stepId: step.id, finishedBy: agents[step.agent].name });
        report.simulatedSteps += 1;
    }
    if (!(await adapter.waitingApproval({ companyId, runId }))) log(`  warning: the "${own.name}" run did not reach its approval`);
}

/* One industry company, from nothing to presentation-ready. */
async function buildShowcase({ scenario, owner, adapter, log = () => {} }) {
    assertCoherent(scenario);
    const report = {
        people: 0, projects: 0, tasks: 0, agents: 0, automations: 0, comments: 0, moves: 0, automationRuns: 0, simulatedRuns: 0, proposals: 0,
        routingRules: 0, suggestions: 0, needsRouting: 0, handOvers: 0, workflows: 0, workflowRuns: 0, simulatedSteps: 0,
    };
    const marker = { by: MARK, key: scenario.key, industry: scenario.industry, ownerId: owner.userId };
    log(`${scenario.company.name}`);
    const companyId = await adapter.createCompany({ ownerId: owner.userId, email: owner.email, name: scenario.company.name, marker });

    const people = await seedPeople({ scenario, companyId, owner, adapter, report, log });
    const byProject = new Map();
    for (const project of listOf(scenario.projects)) {
        const made = await seedProject({ scenario, project, companyId, owner, people, adapter });
        byProject.set(project.key, made);
        await seedTasks({ made, companyId, owner, people, adapter, report });
        report.projects += 1;
        log(`  ${project.name}: ${listOf(project.tasks).length} tasks`);
    }
    for (const made of byProject.values()) await seedRelations({ scenario, made, byProject, people, adapter });

    const agents = await seedAgents({ scenario, companyId, owner, byProject, adapter, report, log });
    await seedAutomations({ scenario, companyId, owner, people, byProject, adapter, report });

    const since = new Date();
    const engineOn = await adapter.startAutomations();
    try {
        await playStory({ scenario, companyId, owner, people, agents, byProject, adapter, report });
        if (engineOn) {
            const runs = await adapter.settleAutomations(companyId, since);
            report.automationRuns = runs.length;
            const failed = runs.filter((run) => run.status !== 'success');
            if (failed.length) log(`  warning: ${failed.length} automation run(s) did not succeed: ${failed.map((run) => `${run.ruleName} (${run.status})`).join(', ')}`);
        } else log('  warning: AUTOMATION_ENGINE is off, so the story\'s automations did not fire');
    } finally {
        if (engineOn) await adapter.stopAutomations();
    }

    await seedGoals({ scenario, companyId, owner, byProject, adapter });
    if (scenario.dashboard) {
        await adapter.createDashboard({ companyId, ownerId: owner.userId, projectId: byProject.get(scenario.dashboard.project).projectId, dashboard: { name: scenario.dashboard.name, cards: scenario.dashboard.cards } });
    }

    const features = adapter.features();
    const layers = { dispatcher: features.dispatcher, workflows: features.dispatcher && features.workflows && Boolean(scenario.workflows) };
    if (layers.dispatcher) await seedDispatcher({ scenario, companyId, owner, byProject, adapter, report });
    else log('  DISPATCHER is off: no routing and no Company view');
    if (layers.workflows) await seedWorkflows({ scenario, companyId, owner, people, agents, byProject, adapter, report, log });
    else if (scenario.workflows) log('  WORKFLOW_ENGINE and DISPATCHER are not both on: no workflows');
    if (layers.dispatcher) {
        await routeWork({ scenario, companyId, byProject, adapter, report });
        await seedHandOvers({ scenario, companyId, people, byProject, adapter, report });
        log(`  dispatcher: ${report.suggestions} suggestions, ${report.needsRouting} needing routing, ${report.handOvers} in role queues`);
    }
    if (layers.workflows) log(`  workflows: ${report.workflows} saved, ${report.workflowRuns} run waiting for its approval`);

    const guideProject = byProject.get(scenario.guide.project);
    const guidePageId = await adapter.createGuidePage({
        companyId,
        ownerId: owner.userId,
        projectId: guideProject.projectId,
        title: `Start here: ${scenario.company.name}`,
        markdown: guideMarkdown(scenario, { roleName, ownerName: owner.name, templateName, seeded: layers }),
    });
    await adapter.updateCompanyMarker({ companyId, marker: { ...marker, guidePageId, guideProjectId: guideProject.projectId, layers } });
    log(`  done: ${report.automationRuns} automation runs, ${report.simulatedRuns} simulated runs, ${report.proposals} proposals`);
    return { companyId, report };
}

const findShowcaseCompanies = async (adapter) => (await adapter.find(adapter.GLOBAL, SCHEMA_TYPE.COMPANIES, { 'demoShowcase.by': MARK }));

module.exports = { buildShowcase, findShowcaseCompanies, assertCoherent, roleExists, roleName, templateExists, templateName, projectOf, agentOf, statusOf };
