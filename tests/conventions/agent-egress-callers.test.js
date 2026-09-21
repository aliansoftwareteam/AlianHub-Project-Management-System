const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
/* Everything an agent run can reach: the agents themselves, the workflow and automation engines that start them
 * and hold their tool steps, the MCP server's tools, knowledge retrieval, and the model layer they all call. */
const SCANNED = ['Modules/Agents', 'Modules/Workflows', 'Modules/Automations', 'Modules/Mcp', 'Modules/Knowledge', 'Modules/AICore'];
const FETCH_HELPERS = { safeFetch: ['safeFetch'], pageAudit: ['fetchPage', 'audit'], agentFetch: ['fetchPage', 'audit'] };
const CID = '6f00000000000000000000a1';
const ACTOR = '6f0000000000000000000011';

const useSkill = (skill) => require('../../Modules/Agents/skillRecord').getSkill.mockResolvedValue(skill);
const orchestrator = () => require('../../Modules/Agents/engine/orchestrator');

/* Every file that reads pages through the fetch helpers. A static scan cannot see whether a call sits inside
 * egressContext.run, so each is listed with a `reach` that drives its real entry point. */
const FETCHERS = {
    'Modules/Agents/engine/pageAudit.js': { uses: ['helper:safeFetch.safeFetch'] },
    'Modules/Agents/engine/agentFetch.js': { uses: ['helper:pageAudit.*'] },
    'Modules/Agents/engine/orchestrator.js': {
        uses: ['helper:agentFetch.audit'],
        reach: () => {
            useSkill({ slug: 'qa-review', kind: 'audit', maxFindings: 5, buildUserPrompt: () => '' });
            return orchestrator().analyse({ skillSlug: 'qa-review', task: { _id: 't1' }, context: { url: 'https://example.com/pricing' }, spend: { companyId: CID, userId: ACTOR }, companyId: CID });
        },
    },
    'Modules/Agents/skills/prReview.js': {
        uses: ['helper:agentFetch.fetchPage'],
        reach: () => {
            useSkill(require('../../Modules/Agents/skills/prReview'));
            const task = { _id: 't1', TaskName: 'Review', links: [{ kind: 'pr', url: 'https://github.com/acme/repo/pull/7' }] };
            return orchestrator().gather({ skillSlug: 'pr.summary', task, companyId: CID, startedBy: ACTOR });
        },
    },
};

// Deliberately outside the workspace gateway: none of these fetches a URL taken from task text.
const OUTSIDE_GATEWAY = {
    'Modules/Agents/engine/safeFetch.js': { uses: ['axios'], why: 'the gateway itself: every agent fetch leaves the box here, after the list check' },
    'Modules/AICore/llmProvider/openaiProvider.js': { uses: ['axios'], why: 'model provider and embeddings calls to the endpoint the instance configures' },
    'Modules/AICore/llmProvider/deepseekProvider.js': { uses: ['axios'], why: 'model provider calls to the endpoint the instance configures' },
    'Modules/AICore/llmProvider/googleProvider.js': { uses: ['axios'], why: 'model provider calls to the endpoint the instance configures' },
};

const HTTP_MODULES = {
    axios: 'axios',
    http: 'http', https: 'http', http2: 'http', 'node:http': 'http', 'node:https': 'http', 'node:http2': 'http',
    undici: 'undici',
    'node-fetch': 'node-fetch',
    got: 'http-client', superagent: 'http-client', request: 'http-client',
};

/* Line and block comments go, so prose about "every fetch" is not a call. A `//` counts only after whitespace or at
 * a line start, which leaves the `//` inside 'https://…' strings alone. */
const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

/* String contents go too, for the call patterns only, so a URL such as 'https://x/fetch(1)' is not a call. A
 * template keeps its ${…} expressions, which are code. */
const blankStrings = (source) => source
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, (template) => (template.match(/\$\{[^}]*\}/g) || []).join(' '));

