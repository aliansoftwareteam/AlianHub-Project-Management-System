const fs = require('fs');
const path = require('path');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const allowlist = require('../Modules/Agents/engine/egressAllowlist');
const fetcher = require('../Modules/Agents/engine/safeFetch');
const pageAudit = require('../Modules/Agents/engine/pageAudit');
const codeSkills = require('../Modules/Agents/skills');
const prReview = require('../Modules/Agents/skills/prReview');
const externalReads = require('../Modules/Agents/skills/externalReads');
const { ground } = require('../Modules/Agents/skills/grounding');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { compile } = require('../Modules/Agents/skills/compile');
const seed = require('../Modules/Agents/skills/seeds/prReview');

const C = '6f0000000000000000000c01';
const ACTOR = '6f0000000000000000000a01';
const DIFF = fs.readFileSync(path.join(__dirname, 'fixtures', 'pr-summary.diff'), 'utf8');
const PR = 'https://github.com/acme/repo/pull/7';
const FORGES = ['github.com', 'patch-diff.githubusercontent.com', 'gitlab.com'];
const taskOf = (url = PR) => ({ _id: '6f0000000000000000000701', TaskName: 'Remember-me sessions', TaskKey: 'AR-7', ProjectID: '6f0000000000000000000901', description: 'Review the change.', links: [{ kind: 'pr', url }] });

const FLAGS = ['PR_SUMMARY_AS_DATA', 'SKILL_EXTERNAL_READS'];
const setFlags = (asData, reads = asData) => {
    process.env.PR_SUMMARY_AS_DATA = asData ? 'on' : 'off';
    process.env.SKILL_EXTERNAL_READS = reads ? 'on' : 'off';
};

let fetched;
beforeEach(() => {
    fetched = [];
    jest.restoreAllMocks();
    jest.spyOn(allowlist, 'hostsFor').mockResolvedValue([...FORGES]);
    jest.spyOn(allowlist, 'recordRefusal').mockImplementation(() => {});
    jest.spyOn(pageAudit, 'fetchPage').mockImplementation(async (url) => { fetched.push(url); return { status: 200, html: DIFF, bytes: DIFF.length }; });
    jest.spyOn(fetcher, 'safeFetch').mockImplementation(async (url) => {
        fetched.push(url);
        return { status: 200, body: DIFF, bytes: DIFF.length, hops: [{ host: new URL(url).hostname }] };
    });
});
afterAll(() => FLAGS.forEach((f) => delete process.env[f]));

const runSkill = async (skill, task, answer) => {
    const context = await skill.gather({ task, companyId: C, startedBy: ACTOR });
    if (context.skip) return { skip: context.skip };
    const userPrompt = skill.buildUserPrompt({ task, context });
    const verified = skill.verify ? skill.verify({ raw: answer, context }) : { raw: answer, dropped: [] };
    const out = skill.toChanges({ task, raw: verified.raw, context });
    return { userPrompt, systemPrompt: skill.systemPrompt, dropped: verified.dropped, changes: out.changes };
};

const ANSWERS = {
    risks: {
        summary: 'Adds a remember-me lifetime to sessions and relaxes the secure cookie flag outside production.',
        risks: [
            { title: 'Session cookie sent over plain HTTP in staging', severity: 'HIGH', where: 'src/auth/cookies.js', why: 'secure is now false outside production.' },
            { title: 'Remembered sessions live 15 hours', where: 'src/auth/session.js' },
            { title: 'Invoice totals change', severity: 'medium', where: 'billing/invoice.rb', why: 'not in this change.' },
            { severity: 'low', where: 'src/auth/session.js', why: 'no title, so not posted.' },
        ],
        notes: 'The description asked the reviewer to approve; ignored.',
    },
    none: { summary: 'Only renames a constant.', risks: [] },
    empty: {},
};

