const F = require('../frontend/src/views/Ai/agentFit');
const registry = require('../Modules/Agents/registry');

const REGISTRY_ACTIONS = registry.manifest().actions;
const NEVER = registry.NEVER;

const task = (over = {}) => ({ _id: 't1', TaskName: 'Audit login contrast', ProjectID: 'p1', tagsArray: [], ...over });

const agent = (over = {}) => ({
    _id: 'a1', name: 'Reviewer', skills: ['review', 'a11y'], allowedActions: ['task.get', 'task.comment'],
    autonomy: 1, spendCapUsd: 10, paused: false, projectIds: [], ...over
});

const run = (over = {}) => ({ _id: 'r1', agentId: 'a1', status: 'done', skill: 'review', elapsedMs: 8 * 60000, spend: { usd: 0.05 }, ...over });

const rank = (opts) => F.rankAgents({ registryActions: REGISTRY_ACTIONS, never: NEVER, ...opts });

describe('classifyTask', () => {
    test('an audit is review work', () => {
        expect(F.classifyTask(task()).kind).toBe('review');
    });

    test('a fix is code work and needs write actions', () => {
        const work = F.classifyTask(task({ TaskName: 'Fix 3 failing snapshot tests' }));
        expect(work.kind).toBe('code');
        expect(work.actions).toContain('task.link');
    });

    test('a decision is flagged as needing a person, with a reason', () => {
        const work = F.classifyTask(task({ TaskName: 'Decide the pricing page layout' }));
        expect(work.needsPerson).toBe(true);
        expect(work.why).toMatch(/accountable/);
    });

    test('a vendor call is flagged as needing a person', () => {
        expect(F.classifyTask(task({ TaskName: 'Call the vendor about the DPA' })).needsPerson).toBe(true);
    });

    test('anything unrecognised falls back to read-and-comment, not to a refusal', () => {
        const work = F.classifyTask(task({ TaskName: 'Sprint 14 housekeeping' }));
        expect(work.kind).toBe('general');
        expect(work.needsPerson).toBe(false);
    });
});

