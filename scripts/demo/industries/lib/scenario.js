/* What a scenario file may say, checked before anything is written, and the Start-here guide built from it. Pure:
 * no database, so the coherence test runs it over every scenario. */

const OWNER = 'you';
const ROLES = Object.freeze(['admin', 'member', 'guest']);
const STATUS_TYPES = Object.freeze(['default_active', 'active', 'done', 'close']);
const FIELD_TYPES = Object.freeze(['text', 'number', 'money', 'date', 'dropdown', 'checkbox']);
const PRIORITIES = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
const VIEWS = Object.freeze(['board', 'list', 'table', 'calendar', 'workload', 'dashboard', 'gantt', 'timeline', 'docs', 'comments']);
const CARDS = Object.freeze(['due_soon', 'project_pulse', 'logged_vs_estimate', 'free_capacity', 'at_risk', 'tasks_by_status', 'agent_spend']);
const SKILLS_WITHOUT_MODEL = Object.freeze(['digest.ceo']);
const HEX = /^#[0-9a-f]{6}$/i;
const CODE = /^[A-Z]{2,6}$/;
const KEY = /^[a-z][a-z0-9-]*$/;
const MAX_DASHBOARD_CARDS = 6;

const listOf = (value) => (Array.isArray(value) ? value : []);
const duplicates = (values) => values.filter((value, index) => values.indexOf(value) !== index);

const fullName = (person) => `${person.firstName} ${person.lastName}`;
const projectOf = (scenario, key) => listOf(scenario.projects).find((project) => project.key === key) || null;
const agentOf = (scenario, key) => listOf(scenario.agents).find((agent) => agent.key === key) || null;
const statusOf = (project, name) => listOf(project && project.statuses).find((status) => status.name === name) || null;

/* 'ap.inv-1042' → { project, task }; a subtask is not addressable. */
const taskRef = (scenario, ref) => {
    const [projectKey, taskKey, rest] = String(ref || '').split('.');
    const project = projectOf(scenario, projectKey);
    const task = rest === undefined && project ? listOf(project.tasks).find((t) => t.key === taskKey) || null : null;
    return task ? { project, task } : null;
};

const ROUTING_CONDITIONS = Object.freeze(['types', 'tags', 'statuses']);
const STEP_ID = /^s[A-Za-z0-9]{1,30}$/;
const CLOSED_TYPES = Object.freeze(['done', 'close']);

const statusAfterStory = (scenario, ref) => listOf(scenario.story)
    .filter((event) => event.move === ref)
    .reduce((status, event) => event.to, (taskRef(scenario, ref) || { task: {} }).task.status);

const isOpenAfterStory = (scenario, ref) => {
    const found = taskRef(scenario, ref);
    const status = found && statusOf(found.project, statusAfterStory(scenario, ref));
    return Boolean(status) && !CLOSED_TYPES.includes(status.type);
};

/* The dispatcher's first matching rule for a task as the story leaves it: every condition a rule names must hold, and
 * a list holds when the task has any of its values (Modules/AssignmentRules/dispatcher/settings.js). */
const ruleFor = (scenario, ref) => {
    const found = taskRef(scenario, ref);
    if (!found) return null;
    const { project, task } = found;
    const have = {
        types: [task.type || (listOf(project.types)[0] || {}).name],
        tags: listOf(task.tags),
        statuses: [statusAfterStory(scenario, ref)],
    };
    return listOf((scenario.routing || {})[project.key]).find((rule) => ROUTING_CONDITIONS.some((kind) => listOf(rule[kind]).length)
        && ROUTING_CONDITIONS.every((kind) => !listOf(rule[kind]).length || listOf(rule[kind]).some((value) => have[kind].includes(value)))) || null;
};

const ownWorkflow = (scenario) => (scenario.workflows && scenario.workflows.own) || null;

/* The hand-overs a role finished before the run reached its first approval: written by the seed, so simulated. */
const stepsBeforeGate = (workflow) => {
    const steps = listOf(workflow && workflow.steps);
    const gate = steps.findIndex((step) => step.approval);
    return gate < 0 ? steps : steps.slice(0, gate);
};