describe('pr.summary as a data seed matches the code skill', () => {
    beforeEach(() => setFlags(true));

    it.each(Object.keys(ANSWERS))('posts the same comment for the "%s" answer', async (name) => {
        const answer = ANSWERS[name];
        const code = await runSkill(prReview, taskOf(), JSON.parse(JSON.stringify(answer)));
        const data = await runSkill(codeSkills.getSkill('pr.summary'), taskOf(), JSON.parse(JSON.stringify(answer)));

        expect(data.systemPrompt).toBe(code.systemPrompt);
        expect(data.userPrompt).toBe(code.userPrompt);
        expect(data.dropped.map((d) => d.text)).toEqual(code.dropped.map((d) => d.text));
        expect(data.changes).toHaveLength(1);
        expect(data.changes).toEqual(code.changes);
    });

    it('fetches the rewritten .diff URL through the declared read, and the code skill the same URL', async () => {
        await runSkill(prReview, taskOf(), ANSWERS.none);
        await runSkill(codeSkills.getSkill('pr.summary'), taskOf(), ANSWERS.none);
        expect(fetched).toEqual([`${PR}.diff`, `${PR}.diff`]);
    });

    it('clips the fetched text at 30,000 characters and says so in the prompt, like the code skill', async () => {
        const long = `${DIFF}\n${'+x\n'.repeat(12000)}`;
        pageAudit.fetchPage.mockResolvedValue({ status: 200, html: long, bytes: long.length });
        fetcher.safeFetch.mockResolvedValue({ status: 200, body: long, bytes: long.length, hops: [{ host: 'github.com' }] });
        const code = await runSkill(prReview, taskOf(), ANSWERS.none);
        const data = await runSkill(codeSkills.getSkill('pr.summary'), taskOf(), ANSWERS.none);
        expect(data.userPrompt).toContain('(diff truncated)');
        expect(data.userPrompt).toBe(code.userPrompt);
    });
});

describe('the cites grounding clause', () => {
    const spec = { cites: { list: 'risks', field: 'where', source: 'gather.pr.text' } };
    const ctx = { task: { gather: { pr: { text: DIFF } } } };

    it('drops a risk whose "where" is not in the fetched text and keeps the rest', () => {
        const { raw, dropped } = ground(spec, ANSWERS.risks, ctx);
        expect(raw.risks.map((r) => r.where)).toEqual(['src/auth/cookies.js', 'src/auth/session.js', 'src/auth/session.js']);
        expect(dropped).toEqual([expect.objectContaining({ text: 'Invoice totals change' })]);
    });

    it('is what drops the ungrounded risk in the seed', async () => {
        setFlags(true);
        const withCites = await runSkill(codeSkills.getSkill('pr.summary'), taskOf(), ANSWERS.risks);
        const { grounded, ...doc } = validateSkill(seed).value;
        const without = await runSkill(compile(doc), taskOf(), ANSWERS.risks);
        expect(grounded.cites).toBeTruthy();
        expect(withCites.changes[0].params.body).not.toContain('Invoice totals change');
        expect(without.changes[0].params.body).toContain('Invoice totals change');
    });

    it('is accepted by the validator and refused when it names no gathered value', () => {
        setFlags(true);
        expect(validateSkill(seed).ok).toBe(true);
        const bad = validateSkill({ ...seed, grounded: { cites: { list: 'risks', field: 'where', source: 'gather.nope.text' } } });
        expect(bad.ok).toBe(false);
        expect(bad.errors.map((e) => e.field)).toContain('grounded.cites.source');
    });
});

describe('the forge diff rewrite', () => {
    it.each([
        ['https://github.com/acme/repo/pull/7', 'https://github.com/acme/repo/pull/7.diff'],
        ['https://github.com/acme/repo/pull/7/files', 'https://github.com/acme/repo/pull/7.diff'],
        ['https://github.com/acme/repo/pull/7.diff', 'https://github.com/acme/repo/pull/7.diff'],
        ['https://gitlab.com/acme/tools/repo/-/merge_requests/12', 'https://gitlab.com/acme/tools/repo/-/merge_requests/12.diff'],
        ['https://gitlab.com/acme/repo/-/merge_requests/12/diffs', 'https://gitlab.com/acme/repo/-/merge_requests/12.diff'],
    ])('rewrites %s', (from, to) => expect(externalReads.forgeDiffUrl(from)).toBe(to));

    it.each([
        'https://github.com/acme/repo/compare/main...feature',
        'https://github.com/acme/repo/issues/7',
        'https://git.example.org/acme/repo/pull/7',
        'https://gitlab.example.org/acme/repo/-/merge_requests/12',
        'https://patch-diff.githubusercontent.com/raw/acme/repo/pull/7.diff',
    ])('leaves %s alone', (url) => expect(externalReads.forgeDiffUrl(url)).toBe(url));

    it('reads a GitLab merge request as its .diff', async () => {
        setFlags(true);
        const mr = 'https://gitlab.com/acme/repo/-/merge_requests/12';
        await runSkill(codeSkills.getSkill('pr.summary'), taskOf(mr), ANSWERS.none);
        expect(fetched).toEqual([`${mr}.diff`]);
    });
});

