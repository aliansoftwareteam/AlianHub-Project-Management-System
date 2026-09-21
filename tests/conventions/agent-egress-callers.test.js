const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
/* Everything an agent run can reach: the agents themselves, the workflow and automation engines that start them
 * and hold their tool steps, the MCP server's tools, knowledge retrieval, and the model layer they all call. */
const SCANNED = ['Modules/Agents', 'Modules/Workflows', 'Modules/Automations', 'Modules/Mcp', 'Modules/Knowledge', 'Modules/AICore'];
const FETCH_HELPERS = { safeFetch: ['safeFetch'], pageAudit: ['fetchPage', 'audit'], agentFetch: ['fetchPage', 'audit', 'readDeclared'] };
const CID = '6f00000000000000000000a1';
const ACTOR = '6f0000000000000000000011';

const useSkill = (skill) => require('../../Modules/Agents/skillRecord').getSkill.mockResolvedValue(skill);
const orchestrator = () => require('../../Modules/Agents/engine/orchestrator');

/* Every file that reads pages through the fetch helpers. A static scan cannot see whether a call sits inside
 * egressContext.run, so each is listed with a `reach` that drives its real entry point. */
const FETCHERS = {
    'Modules/Agents/engine/pageAudit.js': { uses: ['helper:safeFetch.safeFetch'] },
    'Modules/Agents/engine/agentFetch.js': { uses: ['helper:pageAudit.*', 'helper:safeFetch.*'] },
    'Modules/Agents/engine/orchestrator.js': {
        uses: ['helper:agentFetch.audit'],
        reach: () => {
            useSkill({ slug: 'qa-review', kind: 'audit', maxFindings: 5, buildUserPrompt: () => '' });
            return orchestrator().analyse({ skillSlug: 'qa-review', task: { _id: 't1' }, context: { url: 'https://example.com/pricing' }, spend: { companyId: CID, userId: ACTOR }, companyId: CID });
        },
    },
    'Modules/Agents/skills/readers.js': {
        uses: ['helper:agentFetch.readDeclared'],
        reach: async () => {
            process.env.SKILL_EXTERNAL_READS = 'on';
            try {
                const { validateSkill } = require('../../Modules/Agents/skills/validateSkill');
                const { compile } = require('../../Modules/Agents/skills/compile');
                const doc = validateSkill({
                    key: 'reads.probe',
                    name: 'Probe',
                    inputs: [],
                    gather: [{ reader: 'api', as: 'r', params: { host: 'api.github.com', path: '/repos/acme/repo' } }],
                    prompt: { template: '{{gather.r.text}}', output: '{"summary":"..."}' },
                    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
                }).value;
                useSkill(compile(doc));
                jest.spyOn(require('../../Modules/Agents/engine/egressAllowlist'), 'hostsFor').mockResolvedValue(['api.github.com']);
                return await orchestrator().gather({ skillSlug: 'reads.probe', task: { _id: 't1', TaskName: 'Read' }, companyId: CID, startedBy: ACTOR });
            } finally {
                delete process.env.SKILL_EXTERNAL_READS;
            }
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
    'Modules/Agents/engine/safeFetch.js': { uses: ['axios', 'socket'], why: 'the gateway itself: every agent fetch leaves the box here, after the list check; net is for isIP' },
    'Modules/AICore/llmProvider/openaiProvider.js': { uses: ['axios'], why: 'model provider and embeddings calls to the endpoint the instance configures' },
    'Modules/AICore/llmProvider/deepseekProvider.js': { uses: ['axios'], why: 'model provider calls to the endpoint the instance configures' },
    'Modules/AICore/llmProvider/googleProvider.js': { uses: ['axios'], why: 'model provider calls to the endpoint the instance configures' },
    'Modules/AICore/llmProvider/anthropicProvider.js': { uses: ['sdk:@anthropic-ai/sdk'], why: 'model provider calls through the Anthropic SDK to the endpoint the instance configures' },
    'Modules/Knowledge/ingest/extract/extractor.js': { uses: ['process'], why: 'starts the thread an uploaded file is parsed in, with an empty environment; nothing is fetched' },
    'Modules/Knowledge/ingest/extract/parseWorker.js': { uses: ['process'], why: 'that thread itself, reading the bytes it was handed; nothing is fetched' },
};

/* Node modules that reach the network (or run a process that could), as the kind a finding names. */
const MODULE_KINDS = {
    axios: 'axios',
    http: 'http', https: 'http', http2: 'http',
    undici: 'undici',
    'node-fetch': 'node-fetch', 'cross-fetch': 'node-fetch', 'isomorphic-fetch': 'node-fetch',
    got: 'http-client', superagent: 'http-client', request: 'http-client', ky: 'http-client', needle: 'http-client',
    net: 'socket', tls: 'socket', dgram: 'socket', ws: 'socket', 'socket.io-client': 'socket',
    child_process: 'process', worker_threads: 'process', vm: 'eval',
    '@anthropic-ai/sdk': 'sdk:@anthropic-ai/sdk', openai: 'sdk:openai', '@google/generative-ai': 'sdk:@google/generative-ai', '@google/genai': 'sdk:@google/genai',
};
// The LangGraph runtime and LangChain core make no calls of their own; every other @langchain package is a model or loader client.
const QUIET_LANGCHAIN = /^@langchain\/(langgraph|langgraph-[\w-]+|core)(\/|$)/;

const kindOfModule = (specifier) => {
    const name = specifier.replace(/^node:/, '');
    if (MODULE_KINDS[name]) return MODULE_KINDS[name];
    if (/^@langchain\//.test(name) && !QUIET_LANGCHAIN.test(name)) return `sdk:${name.split('/').slice(0, 2).join('/')}`;
    if (/^@modelcontextprotocol\/sdk\/client(\/|$)/.test(name)) return 'sdk:@modelcontextprotocol/sdk/client';
    return null;
};

/* Line and block comments go, so prose about "every fetch" is not a call. A `//` counts only after whitespace or at
 * a line start, which leaves the `//` inside 'https://…' strings alone. */
const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

/* String contents go too, for the identifier patterns only, so a URL such as 'https://x/fetch(1)' is not a use. A
 * template keeps its ${…} expressions, which are code. */
const blankStrings = (source) => source
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, (template) => (template.match(/\$\{[^}]*\}/g) || []).join(' '));

const LITERAL = String.raw`['"\x60]([^'"\x60$]+)['"\x60]`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* `const r = require` (or `= module.require`) makes r a require too. */
const requireNames = (code) => ['require', ...[...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:module\s*\.\s*)?require\b(?!\s*\()/g)].map(([, name]) => name)];