/* The roles the dispatcher turns on in a project: its role agents', and those the scenario's workflow hands its task
 * to when that task is in the project, since a hand-over needs its role on where the task lives. */
const rolesIn = (scenario, projectKey) => {
    const own = ownWorkflow(scenario);
    const run = own && own.run ? taskRef(scenario, own.run.task) : null;
    const keys = [
        ...listOf(scenario.agents).filter((agent) => listOf(agent.projects).includes(projectKey)).map((agent) => agent.key),
        ...(run && run.project.key === projectKey ? listOf(own.steps).filter((step) => step.agent).map((step) => step.agent) : []),
    ];
    return [...new Set(keys.map((key) => (agentOf(scenario, key) || {}).role).filter(Boolean))];
};

function validateLayers(scenario, say, { templateExists }) {
    const people = listOf(scenario.people);
    const roleOf = (key) => (key === OWNER ? 'admin' : ((people.find((person) => person.key === key) || {}).role || null));
    const roleAgent = (where, key, projectKey) => {
        const agent = agentOf(scenario, key);
        if (!agent) say(where, `agent "${key}" does not exist`);
        else if (!agent.role) say(where, `agent "${key}" has no role, so no task can be handed to it`);
        else if (projectKey && !listOf(agent.projects).includes(projectKey)) say(where, `agent "${key}" does not work in ${projectKey}`);
    };

    const routing = scenario.routing || {};
    Object.entries(routing).forEach(([projectKey, rules]) => {
        const at = `routing.${projectKey}`;
        const project = projectOf(scenario, projectKey);
        if (!project) { say(at, `project "${projectKey}" does not exist`); return; }
        if (!listOf(rules).length) say(at, 'has no rules');
        listOf(rules).forEach((rule, index) => {
            const where = `${at}.${index}`;
            roleAgent(where, rule.agent, projectKey);
            if (!ROUTING_CONDITIONS.some((kind) => listOf(rule[kind]).length)) say(where, `needs at least one of ${ROUTING_CONDITIONS.join(', ')}`);
            listOf(rule.types).forEach((name) => { if (!listOf(project.types).some((type) => type.name === name)) say(where, `type "${name}" is not one of ${projectKey}'s`); });
            listOf(rule.tags).forEach((name) => { if (!listOf(project.tags).some((tag) => tag.name === name)) say(where, `tag "${name}" is not one of ${projectKey}'s`); });
            listOf(rule.statuses).forEach((name) => { if (!statusOf(project, name)) say(where, `status "${name}" is not one of ${projectKey}'s`); });
        });
    });

    const own = ownWorkflow(scenario);
    const runTask = own && own.run ? own.run.task : null;
    duplicates(listOf(scenario.handOvers).map((handOver) => handOver.task)).forEach((ref) => say('handOvers', `"${ref}" is handed over twice`));
    listOf(scenario.handOvers).forEach((handOver, index) => {
        const at = `handOvers.${index}`;
        const target = taskRef(scenario, handOver.task);
        if (!target) { say(at, `"${handOver.task}" is not a task`); return; }
        if (!isOpenAfterStory(scenario, handOver.task)) say(at, `${handOver.task} is closed once the story has played, and the dispatcher routes only open work`);
        else if (!ruleFor(scenario, handOver.task)) say(at, `no routing rule in ${target.project.key} matches ${handOver.task}`);
        if (handOver.task === runTask) say(at, `${handOver.task} is the workflow's task, which the dispatcher leaves alone`);
        if (handOver.by !== OWNER && handOver.by !== target.project.lead) say(at, `"${handOver.by}" does not lead ${target.project.key}; the lead or ${OWNER} accepts a suggestion`);
    });

    const workflows = scenario.workflows || {};
    duplicates(listOf(workflows.templates)).forEach((key) => say('workflows.templates', `"${key}" appears twice`));
    listOf(workflows.templates).forEach((key) => { if (!templateExists(key)) say('workflows.templates', `"${key}" is not a ready-made workflow`); });
    if (!own) return;
    const at = 'workflows.own';
    if (!KEY.test(String(own.key || ''))) say(at, 'key must be lower-case letters, digits or dashes');
    if (!String(own.name || '').trim() || !String(own.description || '').trim()) say(at, 'needs a name and a description');
    const steps = listOf(own.steps);
    duplicates(steps.map((step) => step.id)).forEach((id) => say(`${at}.steps`, `"${id}" appears twice`));
    steps.forEach((step, index) => {
        const where = `${at}.steps.${step.id || index}`;
        if (!STEP_ID.test(String(step.id || ''))) say(where, 'id must be "s" followed by letters or digits');
        if (Boolean(step.agent) === Boolean(step.approval)) say(where, 'needs exactly one of agent or approval');
        if (step.agent) roleAgent(where, step.agent);
        if (step.approval) {
            if (!String(step.approval.title || '').trim() || !String(step.approval.prompt || '').trim()) say(where, 'an approval needs a title and a prompt');
            if (!['admin', 'member'].includes(roleOf(step.approval.owner))) say(where, `owner "${step.approval.owner}" must be ${OWNER} or a member who is not a guest`);
        }
    });
    const gate = steps.findIndex((step) => step.approval);
    if (gate < 0) say(at, 'has no approval for a person to decide');
    if (gate === 0) say(at, 'starts with an approval; its first step hands the task to a role');
    if (!own.run) { say(`${at}.run`, 'is missing'); return; }
    if (!taskRef(scenario, own.run.task)) say(`${at}.run`, `"${own.run.task}" is not a task`);
    else if (!isOpenAfterStory(scenario, own.run.task)) say(`${at}.run`, `${own.run.task} is closed once the story has played; a role can only be handed open work`);
    if (roleOf(own.run.by) !== 'admin') say(`${at}.run`, `"${own.run.by}" cannot start a workflow; ${OWNER} or an admin does`);
}