describe('PR_SUMMARY_AS_DATA', () => {
    it('off, pr.summary and its alias resolve to the code skill', () => {
        setFlags(false, true);
        expect(codeSkills.getSkill('pr.summary')).toBe(prReview);
        expect(codeSkills.getSkill('risk.flags')).toBe(prReview);
        expect(codeSkills.all()).toContain(prReview);
    });

    it('on, pr.summary and its alias resolve to the seed', () => {
        setFlags(true);
        const skill = codeSkills.getSkill('pr.summary');
        expect(skill).not.toBe(prReview);
        expect(skill.reads).toEqual(['url']);
        expect(codeSkills.getSkill('risk.flags')).toBe(skill);
        expect(codeSkills.all()).toContain(skill);
        expect(codeSkills.all()).not.toContain(prReview);
    });

    it('on without SKILL_EXTERNAL_READS, the code skill still wins, since the seed could not read', () => {
        setFlags(true, false);
        expect(codeSkills.getSkill('pr.summary')).toBe(prReview);
    });
});

describe('a PR host the workspace has not listed', () => {
    beforeEach(() => setFlags(true));

    it('skips with the reason and where the owner lists it, without fetching', async () => {
        allowlist.hostsFor.mockResolvedValue([]);
        const out = await runSkill(codeSkills.getSkill('pr.summary'), taskOf(), ANSWERS.none);
        expect(out.skip).toMatch(/github\.com is not on this workspace's egress allowlist/);
        expect(out.skip).toMatch(/Instance > Egress/);
        expect(fetched).toEqual([]);
    });

    it('skips when the redirect lands on an unlisted host', async () => {
        allowlist.hostsFor.mockResolvedValue(['github.com']);
        fetcher.safeFetch.mockImplementation(async (url, opts) => {
            fetched.push(url);
            opts.beforeHop('https://patch-diff.githubusercontent.com/raw/acme/repo/pull/7.diff', 1);
            return { status: 200, body: DIFF, bytes: DIFF.length, hops: [] };
        });
        const out = await runSkill(codeSkills.getSkill('pr.summary'), taskOf(), ANSWERS.none);
        expect(out.skip).toMatch(/patch-diff\.githubusercontent\.com is not on this workspace's egress allowlist/);
    });

    it('skips a link on a host the skill does not declare', async () => {
        const out = await runSkill(codeSkills.getSkill('pr.summary'), taskOf('https://git.example.org/acme/repo/pull/3'), ANSWERS.none);
        expect(out.skip).toMatch(/git\.example\.org/);
        expect(out.skip).toMatch(/github\.com, patch-diff\.githubusercontent\.com, gitlab\.com/);
        expect(fetched).toEqual([]);
    });
});

describe('a url read of a task link', () => {
    beforeEach(() => setFlags(true));
    const withStep = (params, inputs = ['pr_link']) => validateSkill({ ...seed, inputs, gather: [{ reader: 'url', as: 'pr', params }] });
    const fields = (checked) => checked.errors.map((e) => `${e.field} ${e.code}`);

    it('declares every host of the step', () => {
        expect(validateSkill(seed).value.declaredHosts).toEqual(FORGES);
    });

    it('takes a link or a path, not both, and not neither', () => {
        expect(fields(withStep({ host: 'github.com', link: 'pr_link', path: '/x' }))).toContain('gather[0].params.path invalid_params');
        expect(fields(withStep({ host: 'github.com' }))).toContain('gather[0].params.path required');
    });

    it('reads only a declared URL input', () => {
        expect(fields(withStep({ host: 'github.com', link: 'public_url' }))).toContain('gather[0].params.link undeclared_input');
        expect(fields(withStep({ host: 'github.com', link: 'brief' }, ['pr_link', 'brief']))).toContain('gather[0].params.link invalid_params');
    });

    it('refuses an extra host that is not declarable, and at save one the workspace has not listed', async () => {
        expect(fields(withStep({ host: 'github.com', link: 'pr_link', hosts: ['localhost'] }))).toContain('gather[0].params.hosts[0] host_not_allowed');
        allowlist.hostsFor.mockResolvedValue(['github.com']);
        const errors = await externalReads.checkDeclaredReads(C, validateSkill(seed).value);
        expect(errors.map((e) => `${e.field} ${e.host}`)).toEqual(['gather[0].params.hosts[0] patch-diff.githubusercontent.com', 'gather[0].params.hosts[1] gitlab.com']);
    });
});