/* Each module a file loads, with the names it takes from it ('*' for the whole module). */
const loads = (source, code) => {
    const callee = requireNames(code).map(escape).join('|');
    const require = new RegExp(String.raw`(?:(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*)?(?<![\w$.])(?:${callee})\s*\(\s*${LITERAL}\s*\)(?:\s*\.\s*([A-Za-z_$][\w$]*))?`, 'g');
    const imports = new RegExp(String.raw`\bimport\s*\(\s*${LITERAL}\s*\)|\bfrom\s+${LITERAL}|^\s*import\s+${LITERAL}`, 'gm');
    return [
        ...[...source.matchAll(require)].map(([, binding, specifier, member]) => ({
            specifier,
            names: binding && binding.startsWith('{') && !member
                ? binding.slice(1, -1).split(',').map((name) => name.split(':')[0].trim()).filter(Boolean)
                : [member || '*'],
        })),
        ...[...source.matchAll(imports)].map(([, a, b, c]) => ({ specifier: a || b || c, names: ['*'] })),
    ];
};

const HELPER_FILES = Object.fromEntries(Object.keys(FETCH_HELPERS).map((name) => [`Modules/Agents/engine/${name}.js`, name]));

const isFile = (file) => { try { return fs.statSync(path.join(ROOT, file)).isFile(); } catch (e) { return false; } };