function validateScenario(scenario, { roleExists = () => true, templateExists = () => true } = {}) {
    const problems = [];
    const say = (where, what) => problems.push(`${scenario && scenario.key ? scenario.key : '?'}: ${where}: ${what}`);
    if (!scenario || typeof scenario !== 'object') return ['scenario is not an object'];

    if (!KEY.test(String(scenario.key || ''))) say('key', 'must be lower-case letters, digits or dashes');
    if (!KEY.test(String(scenario.industry || ''))) say('industry', 'must be lower-case letters, digits or dashes');
    if (!scenario.company || !String(scenario.company.name || '').trim()) say('company.name', 'is missing');
    if (!scenario.company || !KEY.test(String(scenario.company.domain || ''))) say('company.domain', 'must be lower-case letters, digits or dashes');
    if (!scenario.owner || !String(scenario.owner.title || '').trim()) say('owner.title', 'is missing');

    const people = listOf(scenario.people);
    const personKeys = people.map((person) => person.key);
    duplicates(personKeys).forEach((key) => say('people', `"${key}" appears twice`));
    duplicates(people.map(fullName)).forEach((name) => say('people', `"${name}" appears twice`));
    people.forEach((person) => {
        if (person.key === OWNER) say(`people.${person.key}`, `"${OWNER}" is the demo account and cannot be a person`);
        if (!KEY.test(String(person.key || ''))) say(`people.${person.key}`, 'key must be lower-case letters, digits or dashes');
        if (!person.firstName || !person.lastName || !person.title) say(`people.${person.key}`, 'needs firstName, lastName and title');
        if (!ROLES.includes(person.role)) say(`people.${person.key}`, `role must be one of ${ROLES.join(', ')}`);
    });
    const isPerson = (key) => key === OWNER || personKeys.includes(key);
    const checkPeople = (where, keys) => listOf(keys).forEach((key) => { if (!isPerson(key)) say(where, `"${key}" is not a person`); });

    const projects = listOf(scenario.projects);
    if (!projects.length) say('projects', 'there are none');
    duplicates(projects.map((project) => project.key)).forEach((key) => say('projects', `"${key}" appears twice`));
    duplicates(projects.map((project) => project.code)).forEach((code) => say('projects', `code "${code}" appears twice`));
    projects.forEach((project) => {
        const at = `projects.${project.key}`;
        if (!CODE.test(String(project.code || ''))) say(at, 'code must be 2 to 6 capital letters');
        if (!project.name) say(at, 'name is missing');
        if (!HEX.test(String(project.color || ''))) say(at, 'color must be #rrggbb');
        if (!String(project.summary || '').trim()) say(at, 'summary is missing');
        checkPeople(`${at}.lead`, [project.lead]);
        checkPeople(`${at}.members`, project.members);
        listOf(project.views).forEach((view) => { if (!VIEWS.includes(view)) say(`${at}.views`, `"${view}" is not a view`); });

        const statuses = listOf(project.statuses);
        duplicates(statuses.map((status) => status.name)).forEach((name) => say(`${at}.statuses`, `"${name}" appears twice`));
        statuses.forEach((status) => {
            if (!STATUS_TYPES.includes(status.type)) say(`${at}.statuses.${status.name}`, `type must be one of ${STATUS_TYPES.join(', ')}`);
            if (!HEX.test(String(status.color || ''))) say(`${at}.statuses.${status.name}`, 'color must be #rrggbb');
        });
        ['default_active', 'close'].forEach((type) => {
            const count = statuses.filter((status) => status.type === type).length;
            if (count !== 1) say(`${at}.statuses`, `needs exactly one "${type}" status, has ${count}`);
        });
        if (listOf(project.stages).length && listOf(project.stages).length < 3) say(`${at}.stages`, 'needs at least three stages');

        const types = listOf(project.types);
        if (!types.length) say(`${at}.types`, 'there are none');
        duplicates(types.map((type) => type.name)).forEach((name) => say(`${at}.types`, `"${name}" appears twice`));
        const typeNames = types.map((type) => type.name);

        const fields = listOf(project.fields);
        duplicates(fields.map((field) => field.key)).forEach((key) => say(`${at}.fields`, `"${key}" appears twice`));
        fields.forEach((field) => {
            if (!FIELD_TYPES.includes(field.type)) say(`${at}.fields.${field.key}`, `type must be one of ${FIELD_TYPES.join(', ')}`);
            if (!field.title) say(`${at}.fields.${field.key}`, 'title is missing');
            if (field.type === 'dropdown' && !listOf(field.options).length) say(`${at}.fields.${field.key}`, 'a dropdown needs options');
        });
        const fieldByKey = new Map(fields.map((field) => [field.key, field]));
        const tagNames = listOf(project.tags).map((tag) => tag.name);
        listOf(project.tags).forEach((tag) => { if (!HEX.test(String(tag.color || ''))) say(`${at}.tags.${tag.name}`, 'color must be #rrggbb'); });

        const tasks = listOf(project.tasks);
        if (!tasks.length) say(`${at}.tasks`, 'there are none');
        duplicates(tasks.map((task) => task.key)).forEach((key) => say(`${at}.tasks`, `"${key}" appears twice`));
        const checkTask = (task, where) => {
            if (!task.name) say(where, 'name is missing');
            if (!statusOf(project, task.status)) say(where, `status "${task.status}" is not one of the project's`);
            if (task.type && !typeNames.includes(task.type)) say(where, `type "${task.type}" is not one of the project's`);
            if (task.priority && !PRIORITIES.includes(task.priority)) say(where, `priority must be one of ${PRIORITIES.join(', ')}`);
            checkPeople(`${where}.assignees`, task.assignees);
            if (task.lead) checkPeople(`${where}.lead`, [task.lead]);
            Object.entries(task.fields || {}).forEach(([key, value]) => {
                const field = fieldByKey.get(key);
                if (!field) say(where, `field "${key}" is not one of the project's`);
                else if (field.type === 'dropdown' && !listOf(field.options).includes(value)) say(where, `"${value}" is not an option of ${key}`);
            });
            listOf(task.tags).forEach((tag) => { if (!tagNames.includes(tag)) say(where, `tag "${tag}" is not one of the project's`); });
            const closed = statusOf(project, task.status) && ['close', 'done'].includes(statusOf(project, task.status).type);
            if (!closed && Number.isFinite(task.due) && task.due < 0 && !task.overdue) say(where, 'is open and past due; set overdue: true if that is the story');
        };
        tasks.forEach((task) => {
            const where = `${at}.tasks.${task.key}`;
            checkTask(task, where);
            listOf(task.subtasks).forEach((sub, index) => checkTask(sub, `${where}.subtasks.${index}`));
            listOf(task.blockedBy).forEach((ref) => {
                const target = taskRef(scenario, ref.includes('.') ? ref : `${project.key}.${ref}`);
                if (!target) say(where, `blockedBy "${ref}" is not a task`);
            });
        });
    });

    const agents = listOf(scenario.agents);
    duplicates(agents.map((agent) => agent.key)).forEach((key) => say('agents', `"${key}" appears twice`));
    agents.forEach((agent) => {
        const at = `agents.${agent.key}`;
        if (Boolean(agent.role) === Boolean(agent.skill)) say(at, 'needs exactly one of role or skill');
        if (agent.role && !roleExists(agent.role)) say(at, `role "${agent.role}" has no playbook`);
        if (agent.skill && !SKILLS_WITHOUT_MODEL.includes(agent.skill)) say(at, `skill "${agent.skill}" is not one that runs without a model`);
        if (agent.skill && (!agent.name || !agent.description)) say(at, 'a skill agent needs a name and a description');
        if (!listOf(agent.projects).length) say(at, 'names no project');
        listOf(agent.projects).forEach((key) => { if (!projectOf(scenario, key)) say(at, `project "${key}" does not exist`); });
        if (!String(agent.does || '').trim()) say(at, 'does is missing (one line for the guide)');
    });

    listOf(scenario.automations).forEach((rule, index) => {
        const at = `automations.${index}`;
        const project = projectOf(scenario, rule.project);
        if (!project) { say(at, `project "${rule.project}" does not exist`); return; }
        if (!rule.name) say(at, 'name is missing');
        const when = rule.when || {};
        if (when.statusTo && !statusOf(project, when.statusTo)) say(at, `status "${when.statusTo}" is not one of ${project.key}'s`);
        if (!when.statusTo && !when.priorityTo) say(at, 'when needs statusTo or priorityTo');
        if (when.priorityTo && !PRIORITIES.includes(when.priorityTo)) say(at, `priorityTo must be one of ${PRIORITIES.join(', ')}`);
        if (!listOf(rule.then).length) say(at, 'then is empty');
        listOf(rule.then).forEach((step) => {
            if (step.status && !statusOf(project, step.status)) say(at, `status "${step.status}" is not one of ${project.key}'s`);
            if (step.priority && !PRIORITIES.includes(step.priority)) say(at, `priority must be one of ${PRIORITIES.join(', ')}`);
            if (step.assign) checkPeople(`${at}.assign`, step.assign);
            if (step.notify) checkPeople(`${at}.notify`, step.notify.people);
            if (!['comment', 'priority', 'assign', 'notify', 'status', 'subtask'].some((kind) => step[kind] !== undefined)) say(at, 'a step does nothing');
        });
    });

    listOf(scenario.story).forEach((event, index) => {
        const at = `story.${index}`;
        const ref = event.comment || event.move || event.task;
        const target = taskRef(scenario, ref);
        if (!target) { say(at, `"${ref}" is not a task`); return; }
        if (event.comment !== undefined) {
            checkPeople(at, [event.by]);
            if (!String(event.text || '').trim()) say(at, 'text is missing');
        } else if (event.move !== undefined) {
            checkPeople(at, [event.by]);
            if (!statusOf(target.project, event.to)) say(at, `status "${event.to}" is not one of ${target.project.key}'s`);
        } else if (event.agentRun !== undefined || event.proposal !== undefined) {
            const agent = agentOf(scenario, event.agentRun || event.proposal);
            if (!agent) say(at, `agent "${event.agentRun || event.proposal}" does not exist`);
            else if (!listOf(agent.projects).includes(target.project.key)) say(at, `agent "${agent.key}" does not work in ${target.project.key}`);
            if (!String(event.summary || '').trim()) say(at, 'summary is missing');
            if (event.proposal !== undefined) {
                if (!event.what || !event.why) say(at, 'a proposal needs what and why');
                if (!listOf(event.changes).length) say(at, 'a proposal needs changes');
                listOf(event.changes).forEach((change) => {
                    if (change.assign) checkPeople(at, change.assign);
                    if (change.priority && !PRIORITIES.includes(change.priority)) say(at, `priority must be one of ${PRIORITIES.join(', ')}`);
                    if (!['comment', 'priority', 'assign', 'subtask', 'due'].some((kind) => change[kind] !== undefined)) say(at, 'a change does nothing');
                });
            }
        } else say(at, 'is not a comment, move, agentRun or proposal');
    });
    const pending = listOf(scenario.story).filter((event) => event.proposal !== undefined).map((event) => `${event.proposal}:${event.task}`);
    duplicates(pending).forEach((pair) => say('story', `two proposals by the same agent wait on one task (${pair}); only one run per agent and task may be open`));

    listOf(scenario.goals).forEach((goal, index) => {
        const at = `goals.${index}`;
        if (!goal.name) say(at, 'name is missing');
        if (!listOf(goal.targets).length) say(at, 'has no targets');
        listOf(goal.targets).forEach((target) => {
            if (target.kind === 'tasks') {
                listOf(target.tasks).forEach((ref) => { if (!taskRef(scenario, ref)) say(at, `"${ref}" is not a task`); });
                listOf(target.lists).forEach((key) => { if (!projectOf(scenario, key)) say(at, `project "${key}" does not exist`); });
                if (!listOf(target.tasks).length && !listOf(target.lists).length) say(at, 'a tasks target needs tasks or lists');
            } else if (target.kind !== 'boolean') say(at, 'targets are "tasks" (counted from the work) or "boolean"');
        });
    });

    if (scenario.dashboard) {
        if (!projectOf(scenario, scenario.dashboard.project)) say('dashboard', `project "${scenario.dashboard.project}" does not exist`);
        const cards = listOf(scenario.dashboard.cards);
        if (!cards.length || cards.length > MAX_DASHBOARD_CARDS) say('dashboard', `needs 1 to ${MAX_DASHBOARD_CARDS} cards`);
        cards.forEach((card) => { if (!CARDS.includes(card)) say('dashboard', `"${card}" is not a card`); });
    }

    if (!scenario.guide || !String(scenario.guide.intro || '').trim()) say('guide.intro', 'is missing');
    if (!projectOf(scenario, scenario.guide && scenario.guide.project)) say('guide.project', 'must name the project the guide lives in');
    if (!listOf(scenario.guide && scenario.guide.tryThis).length) say('guide.tryThis', 'is empty');
    validateLayers(scenario, say, { templateExists });
    return problems;
}

