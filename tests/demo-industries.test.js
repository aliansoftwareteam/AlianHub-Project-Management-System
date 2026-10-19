const { SCENARIOS } = require('../scripts/demo/industries/scenarios');
const { validateScenario, guideMarkdown, ruleFor, statusAfterStory } = require('../scripts/demo/industries/lib/scenario');
const { targetProblem, isShowcaseCompany, isShowcasePerson, emailFor, MARK } = require('../scripts/demo/industries/lib/guard');
const { buildShowcase, roleExists, roleName, templateExists, templateName } = require('../scripts/demo/industries/lib/build');
const { dropShowcase } = require('../scripts/demo/industries/lib/drop');
const { purgeVisitors } = require('../scripts/demo/industries/lib/purge');
const { markdownBlocks } = require('../scripts/demo/industries/lib/blocks');

const clone = (value) => JSON.parse(JSON.stringify(value));
const finedge = () => clone(SCENARIOS.find((scenario) => scenario.key === 'finedge'));
const technova = () => clone(SCENARIOS.find((scenario) => scenario.key === 'technova'));
const checks = { roleExists, templateExists };

describe('industry demo scenarios', () => {
    test.each(SCENARIOS.map((scenario) => [scenario.key, scenario]))('%s is coherent', (key, scenario) => {
        expect(validateScenario(scenario, checks)).toEqual([]);
    });

    test('every company name leads with its industry, so the workspace picker reads as an industry menu', () => {
        SCENARIOS.forEach((scenario) => expect(scenario.company.name).toMatch(/^[A-Z][^·]+ · \S/));
        expect(new Set(SCENARIOS.map((scenario) => scenario.company.name.split(' · ')[0])).size).toBe(SCENARIOS.length);
    });

    test('there is a company for every blueprint the role playbooks cover', () => {
        const blueprints = new Set(SCENARIOS.flatMap((scenario) => scenario.agents.filter((agent) => agent.role).map((agent) => agent.role.split('/')[0])));
        ['it-company', 'manufacturing', 'agency', 'ecommerce', 'professional-services', 'construction', 'education', 'clinic']
            .forEach((blueprint) => expect(blueprints.has(blueprint)).toBe(true));
    });

    test('every scenario routes work, hands some of it over and runs a workflow to an approval', () => {
        SCENARIOS.forEach((scenario) => {
            expect(Object.keys(scenario.routing).length).toBeGreaterThan(0);
            expect(scenario.handOvers.length).toBeGreaterThan(0);
            expect(scenario.workflows.own.steps.some((step) => step.approval)).toBe(true);
            expect(scenario.workflows.own.steps[0].agent).toBeTruthy();
        });
    });

    test('keys, industries, domains and project codes are unique across scenarios', () => {
        const unique = (values) => new Set(values).size === values.length;
        expect(unique(SCENARIOS.map((s) => s.key))).toBe(true);
        expect(unique(SCENARIOS.map((s) => s.industry))).toBe(true);
        expect(unique(SCENARIOS.map((s) => s.company.domain))).toBe(true);
    });

    test('every scenario has an exception, an approval and a real automation story', () => {
        SCENARIOS.forEach((scenario) => {
            const moves = scenario.story.filter((event) => event.move);
            const ruleStatuses = scenario.automations.map((rule) => `${rule.project}:${rule.when.statusTo}`);
            expect(scenario.story.some((event) => event.proposal)).toBe(true);
            expect(scenario.story.some((event) => event.agentRun)).toBe(true);
            expect(moves.some((event) => ruleStatuses.includes(`${event.move.split('.')[0]}:${event.to}`))).toBe(true);
            expect(scenario.agents.some((agent) => agent.skill === 'digest.ceo')).toBe(true);
        });
    });

    test('no seeded text names a calendar month, so a reset never reads stale', () => {
        const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;
        SCENARIOS.forEach((scenario) => expect(JSON.stringify(scenario)).not.toMatch(MONTHS));
    });

    test('the validator names what is wrong', () => {
        const broken = finedge();
        broken.projects[0].statuses.push({ name: 'Received again', type: 'default_active', color: '#64748B' });
        broken.projects[0].tasks[0].status = 'Lost';
        broken.projects[0].tasks[1].assignees = ['nobody'];
        broken.projects[0].tasks[2].due = -4;
        broken.agents[0].role = 'finance/not-a-role';
        broken.story.push({ ...broken.story.find((event) => event.proposal) });
        const problems = validateScenario(broken, checks).join('\n');
        expect(problems).toMatch(/exactly one "default_active" status, has 2/);
        expect(problems).toMatch(/status "Lost" is not one of the project's/);
        expect(problems).toMatch(/"nobody" is not a person/);
        expect(problems).toMatch(/open and past due/);
        expect(problems).toMatch(/has no playbook/);
        expect(problems).toMatch(/only one run per agent and task may be open/);
    });

    test('the validator names what is wrong with routing, hand-overs and workflows', () => {
        const broken = technova();
        broken.routing.sup.push({ agent: 'scribe', types: ['Ticket'] }, { agent: 'digest', types: ['Ticket'] }, { agent: 'support', types: ['Incident'] }, { agent: 'support' });
        broken.handOvers.push(
            { task: 'sup.second-admin', by: 'aisha' },
            { task: 'sup.rate-limit', by: 'leo' },
            { task: 'sup.csv', by: 'aisha' },
            { task: 'sup.rate-limit', by: 'aisha' },
        );
        broken.workflows.templates.push('not-a-template');
        broken.workflows.own.steps[2].approval.owner = 'nobody';
        broken.workflows.own.steps.push({ id: 'plan2', agent: 'digest' });
        broken.workflows.own.run.by = 'leo';
        const problems = validateScenario(broken, checks).join('\n');
        expect(problems).toMatch(/routing\.sup\.2: agent "scribe" does not work in sup/);
        expect(problems).toMatch(/agent "digest" has no role/);
        expect(problems).toMatch(/type "Incident" is not one of sup's/);
        expect(problems).toMatch(/routing\.sup\.5: needs at least one of types, tags, statuses/);
        expect(problems).toMatch(/sup\.second-admin is closed once the story has played/);
        expect(problems).toMatch(/"leo" does not lead sup/);
        expect(problems).toMatch(/sup\.csv is the workflow's task/);
        expect(problems).toMatch(/"sup\.rate-limit" is handed over twice/);
        expect(problems).toMatch(/"not-a-template" is not a ready-made workflow/);
        expect(problems).toMatch(/owner "nobody" must be you or a member/);
        expect(problems).toMatch(/id must be "s" followed by letters or digits/);
        expect(problems).toMatch(/"leo" cannot start a workflow/);
    });

    test('a workflow needs an approval after its first hand-over, on a task the story leaves open', () => {
        const noGate = technova();
        noGate.workflows.own.steps = noGate.workflows.own.steps.filter((step) => !step.approval);
        expect(validateScenario(noGate, checks).join('\n')).toMatch(/has no approval for a person to decide/);
        const gateFirst = technova();
        gateFirst.workflows.own.steps.unshift({ id: 'sFirst', approval: { title: 'Go?', prompt: 'Approve.', owner: 'you' } });
        expect(validateScenario(gateFirst, checks).join('\n')).toMatch(/starts with an approval/);
        const closed = technova();
        closed.workflows.own.run.task = 'ops.inc-297';
        expect(validateScenario(closed, checks).join('\n')).toMatch(/ops\.inc-297 is closed once the story has played/);
    });

    test('routing reads a task as the story leaves it, and the first matching rule wins', () => {
        const scenarios = Object.fromEntries(SCENARIOS.map((scenario) => [scenario.key, scenario]));
        expect(statusAfterStory(scenarios.swiftlogix, 'ship.sh-88214')).toBe('Delayed');
        expect(ruleFor(scenarios.swiftlogix, 'ship.sh-88214').agent).toBe('triage');
        expect(ruleFor(scenarios.swiftlogix, 'ship.sh-88250').agent).toBe('tracker');
        expect(ruleFor(scenarios.technova, 'sup.dark-mode')).toBeNull();
        expect(ruleFor(scenarios.finedge, 'bill.orchid-wo').agent).toBe('invoices');
    });

    test('the guide describes the dispatcher and the workflow only when they were seeded', () => {
        const scenario = technova();
        const options = { roleName, templateName, ownerName: 'Demo Visitor' };
        const off = guideMarkdown(scenario, options);
        expect(off).not.toMatch(/Who routes the work|## Workflows|Company view|AI → Inbox → Approvals/);
        const on = guideMarkdown(scenario, { ...options, seeded: { dispatcher: true, workflows: true } });
        expect(on).toMatch(/## Who routes the work/);
        expect(on).toContain('| Customer Support | Bug report | Bug Triager |');
        expect(on).toContain('| Platform Engineering | Story or Bug | Tech Lead |');
        expect(on).toMatch(/## Workflows/);
        expect(on).toContain('**Support to Engineering: a customer bug** and **Engineering: feature from design to release**');
        expect(on).toContain('Support Agent → Bug Triager → **Pull the fix into this sprint** (approved by Demo Visitor (VP of Engineering)) → Tech Lead');
        expect(on).toMatch(/Aisha Rahman started it on \*\*SUP-2201 · CSV export of invoices times out\*\*/);
        expect(on).toMatch(/it waits for your approval in \*\*AI → Inbox → Approvals\*\*/);
        expect(on).toMatch(/open \*\*Pull the fix into this sprint\*\* and approve it\. The workflow carries on for real: it hands \*\*SUP-2201\*\* to the \*\*Tech Lead\*\*/);
        expect(on).toContain('The Support Agent and the Bug Triager finished their steps');
        expect(on).toMatch(/accept the dispatcher's suggestion of the \*\*Bug Triager\*\*/);
        expect(on).toMatch(/the roles finishing their steps before the approval were written for this demo/);
        const dispatcherOnly = guideMarkdown(scenario, { ...options, seeded: { dispatcher: true, workflows: false } });
        expect(dispatcherOnly).toMatch(/## Who routes the work/);
        expect(dispatcherOnly).not.toMatch(/## Workflows|AI → Inbox → Approvals/);
    });

    test('the guide says what is real, simulated and illustrative, and lists every step', () => {
        const scenario = finedge();
        const text = guideMarkdown(scenario, { roleName, ownerName: 'Demo Visitor' });
        expect(text).toMatch(/## What is real, simulated and illustrative/);
        expect(text).toMatch(/Real playbook, simulated history/);
        expect(text).toMatch(/Runs for real, no AI model needed/);
        scenario.automations.forEach((rule) => expect(text).toContain(rule.name));
        scenario.guide.tryThis.forEach((step, index) => expect(text).toContain(`${index + 1}. ${step}`));
        expect(text).toContain('| Demo Visitor (the account you are signed in with) | Finance Controller |');
    });
});

describe('industry demo guard', () => {
    const local = { MONGODB_URL: 'mongodb://127.0.0.1:27017' };
    const remote = { MONGODB_URL: 'mongodb://mongo:27017' };

    test('runs against a local database', () => expect(targetProblem(local)).toBeNull());
    test('refuses a remote database', () => expect(targetProblem(remote)).toMatch(/DEMO_MODE/));
    test('runs on a declared public demo instance', () => expect(targetProblem({ ...remote, DEMO_MODE: 'true' })).toBeNull());
    test('refuses production unless it is a demo instance', () => {
        expect(targetProblem({ ...local, NODE_ENV: 'production' })).toMatch(/production/);
        expect(targetProblem({ ...remote, NODE_ENV: 'production', DEMO_MODE: 'true' })).toBeNull();
    });
    test('has no --force and needs a database', () => {
        expect(targetProblem(local, ['--force'])).toMatch(/no --force/);
        expect(targetProblem({})).toMatch(/MONGODB_URL/);
    });
    test('knows its own companies and people', () => {
        expect(isShowcaseCompany({ demoShowcase: { by: MARK } })).toBe(true);
        expect(isShowcaseCompany({ scaleSeed: { by: 'seed-scale' } })).toBe(false);
        const email = emailFor('finedge', { firstName: 'Maya', lastName: 'Chen' });
        expect(email).toBe('maya.chen@finedge.demo.test');
        expect(isShowcasePerson({ demoShowcase: MARK, Employee_Email: email })).toBe(true);
        expect(isShowcasePerson({ demoShowcase: MARK, Employee_Email: 'maya@finedge.com' })).toBe(false);
    });
});

/* An adapter that records what the build asks of the app, in order. */
function fakeAdapter({ dispatcher = true, workflows = true } = {}) {
    let n = 0;
    const id = () => (n += 1).toString(16).padStart(24, '0');
    const calls = [];
    const record = (name, value) => (args) => { calls.push({ name, args }); return typeof value === 'function' ? value(args) : value; };
    const adapter = {
        GLOBAL: 'global',
        calls,
        named: (name) => calls.filter((call) => call.name === name),
        createCompany: record('createCompany', () => id()),
        companyRoles: record('companyRoles', { admin: { key: 2 }, member: { key: 3 }, guest: { key: 0 } }),
        designationResolver: record('designationResolver', () => () => 0),
        findUserByEmail: record('findUserByEmail', null),
        createUser: record('createUser', () => id()),
        addMember: record('addMember'),
        projectStatuses: (companyId, statuses) => { calls.push({ name: 'projectStatuses', args: statuses }); return statuses.map((s, i) => ({ ...s, key: 100 + i })); },
        projectTaskTypes: (companyId, types) => { calls.push({ name: 'projectTaskTypes', args: types }); return types.map((t, i) => ({ ...t, key: 200 + i, value: t.name.toLowerCase() })); },
        createProject: record('createProject', () => id()),
        describeProject: record('describeProject'),
        createFields: record('createFields', ({ fields }) => Object.fromEntries(fields.map((field) => [field.key, { id: id(), type: field.type, options: {} }]))),
        getProject: record('getProject', () => ({ _id: id(), CompanyId: 'c', ProjectName: 'p' })),
        listOf: record('listOf', () => ({ _id: id() })),
        fieldValues: (made, values) => values || {},
        createTask: record('createTask', () => id()),
        relate: record('relate'),
        createRoleAgents: record('createRoleAgents', () => [{ agentId: id() }]),
        configureAgent: record('configureAgent'),
        agentById: record('agentById', () => ({ _id: id(), name: 'agent', skills: [{ key: 'role.x' }] })),
        createSkillAgent: record('createSkillAgent', () => ({ agentId: id() })),
        createRule: record('createRule', () => id()),
        startAutomations: record('startAutomations', true),
        stopAutomations: record('stopAutomations'),
        settleAutomations: record('settleAutomations', [{ ruleName: 'r', status: 'success' }]),
        features: () => ({ dispatcher, workflows }),
        saveDispatcher: record('saveDispatcher'),
        routeTask: record('routeTask', { state: 'suggested' }),
        acceptSuggestion: record('acceptSuggestion'),
        installTemplate: record('installTemplate', () => id()),
        createWorkflow: record('createWorkflow', () => id()),
        enableWorkflow: record('enableWorkflow'),
        startWorkflow: record('startWorkflow', () => id()),
        finishHandOver: record('finishHandOver'),
        waitingApproval: record('waitingApproval', { status: 'pending' }),
        personComment: record('personComment', () => id()),
        moveTask: record('moveTask'),
        simulatedRun: record('simulatedRun', () => ({ _id: id() })),
        agentComment: record('agentComment', () => id()),
        simulatedProposal: record('simulatedProposal', () => id()),
        createGoal: record('createGoal'),
        createDashboard: record('createDashboard'),
        createGuidePage: record('createGuidePage', () => id()),
        updateCompanyMarker: record('updateCompanyMarker'),
    };
    return adapter;
}

describe('building an industry company', () => {
    const owner = { userId: 'a'.repeat(24), email: 'demo.visitor@industries.demo.test', name: 'Demo Visitor' };

    test.each(SCENARIOS.map((scenario) => [scenario.key, scenario]))('%s goes through every part in order', async (key, scenario) => {
        const adapter = fakeAdapter();
        const { report } = await buildShowcase({ scenario, owner, adapter });
        const tasks = scenario.projects.reduce((sum, project) => sum + project.tasks.reduce((s, task) => s + 1 + (task.subtasks || []).length, 0), 0);

        expect(adapter.named('createCompany')[0].args).toMatchObject({ name: scenario.company.name, marker: { by: MARK, key: scenario.key, industry: scenario.industry } });
        expect(adapter.named('addMember')).toHaveLength(scenario.people.length);
        expect(adapter.named('createProject')).toHaveLength(scenario.projects.length);
        expect(adapter.named('createTask')).toHaveLength(tasks);
        expect(adapter.named('createRule')).toHaveLength(scenario.automations.length);
        expect(adapter.named('moveTask')).toHaveLength(scenario.story.filter((event) => event.move).length);
        expect(adapter.named('simulatedProposal')).toHaveLength(scenario.story.filter((event) => event.proposal).length);
        expect(report.simulatedRuns + report.proposals).toBe(adapter.named('simulatedRun').length);

        const order = adapter.calls.map((call) => call.name);
        const last = (name) => order.lastIndexOf(name);
        expect(last('createRule')).toBeLessThan(order.indexOf('startAutomations'));
        expect(order.indexOf('startAutomations')).toBeLessThan(order.indexOf('moveTask'));
        expect(last('moveTask')).toBeLessThan(order.indexOf('stopAutomations'));
        expect(last('createGuidePage')).toBeLessThan(order.indexOf('updateCompanyMarker'));
        expect(adapter.named('updateCompanyMarker')[0].args).toMatchObject({ marker: { guidePageId: expect.any(String) } });
    });

    test('a rule fires on the status the scenario names, in its own project', async () => {
        const adapter = fakeAdapter();
        await buildShowcase({ scenario: finedge(), owner, adapter });
        const rule = adapter.named('createRule')[0].args.rule;
        expect(rule.trigger).toEqual({ type: 'event', event: 'task.status_changed' });
        expect(rule.scope.allProjects).toBe(false);
        expect(rule.conditions).toMatchObject({ op: 'changedTo', field: 'statusRef' });
        expect(rule.conditions.value[0]).toMatch(/:102$/);
        expect(rule.conditions.label).toBe('Exception');
        expect(rule.steps.map((step) => step.action)).toEqual(['set_priority', 'assign', 'add_comment']);
    });

    test('a proposal asks for agent actions its agent is allowed', async () => {
        const adapter = fakeAdapter();
        await buildShowcase({ scenario: finedge(), owner, adapter });
        const reconActions = adapter.named('configureAgent')[0].args.actions;
        expect(reconActions.sort()).toEqual(['task.comment', 'task.update']);
        const proposal = adapter.named('simulatedProposal')[0].args;
        expect(proposal.changes.map((change) => change.action)).toEqual(['task.update', 'task.comment']);
        expect(proposal.changes[0].params.fields).toEqual({ Task_Priority: 'HIGH' });
    });

    test.each(SCENARIOS.map((scenario) => [scenario.key, scenario]))('%s switches the dispatcher on, runs its workflow to the approval, then routes and hands over', async (key, scenario) => {
        const adapter = fakeAdapter();
        const { report } = await buildShowcase({ scenario, owner, adapter });
        const routed = scenario.projects.filter((project) => scenario.routing[project.key]);
        const own = scenario.workflows.own;
        const beforeGate = own.steps.slice(0, own.steps.findIndex((step) => step.approval));

        expect(adapter.named('saveDispatcher')).toHaveLength(scenario.projects.length);
        adapter.named('saveDispatcher').forEach(({ args }) => expect(args.settings).toMatchObject({ mode: 'suggest', roles: expect.any(Array) }));
        expect(adapter.named('installTemplate').map((call) => call.args.key)).toEqual(scenario.workflows.templates || []);
        expect(adapter.named('finishHandOver').map((call) => call.args.stepId)).toEqual(beforeGate.map((step) => step.id));
        expect(adapter.named('routeTask')).toHaveLength(routed.reduce((sum, project) => sum + project.tasks.length, 0));
        expect(adapter.named('acceptSuggestion')).toHaveLength(scenario.handOvers.length);
        expect(report).toMatchObject({ workflowRuns: 1, simulatedSteps: beforeGate.length, handOvers: scenario.handOvers.length });

        const order = adapter.calls.map((call) => call.name);
        const last = (name) => order.lastIndexOf(name);
        expect(order.indexOf('stopAutomations')).toBeLessThan(order.indexOf('saveDispatcher'));
        expect(last('saveDispatcher')).toBeLessThan(order.indexOf('startWorkflow'));
        expect(order.indexOf('enableWorkflow')).toBeLessThan(order.indexOf('startWorkflow'));
        expect(last('finishHandOver')).toBeLessThan(order.indexOf('routeTask'));
        expect(last('routeTask')).toBeLessThan(order.indexOf('acceptSuggestion'));
        expect(last('acceptSuggestion')).toBeLessThan(order.indexOf('createGuidePage'));

        const guide = adapter.named('createGuidePage')[0].args.markdown;
        expect(guide).toMatch(/## Who routes the work/);
        expect(guide).toContain(own.name);
        expect(adapter.named('updateCompanyMarker')[0].args.marker.layers).toEqual({ dispatcher: true, workflows: true });
    });

    test('the dispatcher stores the project\'s own type, status and tag keys, and turns on the roles the workflow hands to', async () => {
        const adapter = fakeAdapter();
        await buildShowcase({ scenario: clone(SCENARIOS.find((scenario) => scenario.key === 'swiftlogix')), owner, adapter });
        const ship = adapter.named('saveDispatcher')[0].args.settings;
        expect(ship.rules).toEqual([
            { role: 'ecommerce/order-issue-triage', when: { statusKeys: [103, 102] } },
            { role: 'manufacturing/delivery-tracker', when: { taskTypeKeys: [200] } },
            { role: 'ecommerce/order-issue-triage', when: { taskTypeKeys: [201] } },
        ]);
        expect(ship.roles).toEqual(expect.arrayContaining(['ecommerce/order-issue-triage', 'manufacturing/delivery-tracker', 'manufacturing/customer-update-writer']));

        const tech = fakeAdapter();
        await buildShowcase({ scenario: technova(), owner, adapter: tech });
        const sup = tech.named('saveDispatcher')[0].args.settings;
        expect(sup.roles).toEqual(['it-company/support-agent', 'it-company/bug-triager', 'it-company/tech-lead']);
    });

    test('the workflow is saved as hand-overs and an approval the demo account owns, then started by its admin on the task', async () => {
        const adapter = fakeAdapter();
        await buildShowcase({ scenario: technova(), owner, adapter });
        const { steps } = adapter.named('createWorkflow')[0].args.definition;
        expect(steps.map((step) => [step.id, step.type, step.dependsOn])).toEqual([
            ['sTriage', 'role_handoff', []],
            ['sFile', 'role_handoff', ['sTriage']],
            ['sSprintOk', 'human_approval', ['sFile']],
            ['sPlan', 'role_handoff', ['sSprintOk']],
        ]);
        expect(steps[0].config).toEqual({ role: 'it-company/support-agent' });
        expect(steps[2].config).toMatchObject({ ownerUserId: owner.userId, onReject: 'skip', deadlineMs: 7 * 24 * 60 * 60 * 1000 });
        const start = adapter.named('startWorkflow')[0].args;
        expect(start).toMatchObject({ name: 'Customer bug: from support to the sprint · SUP-2201', taskId: expect.any(String), projectId: expect.any(String) });
        const aisha = adapter.named('addMember').find((call) => call.args.email === 'aisha.rahman@technova.demo.test');
        expect(start.userId).toBe(aisha.args.userId);
    });

    test('with the flags off, neither part is written and the guide leaves them out', async () => {
        const adapter = fakeAdapter({ dispatcher: false, workflows: false });
        const lines = [];
        await buildShowcase({ scenario: technova(), owner, adapter, log: (line) => lines.push(line) });
        ['saveDispatcher', 'routeTask', 'acceptSuggestion', 'installTemplate', 'createWorkflow', 'startWorkflow', 'finishHandOver']
            .forEach((name) => expect(adapter.named(name)).toHaveLength(0));
        expect(adapter.named('createGuidePage')[0].args.markdown).not.toMatch(/Who routes the work|## Workflows/);
        expect(adapter.named('updateCompanyMarker')[0].args.marker.layers).toEqual({ dispatcher: false, workflows: false });
        expect(lines.join('\n')).toMatch(/DISPATCHER is off/);
    });

    test('with the workflow engine off, the dispatcher part is still written', async () => {
        const adapter = fakeAdapter({ dispatcher: true, workflows: false });
        await buildShowcase({ scenario: technova(), owner, adapter });
        expect(adapter.named('saveDispatcher').length).toBeGreaterThan(0);
        expect(adapter.named('acceptSuggestion').length).toBeGreaterThan(0);
        expect(adapter.named('createWorkflow')).toHaveLength(0);
        expect(adapter.named('createGuidePage')[0].args.markdown).not.toMatch(/## Workflows/);
    });

    test('an incoherent scenario writes nothing', async () => {
        const adapter = fakeAdapter();
        const broken = finedge();
        broken.projects[0].tasks[0].status = 'Lost';
        await expect(buildShowcase({ scenario: broken, owner, adapter })).rejects.toThrow(/not coherent/);
        expect(adapter.calls).toHaveLength(0);
    });

    test('an existing account at a demo address is never taken over', async () => {
        const adapter = fakeAdapter();
        adapter.findUserByEmail = async () => ({ _id: 'b'.repeat(24), Employee_Email: 'maya.chen@finedge.demo.test' });
        await expect(buildShowcase({ scenario: finedge(), owner, adapter })).rejects.toThrow(/did not create/);
        expect(adapter.named('addMember')).toHaveLength(0);
    });
});

describe('removing an industry company', () => {
    const companyId = 'c'.repeat(24);
    const dropAdapter = (company, users) => {
        const writes = [];
        return {
            GLOBAL: 'global',
            writes,
            oid: (value) => value,
            findOne: async () => company,
            find: async () => users,
            globalWrite: async (type, method, ...data) => { writes.push({ type, method, data }); return { deletedCount: 1 }; },
            dropCompany: async (id) => writes.push({ dropped: id }),
        };
    };

    test('refuses a company the demo did not create', async () => {
        const adapter = dropAdapter({ _id: companyId, Cst_CompanyName: 'Real Co' }, []);
        await expect(dropShowcase({ companyId, adapter })).rejects.toThrow(/not a demo industry company/);
        expect(adapter.writes).toHaveLength(0);
    });

    test('deletes only its own people and keeps everyone else, unlinked', async () => {
        const own = { _id: 'd'.repeat(24), AssignCompany: [companyId], demoShowcase: MARK, Employee_Email: 'maya.chen@finedge.demo.test' };
        const visitor = { _id: 'e'.repeat(24), AssignCompany: [companyId, 'f'.repeat(24)], demoShowcase: MARK, Employee_Email: 'demo.visitor@industries.demo.test', lastSelectedCompany: companyId };
        const outsider = { _id: '1'.repeat(24), AssignCompany: [companyId], Employee_Email: 'owner@example.com' };
        const adapter = dropAdapter({ _id: companyId, Cst_CompanyName: 'FinEdge Finance', demoShowcase: { by: MARK } }, [own, visitor, outsider]);
        const { removed } = await dropShowcase({ companyId, adapter });
        const userDelete = adapter.writes.find((write) => write.method === 'deleteMany' && write.data[0]._id && write.data[0].demoShowcase === MARK);
        expect(userDelete.data[0]._id.$in).toEqual([own._id]);
        expect(removed.unlinked).toBe(2);
        const unlinkVisitor = adapter.writes.find((write) => write.method === 'updateOne' && write.data[0]._id === visitor._id);
        expect(unlinkVisitor.data[1]).toEqual({ $pull: { AssignCompany: companyId }, $unset: { lastSelectedCompany: 1 } });
        expect(adapter.writes.some((write) => write.dropped === companyId)).toBe(true);
    });
});

describe('purging a demo instance', () => {
    const SHOWCASE = { _id: 'a'.repeat(24), Cst_CompanyName: 'TechNova', demoShowcase: { by: MARK } };
    const LIVE = { _id: 'b'.repeat(24), Cst_CompanyName: 'Mahkamah Putrajaya' };
    const TRIAL = { _id: 'c'.repeat(24), Cst_CompanyName: 'My trial workspace' };
    const people = [
        { _id: '1'.repeat(24), Employee_Email: 'owner@example.com' },
        { _id: '2'.repeat(24), Employee_Email: 'admin@alianhub.com' },
        { _id: '3'.repeat(24), Employee_Email: 'maya.chen@technova.demo.test', demoShowcase: MARK },
        { _id: '4'.repeat(24), Employee_Email: 'someone@gmail.com' },
    ];
    const purgeAdapter = () => {
        const writes = [];
        return {
            GLOBAL: 'global',
            writes,
            oid: (value) => value,
            find: async (db, type) => (type === 'companies' ? [SHOWCASE, LIVE, TRIAL] : people),
            globalWrite: async (type, method, ...data) => { writes.push({ type, method, data }); return { deletedCount: 1 }; },
            dropCompany: async (id) => writes.push({ dropped: id }),
        };
    };
    const env = { DEMO_MODE: 'true' };

    test('refuses anywhere DEMO_MODE is not "true"', async () => {
        const adapter = purgeAdapter();
        await expect(purgeVisitors({ adapter, keepEmails: ['owner@example.com'], env: {} })).rejects.toThrow(/DEMO_MODE/);
        expect(adapter.writes).toHaveLength(0);
    });

    test('drops every company but the demo ones, and every account but the kept and the demo people', async () => {
        const adapter = purgeAdapter();
        const removed = await purgeVisitors({ adapter, keepEmails: ['Owner@Example.com', 'admin@alianhub.com'], env });
        expect(adapter.writes.filter((write) => write.dropped).map((write) => write.dropped)).toEqual([LIVE._id, TRIAL._id]);
        expect(removed.companies).toBe(2);
        const rowDeletes = adapter.writes.filter((write) => write.type === 'companies' && write.method === 'deleteOne');
        rowDeletes.forEach((write) => expect(write.data[0]['demoShowcase.by']).toEqual({ $ne: MARK }));
        const userDelete = adapter.writes.find((write) => write.type === 'users' && write.method === 'deleteMany');
        expect(userDelete.data[0]._id.$in).toEqual(['4'.repeat(24)]);
    });
});

describe('scenario text as editor blocks', () => {
    test('headings, bold, lists, tables and callouts become their own blocks, and text is escaped', () => {
        const blocks = markdownBlocks([
            '## The agents',
            '',
            'Moves to **Exception** <now>.',
            '',
            '| Agent | Does |',
            '| --- | --- |',
            '| Reconciliation Checker | Flags **duplicates** |',
            '',
            '> Simulated runs cost nothing.',
            '',
            '1. First',
            '2. Second',
        ].join('\n'));
        expect(blocks.map((block) => block.type)).toEqual(['header', 'paragraph', 'table', 'callout', 'list']);
        expect(blocks[1].data.text).toBe('Moves to <b>Exception</b> &lt;now&gt;.');
        expect(blocks[2].data).toEqual({ withHeadings: true, content: [['Agent', 'Does'], ['Reconciliation Checker', 'Flags <b>duplicates</b>']] });
        expect(blocks[3].data).toEqual({ tone: 'info', text: 'Simulated runs cost nothing.' });
        expect(blocks[4].data.style).toBe('ordered');
        expect(blocks[4].data.items.map((item) => item.content)).toEqual(['First', 'Second']);
    });
});