/* A relative specifier as the file it loads: the path, then .js, then a folder's index.js. */
const resolve = (from, specifier, files) => {
    if (!specifier.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    return [base, `${base}.js`, `${base}/index.js`].find((file) => (files[file] !== undefined ? true : isFile(file))) || null;
};

const readSource = (file, files) => (files[file] !== undefined ? files[file] : fs.readFileSync(path.join(ROOT, file), 'utf8'));

// Shared helpers outside the scanned folders: an agent module that loads one that reaches the network is reported.
const HOP_FOLDERS = ['utils/', 'Config/'];

/* What a source file uses to reach the network, as kinds a reviewer can read. `file` and `files` let a relative
 * require be resolved: a fetch helper by path or name, and one hop into utils/ and Config/. */
const outboundUses = (raw, file = '', files = {}, hop = true) => {
    const source = stripComments(raw);
    const code = blankStrings(source);
    const uses = new Set();
    for (const { specifier, names } of loads(source, code)) {
        const kind = kindOfModule(specifier);
        if (kind) uses.add(kind);
        const target = file ? resolve(file, specifier, files) : null;
        const helper = (target && HELPER_FILES[target]) || (specifier.startsWith('.') && FETCH_HELPERS[path.posix.basename(specifier).replace(/\.js$/, '')] ? path.posix.basename(specifier).replace(/\.js$/, '') : null);
        if (helper) names.filter((name) => name === '*' || FETCH_HELPERS[helper].includes(name)).forEach((name) => uses.add(`helper:${helper}.${name}`));
        if (hop && target && HOP_FOLDERS.some((folder) => target.startsWith(folder)) && outboundUses(readSource(target, files), target, files, false).length) uses.add(`via:${target}`);
    }
    if (/\baxios\s*[.(]/.test(code)) uses.add('axios');
    if (/\bhttps?2?\s*\.\s*(request|get|connect)\s*\(/.test(code)) uses.add('http');
    if (/(?<![\w$.])fetch(?![\w$])/.test(code.replace(/([{,]\s*)fetch(\s*:)/g, '$1$2'))) uses.add('fetch');
    if (/\b(globalThis|global|window|self)\s*(\.\s*fetch\b|\[\s*['"\x60]fetch['"\x60]\s*\])/.test(source)) uses.add('fetch');
    if (/\b(globalThis|global|window|self)\s*\[/.test(code) || /\bReflect\s*\.\s*(get|apply)\s*\(\s*(globalThis|global|window|self)\b/.test(code)) uses.add('global-computed');
    if (/(?<![\w$.])eval\s*\(/.test(code) || /\bnew\s+Function\s*\(/.test(code) || /(?<![\w$.])Function\s*\(/.test(code)) uses.add('eval');
    return [...uses].sort();
};

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(c|m)?js$/.test(entry.name) ? [full] : [];
});

const inScanned = (file) => SCANNED.some((dir) => file.startsWith(`${dir}/`));

const scan = (files) => Object.fromEntries(Object.entries(files)
    .filter(([file]) => inScanned(file))
    .map(([file, source]) => [file, outboundUses(source, file, files)])
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

    it('only the raw reader and the agent-facing entry call safeFetch, and only the agent-facing entry reads through the raw reader', () => {
        expect(importersOf('safeFetch')).toEqual(['Modules/Agents/engine/agentFetch.js', 'Modules/Agents/engine/pageAudit.js']);
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
            ['https handed in', 'module.exports = ({ https }) => (u) => https.get(u);', 'http'],
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
            ['axios by a template require', 'module.exports = (u) => require(`axios`).get(u);', 'axios'],
            ['https by a template require', 'module.exports = (u) => require(`https`).get(u);', 'http'],
            ['undici by a template import', 'module.exports = async (u) => (await import(`undici`)).request(u);', 'undici'],
            ['safeFetch by a template require', 'module.exports = (u) => require(`./engine/safeFetch`).safeFetch(u);', 'helper:safeFetch.safeFetch'],
            ['an aliased require', "const r = require;\nmodule.exports = (u) => r('https').get(u);", 'http'],
            ['fetch called through .call', 'module.exports = (u) => fetch.call(null, u);', 'fetch'],
            ['fetch held in a variable', 'const f = fetch;\nmodule.exports = (u) => f(u);', 'fetch'],
            ['fetch passed as a value', 'module.exports = (u) => [u].map(fetch);', 'fetch'],
            ['a computed global lookup', "module.exports = (u) => globalThis['fe' + 'tch'](u);", 'global-computed'],
            ['Reflect.get on the global', "module.exports = (u) => Reflect.get(globalThis, 'fetch')(u);", 'global-computed'],
            ['child_process', "const { execFile } = require('child_process');\nmodule.exports = (u) => execFile('curl', [u]);", 'process'],
            ['node:child_process', "const cp = require('node:child_process');\nmodule.exports = (u) => cp.spawn('curl', [u]);", 'process'],
            ['net', "const net = require('net');\nmodule.exports = (h) => net.connect(80, h);", 'socket'],
            ['tls', "const tls = require('tls');\nmodule.exports = (h) => tls.connect(443, h);", 'socket'],
            ['ws', "const WebSocket = require('ws');\nmodule.exports = (u) => new WebSocket(u);", 'socket'],
            ['cross-fetch', "const fetchIt = require('cross-fetch');\nmodule.exports = (u) => fetchIt(u);", 'node-fetch'],
            ['ky', "const ky = require('ky');\nmodule.exports = (u) => ky.get(u);", 'http-client'],
            ['the Anthropic SDK', "const Anthropic = require('@anthropic-ai/sdk');\nmodule.exports = (o) => new Anthropic(o);", 'sdk:@anthropic-ai/sdk'],
            ['the OpenAI SDK', "const OpenAI = require('openai');\nmodule.exports = (o) => new OpenAI(o);", 'sdk:openai'],
            ['a LangChain OpenAI model', "const { ChatOpenAI } = require('@langchain/openai');\nmodule.exports = (o) => new ChatOpenAI(o);", 'sdk:@langchain/openai'],
            ['a LangChain Anthropic model', "const { ChatAnthropic } = require('@langchain/anthropic');\nmodule.exports = (o) => new ChatAnthropic(o);", 'sdk:@langchain/anthropic'],
            ['a LangChain community loader', "const { CheerioWebBaseLoader } = require('@langchain/community/document_loaders/web/cheerio');\nmodule.exports = (u) => new CheerioWebBaseLoader(u);", 'sdk:@langchain/community'],
            ['an MCP client transport', "const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');\nmodule.exports = (u) => new StreamableHTTPClientTransport(new URL(u));", 'sdk:@modelcontextprotocol/sdk/client'],
            ['an MCP SSE client transport', "import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';\nexport default (u) => new SSEClientTransport(new URL(u));", 'sdk:@modelcontextprotocol/sdk/client'],
            ['eval of a built string', "module.exports = (u) => eval('fe' + 'tch')(u);", 'eval'],
            ['new Function', "module.exports = (u) => new Function('u', 'return fe' + 'tch(u)')(u);", 'eval'],
        ];

        it.each(EVASIONS)('catches %s', (label, source, kind) => {
            expect(outboundUses(source)).toContain(kind);
        });

        it.each(EVASIONS)('reports a file that does it (%s)', (label, source) => {
            const file = 'Modules/Workflows/stepTypes/egfx-evader.js';
            expect(unexpected(scan({ ...repoFiles, [file]: source }))).toEqual([file]);
        });

        const HELPER = "const axios = require('axios');\nmodule.exports = (u) => axios.get(u);";

        it.each([
            ['a utils helper', 'utils/egfx-client.js', '../../../utils/egfx-client'],
            ['a Config helper', 'Config/egfx-client.js', '../../../Config/egfx-client.js'],
            ['a utils folder index', 'utils/egfx-net/index.js', '../../../utils/egfx-net'],
        ])('follows a require into %s that reaches the network', (label, helperFile, specifier) => {
            const caller = 'Modules/Agents/skills/egfx-caller.js';
            const files = { ...repoFiles, [helperFile]: HELPER, [caller]: `const get = require('${specifier}');\nmodule.exports = get;` };
            expect(unexpected(scan(files))).toEqual([caller]);
        });

        it('does not report a utils helper that makes no call', () => {
            const caller = 'Modules/Agents/skills/egfx-caller.js';
            const files = { ...repoFiles, 'utils/egfx-quiet.js': 'module.exports = (x) => x + 1;', [caller]: "module.exports = require('../../../utils/egfx-quiet');" };
            expect(unexpected(scan(files))).toEqual([]);
        });

        it('reports a folder index under a scanned folder that fetches', () => {
            const index = 'Modules/Workflows/egfx-net/index.js';
            const files = { ...repoFiles, [index]: 'module.exports = (u) => fetch(u);', 'Modules/Workflows/egfx-caller.js': "module.exports = require('./egfx-net');" };
            expect(unexpected(scan(files))).toEqual([index]);
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
            ['the agent graph runtime', "const { StateGraph } = require('@langchain/langgraph');\nmodule.exports = StateGraph;"],
            ['a fetch key in an object', 'module.exports = { fetch: 1, fetchPage: 2 };'],
            ['a word that ends in eval', "const retrieval = (x) => x;\nmodule.exports = retrieval('q');"],
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
