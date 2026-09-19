const fs = require('fs');
const path = require('path');

const AGENTS = path.join(__dirname, '..', '..', 'Modules', 'Agents');
const FETCHING_NAMES = { safeFetch: ['safeFetch'], pageAudit: ['fetchPage', 'audit'], agentFetch: ['fetchPage', 'audit'] };
const CID = '6f00000000000000000000a1';
const ACTOR = '6f0000000000000000000011';

const useSkill = (skill) => require('../../Modules/Agents/skillRecord').getSkill.mockResolvedValue(skill);
const orchestrator = () => require('../../Modules/Agents/engine/orchestrator');

/* Every file under Modules/Agents that imports a fetching function. A static scan cannot see whether a call sits
 * inside egressContext.run, so a file that reads pages is listed with a `reach` that drives its real entry point,
 * and a new caller fails here until it is listed with one. */
const FETCHERS = {
    'engine/pageAudit.js': { from: 'safeFetch', names: ['safeFetch'] },
    'engine/agentFetch.js': { from: 'pageAudit', names: ['*'] },
    'engine/orchestrator.js': {
        from: 'agentFetch',
        names: ['audit'],
        reach: () => {
            useSkill({ slug: 'qa-review', kind: 'audit', maxFindings: 5, buildUserPrompt: () => '' });
            return orchestrator().analyse({ skillSlug: 'qa-review', task: { _id: 't1' }, context: { url: 'https://example.com/pricing' }, spend: { companyId: CID, userId: ACTOR }, companyId: CID });
        },
    },
    'skills/prReview.js': {
        from: 'agentFetch',
        names: ['fetchPage'],
        reach: () => {
            useSkill(require('../../Modules/Agents/skills/prReview'));
            const task = { _id: 't1', TaskName: 'Review', links: [{ kind: 'pr', url: 'https://github.com/acme/repo/pull/7' }] };
            return orchestrator().gather({ skillSlug: 'pr.summary', task, companyId: CID, startedBy: ACTOR });
        },
    },
};

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
});

const REQUIRE = /(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](\.[^'"]*)['"]\s*\)/g;

const fetchImports = (file) => {
    const found = [];
    for (const [, binding, target] of fs.readFileSync(file, 'utf8').matchAll(REQUIRE)) {
        const from = path.basename(target).replace(/\.js$/, '');
        if (!FETCHING_NAMES[from]) continue;
        const names = binding.startsWith('{') ? binding.slice(1, -1).split(',').map((name) => name.split(':')[0].trim()).filter(Boolean) : ['*'];
        const fetching = names.filter((name) => name === '*' || FETCHING_NAMES[from].includes(name));
        if (fetching.length) found.push({ from, names: fetching });
    }
    return found;
};

const found = Object.fromEntries(sourceFiles(AGENTS)
    .map((file) => [path.relative(AGENTS, file).split(path.sep).join('/'), fetchImports(file)])
    .filter(([, imports]) => imports.length));

const importersOf = (module) => Object.keys(found).filter((file) => found[file].some((i) => i.from === module)).sort();

describe('agent fetches go through the workspace egress gateway', () => {
    it('lists every file under Modules/Agents that imports a fetching function, and no other', () => {
        expect(Object.keys(found).sort()).toEqual(Object.keys(FETCHERS).sort());
    });

    it.each(Object.keys(FETCHERS))('%s imports only what it is listed with', (file) => {
        expect(found[file]).toEqual([{ from: FETCHERS[file].from, names: FETCHERS[file].names }]);
    });

    it('only the raw reader calls safeFetch, and only the agent-facing entry reads through the raw reader', () => {
        expect(importersOf('safeFetch')).toEqual(['engine/pageAudit.js']);
        expect(importersOf('pageAudit')).toEqual(['engine/agentFetch.js']);
    });

    describe('with the flag on', () => {
        let seen;

        beforeEach(() => {
            jest.resetModules();
            seen = [];
            jest.doMock('../../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
            jest.doMock('../../Config/config', () => ({ myCache: new (require('node-cache'))() }));
            jest.doMock('../../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
            jest.doMock('../../Modules/Agents/skillRecord', () => ({ getSkill: jest.fn(), SOURCE: { CODE: 'code' } }));
            jest.doMock('../../Modules/Agents/engine/safeFetch', () => ({
                ...jest.requireActual('../../Modules/Agents/engine/safeFetch'),
                safeFetch: jest.fn(async () => {
                    seen.push(require('../../Modules/Agents/engine/egressContext').get());
                    return { status: 500, headers: {}, body: '', bytes: 0, url: '' };
                }),
            }));
            process.env.AGENT_EGRESS_ALLOWLIST = 'true';
        });

        afterEach(() => { delete process.env.AGENT_EGRESS_ALLOWLIST; });

        it.each(importersOf('agentFetch'))('%s fetches inside the workspace egress context', async (file) => {
            expect(typeof (FETCHERS[file] || {}).reach).toBe('function');
            await FETCHERS[file].reach();
            expect(seen).toEqual([{ companyId: CID, actor: ACTOR }]);
        });

        it('a read outside the context is refused rather than made under the open rules', async () => {
            const { fetchPage, audit } = require('../../Modules/Agents/engine/agentFetch');
            await expect(fetchPage('https://github.com/acme/repo/pull/7.diff')).rejects.toMatchObject({ code: 'no_workspace' });
            await expect(audit('https://example.com/pricing')).rejects.toMatchObject({ code: 'no_workspace' });
            expect(seen).toEqual([]);
        });
    });
});