const REQUIRE = /(?:(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*)?\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g;
const IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;

const helperOf = (specifier) => {
    const base = path.basename(specifier).replace(/\.js$/, '');
    return specifier.startsWith('.') && FETCH_HELPERS[base] ? base : null;
};

/* Each module a file loads, with the names it takes from it ('*' for the whole module). */
const loads = (source) => [
    ...[...source.matchAll(REQUIRE)].map(([, binding, specifier, member]) => ({
        specifier,
        names: binding && binding.startsWith('{') && !member
            ? binding.slice(1, -1).split(',').map((name) => name.split(':')[0].trim()).filter(Boolean)
            : [member || '*'],
    })),
    ...[...source.matchAll(IMPORT)].map(([, a, b, c]) => ({ specifier: a || b || c, names: ['*'] })),
];

/* What a source file uses to reach the network, as kinds a reviewer can read. */
const outboundUses = (raw) => {
    const source = stripComments(raw);
    const code = blankStrings(source);
    const uses = new Set();
    for (const { specifier, names } of loads(source)) {
        if (HTTP_MODULES[specifier]) uses.add(HTTP_MODULES[specifier]);
        const helper = helperOf(specifier);
        if (helper) names.filter((name) => name === '*' || FETCH_HELPERS[helper].includes(name)).forEach((name) => uses.add(`helper:${helper}.${name}`));
    }
    if (/\baxios\s*[.(]/.test(code)) uses.add('axios');
    if (/\bhttps?2?\s*\.\s*(request|get|connect)\s*\(/.test(code)) uses.add('http');
    if (/(^|[^\w$.])fetch\s*\(/m.test(code) || /\b(globalThis|global|window|self)\s*(\.\s*fetch\b|\[\s*['"`]fetch['"`]\s*\])/.test(source)) uses.add('fetch');
    return [...uses].sort();
};

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(c|m)?js$/.test(entry.name) ? [full] : [];
});

const scan = (files) => Object.fromEntries(Object.entries(files)
    .map(([file, source]) => [file, outboundUses(source)])
    .filter(([, uses]) => uses.length));

const LISTED = { ...FETCHERS, ...OUTSIDE_GATEWAY };

/* A file whose uses differ from its listing, or that is not listed at all. */
const unexpected = (found) => Object.keys(found)
    .filter((file) => !LISTED[file] || JSON.stringify(found[file]) !== JSON.stringify([...LISTED[file].uses].sort()))
    .sort();

const repoFiles = Object.fromEntries(SCANNED.flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
    .map((full) => [path.relative(ROOT, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8')]));
const found = scan(repoFiles);

const importersOf = (helper) => Object.keys(found).filter((file) => found[file].some((use) => use.startsWith(`helper:${helper}.`))).sort();

describe('agent fetches go through the workspace egress gateway', () => {
    it('scans every folder an agent run can reach', () => {
        SCANNED.forEach((dir) => expect(fs.statSync(path.join(ROOT, dir)).isDirectory()).toBe(true));
        SCANNED.forEach((dir) => expect(Object.keys(repoFiles).some((file) => file.startsWith(`${dir}/`))).toBe(true));
    });

    it('finds no outbound call that is neither a listed gateway caller nor listed as outside the gateway', () => {
        expect(unexpected(found)).toEqual([]);
    });

    it('lists no file that no longer makes the call it is listed for', () => {
        expect(Object.keys(LISTED).filter((file) => !found[file]).sort()).toEqual([]);
    });

    it('gives every file outside the gateway a reason', () => {
        Object.values(OUTSIDE_GATEWAY).forEach(({ why }) => expect(String(why || '').length).toBeGreaterThan(20));
    });

    it('only the raw reader calls safeFetch, and only the agent-facing entry reads through the raw reader', () => {
        expect(importersOf('safeFetch')).toEqual(['Modules/Agents/engine/pageAudit.js']);
        expect(importersOf('pageAudit')).toEqual(['Modules/Agents/engine/agentFetch.js']);
    });

    describe('the scan itself', () => {
        const EVASIONS = [
            ['axios required', "const axios = require('axios');\nmodule.exports = (u) => axios.get(u);", 'axios'],
            ['axios imported', "import axios from 'axios';\nexport default (u) => axios(u);", 'axios'],
            ['axios required inline', "module.exports = (u) => require('axios').get(u);", 'axios'],
            ['axios handed in', 'module.exports = ({ axios }) => (u) => axios.post(u, {});', 'axios'],
            ['https request', "const https = require('https');\nmodule.exports = (u) => https.request(u);", 'http'],
            ['http get', "const http = require('node:http');\nmodule.exports = (u) => http.get(u);", 'http'],
            ['https destructured', "const { request } = require('https');\nmodule.exports = (u) => request(u);", 'http'],
            ['undici', "const { request } = require('undici');\nmodule.exports = (u) => request(u);", 'undici'],
            ['node-fetch', "const fetch = require('node-fetch');\nmodule.exports = (u) => fetch(u);", 'node-fetch'],
            ['global fetch', 'module.exports = async (u) => (await fetch(u)).text();', 'fetch'],
            ['global fetch on its own line', 'module.exports = async (u) => {\n    const r = await\n        fetch(u);\n    return r;\n};', 'fetch'],
            ['globalThis.fetch', 'module.exports = (u) => globalThis.fetch(u);', 'fetch'],
            ['fetch by index', "module.exports = (u) => globalThis['fetch'](u);", 'fetch'],
            ['inline safeFetch', "module.exports = (u) => require('../engine/safeFetch').safeFetch(u);", 'helper:safeFetch.safeFetch'],
            ['inline pageAudit', "module.exports = (u) => require('../Agents/engine/pageAudit').fetchPage(u);", 'helper:pageAudit.fetchPage'],
            ['inline agentFetch', "module.exports = (u) => require('../../Agents/engine/agentFetch.js').audit(u);", 'helper:agentFetch.audit'],
            ['helper namespace', "const sf = require('./safeFetch');\nmodule.exports = (u) => sf.safeFetch(u);", 'helper:safeFetch.*'],
            ['helper renamed', "const { fetchPage: read } = require('./agentFetch');\nmodule.exports = read;", 'helper:agentFetch.fetchPage'],
            ['helper imported', "import { safeFetch } from '../engine/safeFetch';\nexport default safeFetch;", 'helper:safeFetch.*'],
        ];

        it.each(EVASIONS)('catches %s', (label, source, kind) => {
            expect(outboundUses(source)).toContain(kind);
        });

        it.each(EVASIONS)('reports a file that does it (%s)', (label, source) => {
            const file = 'Modules/Workflows/stepTypes/egfx-evader.js';
            expect(unexpected(scan({ ...repoFiles, [file]: source }))).toEqual([file]);
        });

        it('reports a listed file that gains another way out', () => {
            const file = 'Modules/Agents/skills/prReview.js';
            expect(unexpected(scan({ ...repoFiles, [file]: `${repoFiles[file]}\nconst leak = (u) => fetch(u);\n` }))).toEqual([file]);
        });

        it.each([
            ['prose in a comment', '// every fetch( goes through safeFetch\n/* axios.get(u) */\nmodule.exports = 1;'],
            ['a URL in a string', "const url = 'https://example.com/fetch(x)';\nmodule.exports = url;"],
            ['a method named fetch on another object', 'module.exports = (store) => store.fetch(1);'],
            ['a helper call name', 'module.exports = (safeFetch, fetchPage) => [safeFetch(1), fetchPage(2)];'],
            ['the private-host check from safeFetch', "const { isBlockedHostname } = require('./engine/safeFetch');\nmodule.exports = isBlockedHostname;"],
            ['the URL finder from pageAudit', "const { extractUrl } = require('./pageAudit');\nmodule.exports = require('./pageAudit').extractUrl;"],
        ])('leaves %s alone', (label, source) => {
            expect(outboundUses(source)).toEqual([]);
        });
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