const pipeline = (project) => listOf(project.statuses).map((status) => status.name).join(' → ');

const whenText = (rule) => (rule.when.statusTo ? `a task moves to **${rule.when.statusTo}**` : `a task's priority becomes **${rule.when.priorityTo}**`);

const thenText = (step, nameOf) => {
    if (step.comment !== undefined) return 'adds a comment';
    if (step.priority) return `sets priority ${step.priority}`;
    if (step.assign) return `assigns ${step.assign.map(nameOf).join(' and ')}`;
    if (step.notify) return `notifies ${step.notify.people.map(nameOf).join(' and ')}`;
    if (step.status) return `moves it to ${step.status}`;
    if (step.subtask) return `adds the subtask "${step.subtask}"`;
    return '';
};

const conditionText = (rule) => [
    listOf(rule.types).join(' or '),
    listOf(rule.statuses).length ? `in ${listOf(rule.statuses).join(' or ')}` : '',
    listOf(rule.tags).length ? `tagged ${listOf(rule.tags).join(' or ')}` : '',
].filter(Boolean).join(', ');

/* The part of a task's name a person says aloud: "SUP-2201 · CSV export…" is SUP-2201. */
const shortName = (task) => String(task.name).split(' · ')[0];

function routingSection(scenario, agentName) {
    const rows = Object.entries(scenario.routing || {}).flatMap(([projectKey, rules]) => listOf(rules)
        .map((rule) => `| ${projectOf(scenario, projectKey).name} | ${conditionText(rule)} | ${agentName(rule.agent)} |`));
    return [
        '## Who routes the work',
        '',
        'Each project\'s dispatcher suggests who takes a task, from the rules below and without an AI model. The project lead sees the suggestion on the task; accepting it puts the task in that role\'s queue. A task no rule matches waits under **Needs routing** for the lead.',
        '',
        '| Project | When the task is | Suggested role |',
        '| --- | --- | --- |',
        ...rows,
        '',
        'Open **AI → Company view**: the org chart shows each role, its agent and who supervises it, and the flow board shows the work waiting for each role.',
        '',
    ];
}

