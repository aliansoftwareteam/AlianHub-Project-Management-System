jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/engine/pageAudit', () => ({ PRIVATE_HOST: /^(localhost$|127\.)/i, fetchPage: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { fetchPage } = require('../Modules/Agents/engine/pageAudit');
const { getSkill, ALL } = require('../Modules/Agents/skills');
const orchestrator = require('../Modules/Agents/engine/orchestrator');

const task = { _id: 't1', TaskKey: 'AR-1', TaskName: 'Build the thing', ProjectID: 'p1', description: '<p>Goal: ship the magic-link login. Acceptance: verify endpoint, email template, rate limit, tests for expiry.</p>', links: [] };

describe('the skill registry', () => {
    it('resolves every template skill and alias the wizard offers', () => {
        for (const slug of ['qa-review', 'brief.parse', 'project.plan', 'pr.summary', 'risk.flags', 'digest.ceo', 'risk.today']) expect(getSkill(slug)).toBeTruthy();
        expect(ALL.map((s) => s.slug)).toEqual(['qa-review', 'brief.parse', 'pr.summary', 'digest.ceo']);
    });
});

describe('brief.parse (Intake)', () => {
    const skill = getSkill('brief.parse');
    it('refuses a brief too short to break down', async () => {
        expect((await skill.gather({ task: { ...task, description: '<p>do it</p>' } })).skip).toMatch(/too short/);
    });
    it('turns model output into subtasks with clamped estimates and a summary comment', () => {
        const { summary, changes } = skill.toChanges({ task, raw: { subtasks: [{ title: 'Add verify endpoint', hours: 3, why: 'core' }, { title: 'Email template', hours: 99 }, { title: '' }], questions: ['Which sender?'], summary: 'Two pieces.' } });
        expect(summary).toBe('Two pieces.');
        expect(changes.map((c) => c.action)).toEqual(['subtask.create', 'subtask.create', 'task.comment']);
        expect(changes[1].params.description).toContain('Estimate: 40h');
        expect(changes[2].params.body).toContain('Which sender?');
    });
});

describe('pr.summary (Reviewer)', () => {
    const skill = getSkill('pr.summary');
    it('skips cleanly without a link, and refuses private hosts', async () => {
        expect((await skill.gather({ task })).skip).toMatch(/no pull request/);
        expect((await skill.gather({ task: { ...task, links: [{ kind: 'pr', url: 'http://localhost:4000/pull/1' }] } })).skip).toMatch(/private or local/);
    });
    it('fetches the .diff of a GitHub pull request and posts one review comment', async () => {
        fetchPage.mockResolvedValueOnce({ status: 200, html: 'diff --git a/x b/x\n+added', bytes: 30 });
        const ctx = await skill.gather({ task: { ...task, links: [{ kind: 'pr', url: 'https://github.com/o/r/pull/12' }] } });
        expect(ctx.target).toBe('https://github.com/o/r/pull/12.diff');
        const { changes } = skill.toChanges({ task, raw: { summary: 'Adds x.', risks: [{ title: 'No test', severity: 'medium', where: 'x', why: 'untested' }] }, context: ctx });
        expect(changes).toHaveLength(1);
        expect(changes[0].action).toBe('task.comment');
        expect(changes[0].params.body).toContain('[medium] No test — x: untested');
    });
});

describe('digest.ceo (Reporter)', () => {
    const skill = getSkill('digest.ceo');
    const now = Date.parse('2026-09-04T12:00:00Z');
    const rows = [
        { TaskKey: 'AR-1', TaskName: 'Late', statusType: 'active', status: { text: 'In Progress' }, DueDate: '2026-09-01', AssigneeUserId: [] },
        { TaskKey: 'AR-2', TaskName: 'Stuck', statusType: 'active', status: { text: 'On Hold' }, AssigneeUserId: ['u'] },
        { TaskKey: 'AR-3', TaskName: 'Shipped', statusType: 'close', status: { text: 'Complete' } },
    ];
    it('buckets the board from ground truth', () => {
        const b = skill.buckets(rows, now);
        expect(b.total).toBe(2); expect(b.done).toBe(1);
        expect(b.overdue.map((t) => t.TaskKey)).toEqual(['AR-1']);
        expect(b.blocked.map((t) => t.TaskKey)).toEqual(['AR-2']);
        expect(b.unassigned.map((t) => t.TaskKey)).toEqual(['AR-1']);
    });
    it('still produces a digest when the model is unavailable', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(rows);
        const ctx = await skill.gather({ task, companyId: 'c1' });
        expect(ctx.fallback).toContain('2 open task(s): 1 overdue, 1 blocked');
        const { changes } = skill.toChanges({ task, raw: null, context: ctx });
        expect(changes[0].params.body).toContain('AR-1 Late');
    });
    it('runs end to end through the orchestrator without a model and proposes one comment', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(rows);
        const out = await orchestrator.run({ skillSlug: 'risk.today', task, companyId: 'c1', budget: { allowModel: false } });
        expect(out.status).toBe('success');
        expect(out.changes.map((c) => c.action)).toEqual(['task.comment']);
        expect(out.degraded).toBe('no LLM provider configured');
    });
});

describe('grounding — what the model was not given is dropped', () => {
    const digest = getSkill('digest.ceo');
    const rows = [
        { TaskKey: 'AR-1', TaskName: 'Late', statusType: 'active', status: { text: 'In Progress' }, DueDate: '2026-09-01', AssigneeUserId: [] },
        { TaskKey: 'AR-2', TaskName: 'Stuck', statusType: 'active', status: { text: 'On Hold' }, AssigneeUserId: ['u'] },
    ];
    it('drops a digest sentence that invents a number or a task key, keeps the rest', () => {
        const context = { buckets: digest.buckets(rows, Date.parse('2026-09-04T12:00:00Z')) };
        const raw = { digest: 'There are 2 open tasks moved in the last 24 hours. AR-1 is overdue. AR-17 has been in review for 24 days. Nothing else moved.', lookFirst: ['AR-1 — overdue', 'AR-99 — invented', 'AR-2 — blocked for 24 days'] };
        const { raw: cleaned, dropped } = digest.verify({ raw, context });
        expect(cleaned.digest).toBe('There are 2 open tasks moved in the last 24 hours. AR-1 is overdue. Nothing else moved.');
        expect(cleaned.lookFirst).toEqual(['AR-1 — overdue']);
        expect(dropped.map((d) => d.reason)).toEqual(['mentions AR-17, which is not in the data', 'look-first item names a task not in the data', 'look-first item claims "24", which is not in the data']);
    });
    it('drops a PR risk that cites a file the diff never touched', () => {
        const pr = getSkill('pr.summary');
        const context = { diff: 'diff --git a/Modules/Agents/runs.js b/Modules/Agents/runs.js\n+const x = 1;', url: 'u' };
        const raw = { summary: 's', risks: [{ title: 'Real', where: 'Modules/Agents/runs.js' }, { title: 'Invented', where: 'frontend/src/App.vue' }, { title: 'Unlocated' }] };
        const { raw: cleaned, dropped } = pr.verify({ raw, context });
        expect(cleaned.risks.map((r) => r.title)).toEqual(['Real', 'Unlocated']);
        expect(dropped[0].text).toBe('Invented');
    });
    it('is applied by the orchestrator, which reports what it dropped', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(rows);
        const out = await orchestrator.run({ skillSlug: 'digest.ceo', task, companyId: 'c1', budget: { allowModel: false } });
        expect(out.dropped).toEqual([]);
    });
});