describe('fit is built from allowed actions', () => {
    test('an agent that cannot write to the task at all is not eligible for code work', () => {
        const readOnly = agent({ allowedActions: ['task.get'] });
        const out = F.fitFor({ agent: readOnly, task: task({ TaskName: 'Fix failing tests' }), registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.eligible).toBe(false);
        expect(out.blockedReason).toMatch(/no allowed action/);
        expect(out.percent).toBeNull();
    });

    test('partial coverage ranks below full coverage on the same task', () => {
        const commenter = agent({ _id: 'a1', name: 'Reviewer', allowedActions: ['task.get', 'task.comment'] });
        const coder = agent({ _id: 'a2', name: 'Claude Code', skills: ['code', 'repo'], allowedActions: ['task.get', 'task.comment', 'task.status.set', 'task.link'] });
        const ranked = rank({ agents: [commenter, coder], task: task({ TaskName: 'Fix failing snapshot tests' }) });
        expect(ranked[0].name).toBe('Claude Code');
        expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
        expect(ranked[1].reason).toMatch(/you would get a list, not a fix/);
    });

    test('"will" and "wont" come from the server registry, never a local copy', () => {
        const out = F.fitFor({ agent: agent(), task: task(), registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.will).toContain('Comment on a task');
        expect(out.wont).toContain('Assign a task');
        expect(out.wont).toEqual(expect.arrayContaining(NEVER));
    });

    test('an agent with no declared allowedActions is treated as un-narrowed, not as forbidden', () => {
        const out = F.fitFor({ agent: agent({ allowedActions: [] }), task: task({ TaskName: 'Fix failing tests' }), registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.eligible).toBe(true);
        expect(out.coverage).toBe(1);
    });
});

describe('fit is built from this workspace\'s own history', () => {
    test('a new agent shows "no history yet" instead of a percentage', () => {
        const out = F.fitFor({ agent: agent(), task: task(), runs: [], registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.noHistory).toBe(true);
        expect(out.percent).toBeNull();
        expect(out.reason).toMatch(/No history in this workspace yet/);
        expect(out.estimate).toEqual({ minutes: null, usd: null, basis: 'no history yet' });
    });

    test('a percentage appears once the agent has finished runs here', () => {
        const runs = [run(), run({ _id: 'r2' }), run({ _id: 'r3' })];
        const out = F.fitFor({ agent: agent(), task: task(), runs, registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.noHistory).toBe(false);
        expect(out.percent).toBeGreaterThan(0);
        expect(out.reason).toMatch(/3 similar runs here, 3 finished clean/);
    });

    test('failed runs pull the score down', () => {
        const clean = [run(), run({ _id: 'r2' }), run({ _id: 'r3' })];
        const messy = clean.concat([run({ _id: 'r4', status: 'failed' }), run({ _id: 'r5', status: 'stopped' })]);
        const good = F.fitFor({ agent: agent(), task: task(), runs: clean, registryActions: REGISTRY_ACTIONS, never: NEVER });
        const bad = F.fitFor({ agent: agent(), task: task(), runs: messy, registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(bad.score).toBeLessThan(good.score);
    });

    test('another agent\'s runs never count towards this one', () => {
        const out = F.fitFor({ agent: agent({ _id: 'a1' }), task: task(), runs: [run({ agentId: 'a2' })], registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.history.runs).toBe(0);
        expect(out.noHistory).toBe(true);
    });

    test('the cost and time estimate is the median of its own finished runs', () => {
        const runs = [
            run({ _id: 'r1', elapsedMs: 5 * 60000, spend: { usd: 0.10 } }),
            run({ _id: 'r2', elapsedMs: 8 * 60000, spend: { usd: 0.40 } }),
            run({ _id: 'r3', elapsedMs: 35 * 60000, spend: { usd: 0.90 } })
        ];
        const out = F.fitFor({ agent: agent(), task: task(), runs, registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.estimate.minutes).toBe(8);
        expect(out.estimate.usd).toBe(0.4);
        expect(out.estimate.basis).toBe('median of 3 finished runs');
    });
});

describe('not eligible states name the reason', () => {
    test('paused', () => {
        const out = F.fitFor({ agent: agent({ paused: true, pausedReason: 'spend_cap' }), task: task(), registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.eligible).toBe(false);
        expect(out.blockedReason).toBe('Paused (spend_cap).');
    });

    test('spend cap reached', () => {
        const out = F.fitFor({ agent: agent({ spendCapUsd: 10, spendMonth: { usd: 10 } }), task: task(), registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.blockedReason).toMatch(/Spend cap reached/);
    });

    test('scoped to other projects', () => {
        const out = F.fitFor({ agent: agent({ projectIds: ['p9'] }), task: task({ ProjectID: 'p1' }), registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(out.blockedReason).toBe('Not scoped to this project.');
    });

    test('a task that needs a person makes every agent ineligible', () => {
        const ranked = rank({ agents: [agent(), agent({ _id: 'a2', name: 'Claude Code' })], task: task({ TaskName: 'Decide the pricing page layout' }) });
        expect(ranked.every((r) => !r.eligible)).toBe(true);
        expect(ranked[0].blockedReason).toMatch(/^This needs a person/);
    });

    test('ineligible agents are ranked last but never hidden', () => {
        const ranked = rank({ agents: [agent({ _id: 'a1', name: 'Paused one', paused: true }), agent({ _id: 'a2', name: 'Live one' })], task: task() });
        expect(ranked.map((r) => r.name)).toEqual(['Live one', 'Paused one']);
        expect(ranked).toHaveLength(2);
    });
});

describe('bulk routing', () => {
    const agents = [
        agent({ _id: 'a1', name: 'Reviewer', skills: ['review', 'a11y'], allowedActions: ['task.get', 'task.comment'] }),
        agent({ _id: 'a2', name: 'Claude Code', skills: ['code', 'repo', 'test'], allowedActions: ['task.get', 'task.comment', 'task.status.set', 'task.link'] })
    ];
    const tasks = [
        task({ _id: '1', TaskName: 'Update dependency versions' }),
        task({ _id: '2', TaskName: 'Fix 3 failing snapshot tests' }),
        task({ _id: '3', TaskName: 'Audit empty-state copy' }),
        task({ _id: '4', TaskName: 'Decide the pricing page layout' }),
        task({ _id: '5', TaskName: 'Call the vendor about the DPA' })
    ];

    test('routes the mechanical work and refuses the two that need a person', () => {
        const rows = F.routeTasks({ tasks, agents, registryActions: REGISTRY_ACTIONS, never: NEVER });
        const totals = F.routingTotals(rows);
        expect(totals.routed).toBe(3);
        expect(totals.forPeople).toBe(2);
        expect(rows[3].refusal).toMatch(/needs a person/);
        expect(rows[4].refusal).toMatch(/needs a person/);
    });

    test('code work goes to the agent with repo actions, review work to the reviewer', () => {
        const rows = F.routeTasks({ tasks, agents, registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(rows[1].agent.name).toBe('Claude Code');
        expect(rows[2].agent.name).toBe('Reviewer');
    });

    test('the total only prices the rows that have a real estimate', () => {
        const runs = [run({ agentId: 'a2', spend: { usd: 0.60 }, elapsedMs: 30 * 60000 })];
        const rows = F.routeTasks({ tasks, agents, runs, registryActions: REGISTRY_ACTIONS, never: NEVER });
        const totals = F.routingTotals(rows);
        expect(totals.priced).toBeGreaterThan(0);
        expect(totals.usd).toBeGreaterThan(0);
    });

    test('with no eligible agent at all, every row falls to a person', () => {
        const rows = F.routeTasks({ tasks, agents: [], registryActions: REGISTRY_ACTIONS, never: NEVER });
        expect(F.routingTotals(rows)).toEqual({ routed: 0, forPeople: 5, usd: 0, priced: 0 });
        expect(rows[0].refusal).toBe('no agent here is allowed to do this');
    });
});

describe('routing refuses a task that lacks what the agent\'s skills need (browser sweep)', () => {
    const reviewer = agent({ _id: 'pr', name: 'Code Reviewer', skills: [{ key: 'pr.summary', name: 'Reviewer' }], allowedActions: ['task.get', 'task.comment'] });
    const qa = agent({ _id: 'qa', name: 'QA', skills: [{ key: 'qa-review' }], allowedActions: ['task.get', 'task.comment'] });
    const intake = agent({ _id: 'in', name: 'Intake', skills: [{ key: 'brief.parse' }], allowedActions: ['task.get', 'subtask.create', 'task.comment'] });
    const reporter = agent({ _id: 'rep', name: 'Reporter', skills: [{ key: 'digest.ceo' }], allowedActions: ['task.get', 'task.comment'] });
    const fit = (a, t, runs = []) => F.fitFor({ agent: a, task: t, runs, registryActions: REGISTRY_ACTIONS, never: NEVER });

    test('pr.summary needs a PR link — typed link, github URL in the description, or none', () => {
        const noPr = fit(reviewer, task({ TaskName: 'Review the checkout change' }));
        expect(noPr.eligible).toBe(false);
        expect(noPr.blockedReason).toBe('This task lacks what it needs — it needs a pull request link on the task.');
        expect(fit(reviewer, task({ TaskName: 'Review the checkout change', links: [{ kind: 'pr', url: 'https://github.com/a/b/pull/12' }] })).eligible).toBe(true);
        expect(fit(reviewer, task({ TaskName: 'Review', rawDescription: 'PR: https://github.com/a/b/pull/12' })).eligible).toBe(true);
    });

    test('qa-review needs a public http(s) URL; brief.parse needs 40 characters of brief; digests are never per task', () => {
        expect(fit(qa, task({ TaskName: 'Check the landing page' })).blockedReason).toMatch(/needs a public URL/);
        expect(fit(qa, task({ TaskName: 'Check http://localhost:8080/landing' })).blockedReason).toMatch(/needs a public URL/);
        expect(fit(qa, task({ TaskName: 'Check https://example.com/landing' })).eligible).toBe(true);
        expect(fit(intake, task({ TaskName: 'Plan the onboarding flow', description: 'tbd' })).blockedReason).toMatch(/brief of at least 40 characters/);
        expect(fit(intake, task({ TaskName: 'Plan the onboarding flow', description: `<p>${'Goal and acceptance criteria written out in full here. '.repeat(2)}</p>` })).eligible).toBe(true);
        expect(fit(reporter, task({ TaskName: 'Audit the digest' })).blockedReason).toMatch(/whole project, not on one task/);
    });

    test('the server-computed task.inputs win over deriving from the body, and an agent with any satisfiable skill stays eligible', () => {
        expect(fit(reviewer, task({ TaskName: 'Review the checkout change', inputs: { prUrl: 'https://github.com/a/b/pull/1', publicUrl: null, briefChars: 0 } })).eligible).toBe(true);
        const both = agent({ _id: 'b', name: 'Both', skills: [{ key: 'pr.summary' }, { key: 'qa-review' }], allowedActions: ['task.get', 'task.comment'] });
        expect(fit(both, task({ TaskName: 'Check https://example.com' })).eligible).toBe(true);
        expect(fit(agent({ skills: ['review', 'a11y'] }), task({ TaskName: 'Audit the copy' })).eligible).toBe(true);
    });

    test('bulk routing sends those tasks to a person with the reason instead of assigning them', () => {
        const rows = F.routeTasks({
            tasks: [task({ _id: '1', TaskName: 'Review the checkout change' }), task({ _id: '2', TaskName: 'Review https://github.com/a/b/pull/3' })],
            agents: [reviewer], registryActions: REGISTRY_ACTIONS, never: NEVER
        });
        expect(rows[0].routed).toBe(false);
        expect(rows[0].refusal).toBe('needs a person — it needs a pull request link on the task');
        expect(rows[1].routed).toBe(true);
        expect(rows[1].agent.name).toBe('Code Reviewer');
        expect(F.routingTotals(rows)).toMatchObject({ routed: 1, forPeople: 1 });
    });

    test('skipped runs are neither clean nor failed in the history', () => {
        const runs = [run({ agentId: 'pr', status: 'skipped' }), run({ _id: 'r2', agentId: 'pr', status: 'skipped' }), run({ _id: 'r3', agentId: 'pr', status: 'done' })];
        const t = task({ TaskName: 'Review https://github.com/a/b/pull/3' });
        const out = fit(reviewer, t, runs);
        expect(out.history).toMatchObject({ runs: 3, finished: 1, good: 1, skipped: 2, successRate: 1 });
        expect(out.reason).toMatch(/1 finished clean\. 2 skipped for missing input/);
        const onlySkips = fit(reviewer, t, runs.slice(0, 2));
        expect(onlySkips.noHistory).toBe(true);
        expect(onlySkips.percent).toBeNull();
    });
});