function workflowSection(scenario, { agentName, nameOf, templateName }) {
    const own = ownWorkflow(scenario);
    const templates = listOf(scenario.workflows && scenario.workflows.templates);
    const lines = ['## Workflows', ''];
    if (templates.length) lines.push(`Ready-made workflows installed, switched off until someone turns them on: ${templates.map((key) => `**${templateName(key)}**`).join(' and ')}.`, '');
    if (own) {
        const { task } = taskRef(scenario, own.run.task);
        const gate = listOf(own.steps).find((step) => step.approval);
        const chain = listOf(own.steps).map((step) => (step.agent ? agentName(step.agent) : `**${step.approval.title}** (approved by ${nameOf(step.approval.owner)})`)).join(' → ');
        const finished = stepsBeforeGate(own).map((step) => agentName(step.agent));
        const waitsFor = gate.approval.owner === OWNER ? 'your approval' : `the approval of ${nameOf(gate.approval.owner)}`;
        lines.push(
            `**${own.name}** is switched on: ${chain}. ${nameOf(own.run.by)} started it on **${task.name}**. The ${finished.join(' and the ')} finished ${finished.length === 1 ? 'its step' : 'their steps'}, so it waits for ${waitsFor} in **AI → Inbox → Approvals** and under **Waiting on you** on Home.`,
            '',
        );
    }
    return lines;
}

