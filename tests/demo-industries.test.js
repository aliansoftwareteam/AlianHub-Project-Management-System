const { SCENARIOS } = require('../scripts/demo/industries/scenarios');
const { validateScenario, guideMarkdown } = require('../scripts/demo/industries/lib/scenario');
const { targetProblem, isShowcaseCompany, isShowcasePerson, emailFor, MARK } = require('../scripts/demo/industries/lib/guard');
const { buildShowcase, roleExists, roleName } = require('../scripts/demo/industries/lib/build');
const { dropShowcase } = require('../scripts/demo/industries/lib/drop');
const { markdownBlocks } = require('../scripts/demo/industries/lib/blocks');

const clone = (value) => JSON.parse(JSON.stringify(value));
const finedge = () => clone(SCENARIOS.find((scenario) => scenario.key === 'finedge'));

describe('industry demo scenarios', () => {
    test.each(SCENARIOS.map((scenario) => [scenario.key, scenario]))('%s is coherent', (key, scenario) => {
        expect(validateScenario(scenario, { roleExists })).toEqual([]);
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
        const problems = validateScenario(broken, { roleExists }).join('\n');
        expect(problems).toMatch(/exactly one "default_active" status, has 2/);
        expect(problems).toMatch(/status "Lost" is not one of the project's/);
        expect(problems).toMatch(/"nobody" is not a person/);
        expect(problems).toMatch(/open and past due/);
        expect(problems).toMatch(/has no playbook/);
        expect(problems).toMatch(/only one run per agent and task may be open/);
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
function fakeAdapter() {
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