const routingTry = (scenario, agentName) => {
    const own = ownWorkflow(scenario);
    const taken = new Set([...listOf(scenario.handOvers).map((handOver) => handOver.task), own && own.run ? own.run.task : null]);
    const refs = listOf(scenario.projects).flatMap((project) => listOf(project.tasks).map((task) => `${project.key}.${task.key}`));
    const ref = refs.find((one) => !taken.has(one) && isOpenAfterStory(scenario, one) && ruleFor(scenario, one));
    const intro = 'Open **AI → Company view**: the org chart shows the roles and the flow board the work waiting for each.';
    if (!ref) return intro;
    return `${intro} Then open **${taskRef(scenario, ref).task.name}**, accept the dispatcher's suggestion of the **${agentName(ruleFor(scenario, ref).agent)}**, and the task moves into that role's queue.`;
};

const workflowTry = (scenario, { agentName, nameOf }) => {
    const own = ownWorkflow(scenario);
    const steps = listOf(own.steps);
    const gate = steps.findIndex((step) => step.approval);
    const next = steps[gate + 1];
    const task = shortName(taskRef(scenario, own.run.task).task);
    let then = 'the run finishes';
    if (next && next.agent) then = `it hands **${task}** to the **${agentName(next.agent)}**, whose queue on the Company view now holds it`;
    else if (next) then = `it asks ${nameOf(next.approval.owner)} for the next approval`;
    return `In **AI → Inbox → Approvals**, open **${steps[gate].approval.title}** and approve it. The workflow carries on for real: ${then}.`;
};

/* The guide's sections that come from the data, so they never drift from what the seed made. A part the instance
 * did not switch on (`seeded`) is left out, so a visitor never reads about a screen they cannot open. */
function guideMarkdown(scenario, { roleName = (key) => key, ownerName = 'You', templateName = (key) => key, seeded = {} } = {}) {
    const nameOf = (key) => (key === OWNER ? `${ownerName} (${scenario.owner.title})` : (() => {
        const person = listOf(scenario.people).find((p) => p.key === key);
        return person ? fullName(person) : key;
    })());
    const agentName = (key) => {
        const agent = agentOf(scenario, key);
        return agent ? agent.name || roleName(agent.role) : key;
    };
    const routed = Boolean(seeded.dispatcher && scenario.routing);
    const workflows = Boolean(seeded.workflows && scenario.workflows);
    const ran = workflows && Boolean(ownWorkflow(scenario));
    const tryThis = [
        ...listOf(scenario.guide.tryThis),
        ...(routed ? [routingTry(scenario, agentName)] : []),
        ...(ran ? [workflowTry(scenario, { agentName, nameOf })] : []),
    ];
    const lines = [
        scenario.guide.intro.trim(),
        '',
        '## Who does what',
        '',
        '| Person | Role |',
        '| --- | --- |',
        `| ${ownerName} (the account you are signed in with) | ${scenario.owner.title} |`,
        ...listOf(scenario.people).map((person) => `| ${fullName(person)} | ${person.title} |`),
        '',
        '## The agents',
        '',
        '| Agent | What it does here | In this demo |',
        '| --- | --- | --- |',
        ...listOf(scenario.agents).map((agent) => (agent.skill
            ? `| ${agent.name} | ${agent.does} | Runs for real, no AI model needed |`
            : `| ${agent.name || roleName(agent.role)} | ${agent.does} | Real playbook, simulated history |`)),
        '',
        '> Each role agent carries the real playbook of its role as its skill. It is paused, as every agent a team pack adds is, until someone switches it on with an AI model connected. Its earlier runs, the comments they left and the proposals waiting for you were written for this demo and carry a **Simulated** label.',
        '',
        '## The processes',
        '',
        ...listOf(scenario.projects).flatMap((project) => [
            `### ${project.name} (${project.code})`,
            '',
            project.summary.trim().split('\n')[0],
            '',
            `Pipeline: ${pipeline(project)}`,
            '',
        ]),
        '## Automations that run here',
        '',
        ...listOf(scenario.automations).map((rule) => `- **${rule.name}**: when ${whenText(rule)} in ${projectOf(scenario, rule.project).name}, it ${listOf(rule.then).map((step) => thenText(step, nameOf)).filter(Boolean).join(', ')}.`),
        '',
        ...(routed ? routingSection(scenario, agentName) : []),
        ...(workflows ? workflowSection(scenario, { agentName, nameOf, templateName }) : []),
        '## Try this',
        '',
        ...tryThis.map((step, index) => `${index + 1}. ${step}`),
        '',
        '## What is real, simulated and illustrative',
        '',
        [
            '- **Real**: the projects, pipelines, fields, automations, approvals, dashboards and goals are ordinary AlianHub features working on this data. Moving a card fires its automation; approving a proposal applies its changes; the digest agent really runs.',
            routed ? 'The dispatcher\'s suggestions come from its rules, with no AI model, and the leads accepted the hand-overs now in the queues.' : '',
            ran ? 'The workflow run, its approval and what happens once you decide are real.' : '',
        ].filter(Boolean).join(' '),
        [
            '- **Simulated**: earlier agent runs, the comments they left and the proposals waiting for approval were written for this demo to show how each agent works. They are marked Simulated and cost nothing. Connect an AI model and switch an agent on to see it run for real.',
            ran ? 'In the workflow run, the roles finishing their steps before the approval were written for this demo too; the run and those steps carry the same label.' : '',
        ].filter(Boolean).join(' '),
        '- **Illustrative**: the company, people, customers, suppliers and amounts are fictional.',
        '',
    ];
    return lines.join('\n');
}

module.exports = {
    OWNER, PRIORITIES, CARDS, validateScenario, taskRef, projectOf, agentOf, statusOf, fullName, guideMarkdown,
    statusAfterStory, isOpenAfterStory, ruleFor, ownWorkflow, stepsBeforeGate, rolesIn, shortName,
};
