const crypto = require('crypto');

const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ contextFor: jest.fn(async () => ''), recordEpisode: jest.fn(async () => null) }));

const http = require('http');
const https = require('https');
const dns = require('dns');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const secrets = require('../Config/secrets');
const allowlist = require('../Modules/Agents/engine/egressAllowlist');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { catalogues } = require('../Modules/Agents/skills/catalogues');
const readers = require('../Modules/Agents/skills/readers');
const externalReads = require('../Modules/Agents/skills/externalReads');
const { findSecrets } = require('../Modules/Agents/skills/secretScan');
const skillRecord = require('../Modules/Agents/skillRecord');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const { agentSkillsSchema } = require('../utils/mongo-handler/createSchema');

const FLAG = 'SKILL_EXTERNAL_READS';
const C = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';
const ACTOR = { id: '6f0000000000000000000a01', name: 'Olivia Owner' };
const HOST = 'api.github.com';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review', TaskKey: 'AR-7', ProjectID: '6f0000000000000000000901', description: 'See https://github.com/acme/app/pull/7 for the change.' };

const readStep = (params = {}, over = {}) => ({ reader: 'api', as: 'pr', params: { host: HOST, path: '/repos/acme/app/pulls/{{input.pr_link}}', ...params }, ...over });

const skillBody = (over = {}) => ({
    key: 'pr.fetch',
    name: 'PR fetch',
    inputs: ['pr_link'],
    gather: [readStep()],
    prompt: { template: 'Diff: {{gather.pr.text}}', output: '{"summary":"..."}' },
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
    ...over,
});

const plainSkill = (over = {}) => skillBody({ inputs: ['brief'], gather: [{ reader: 'task' }], prompt: { template: '{{input.brief}} {{gather.task.title}}', output: '{"summary":"..."}' }, ...over });

// Fixture tokens are assembled at run time so repository secret scanning does not read them as leaked keys.
const tok = (...parts) => parts.join('');
const codes = (result) => result.errors.map((e) => e.code);
const errorsOf = async (promise) => {
    try { await promise; } catch (e) { return e.errors || [{ code: 'thrown', message: e.message }]; }
    return [];
};
const skillRows = (companyId = C) => mockDbFor(companyId).store[SCHEMA_TYPE.AGENT_SKILLS] || [];
const allow = (hosts, companyId = C) => allowlist.replaceHosts(companyId, hosts, ACTOR.id);
const seedRawList = (hosts, companyId = C) => {
    mockDbFor(companyId).seed(allowlist.COLLECTION, { _id: allowlist.DOC_ID, hosts });
    allowlist.invalidate(companyId);
};
const credential = (kind = externalReads.CREDENTIAL_KIND, companyId = C) => secrets.create({ companyId, name: 'GitHub read token', kind, value: `ghp_${crypto.randomBytes(18).toString('hex')}`, actor: ACTOR });

beforeEach(() => {
    Object.values(mockDbs).forEach((db) => { Object.keys(db.store).forEach((k) => { db.store[k].length = 0; }); db.calls.length = 0; });
    myCache.flushAll();
    process.env[FLAG] = 'on';
    process.env.SECRETS_STORE = 'true';
    process.env.SECRETS_KEY = crypto.randomBytes(24).toString('hex');
});

afterAll(() => {
    delete process.env[FLAG];
    delete process.env.SECRETS_STORE;
    delete process.env.SECRETS_KEY;
});

describe('flag off: beta exactly', () => {
    beforeEach(() => { delete process.env[FLAG]; });

    it('hides the url and api readers from the catalogue', () => {
        const keys = catalogues().readers.map((r) => r.key);
        expect(keys).not.toContain('url');
        expect(keys).not.toContain('api');
        expect(keys).toEqual(['task', 'project', 'project.tasks', 'memory', 'linked_doc']);
    });

    it.each(['url', 'api'])('refuses a %s reader as unknown, and does not offer it', (reader) => {
        const checked = validateSkill(skillBody({ gather: [readStep({}, { reader })] }));
        expect(checked.ok).toBe(false);
        const err = checked.errors.find((e) => e.field === 'gather[0].reader');
        expect(err.code).toBe('unknown_reader');
        expect(err.message.split('have:')[1]).not.toMatch(/\burl\b|\bapi\b/);
    });

    it('saves an ordinary skill without declared hosts and without reading the allowlist', async () => {
        const saved = await skillRecord.createSkill(C, plainSkill({ prompt: { template: `{{input.brief}} ${tok('gh', 'p_', '0123456789abcdef0123456789abcdef0123')}`, output: '{"summary":"..."}' } }));
        expect(saved.declaredHosts).toBeUndefined();
        expect(skillRows()[0]).not.toHaveProperty('declaredHosts');
        expect(mockDbFor(C).calls.some((c) => c.type === allowlist.COLLECTION)).toBe(false);
    });

    it('reads the flag on every call', () => {
        expect(externalReads.enabled()).toBe(false);
        process.env[FLAG] = 'on';
        expect(externalReads.enabled()).toBe(true);
        process.env[FLAG] = 'off';
        expect(externalReads.enabled()).toBe(false);
    });
});

describe('the url and api readers (flag on)', () => {
    it('are offered with their whole parameter surface', () => {
        const byKey = Object.fromEntries(catalogues().readers.map((r) => [r.key, r]));
        ['url', 'api'].forEach((key) => {
            expect(Object.keys(byKey[key].params).sort()).toEqual(['credential', 'format', 'host', 'maxBytes', 'maxRedirects', 'method', 'path', 'timeoutMs']);
            expect(byKey[key].params.method.values).toEqual(['GET']);
            expect(byKey[key].params.maxBytes.max).toBe(512 * 1024);
            expect(byKey[key].params.timeoutMs.max).toBe(10000);
            expect(byKey[key].params.maxRedirects.max).toBe(3);
        });
    });

    it('accepts a declared read and records its host', () => {
        const checked = validateSkill(skillBody());
        expect(checked.errors).toEqual([]);
        expect(checked.value.declaredHosts).toEqual([HOST]);
        expect(checked.value.gather[0]).toEqual({ reader: 'api', as: 'pr', params: { host: HOST, path: '/repos/acme/app/pulls/{{input.pr_link}}' } });
    });

    it('keeps a declared port on the host', () => {
        const checked = validateSkill(skillBody({ gather: [readStep({ host: 'Status.Example.com:8443' })] }));
        expect(checked.value.declaredHosts).toEqual(['status.example.com:8443']);
    });

    it('declares nothing for a skill without external reads', () => {
        expect(validateSkill(plainSkill()).value).not.toHaveProperty('declaredHosts');
    });

    it.each([
        ['maxBytes', 512 * 1024 + 1],
        ['timeoutMs', 10001],
        ['maxRedirects', 4],
        ['maxBytes', 0],
    ])('refuses %s = %s past its cap', (name, value) => {
        const checked = validateSkill(skillBody({ gather: [readStep({ [name]: value })] }));
        expect(checked.errors).toEqual([expect.objectContaining({ field: `gather[0].params.${name}`, code: 'invalid_params' })]);
    });

    it('accepts every cap at its limit', () => {
        expect(validateSkill(skillBody({ gather: [readStep({ maxBytes: 512 * 1024, timeoutMs: 10000, maxRedirects: 3 })] })).ok).toBe(true);
    });

    it.each(['POST', 'get', 'DELETE'])('allows GET only (%s refused)', (method) => {
        expect(validateSkill(skillBody({ gather: [readStep({ method })] })).errors).toEqual([expect.objectContaining({ field: 'gather[0].params.method', code: 'invalid_params' })]);
    });

    it('takes a format from its own list', () => {
        expect(validateSkill(skillBody({ gather: [readStep({ format: 'diff' })] })).ok).toBe(true);
        expect(codes(validateSkill(skillBody({ gather: [readStep({ format: 'xml' })] })))).toEqual(['invalid_params']);
        expect(codes(validateSkill(skillBody({ gather: [readStep({ format: 'json' }, { reader: 'url' })] })))).toEqual(['invalid_params']);
    });

    it('requires a host and a path', () => {
        const checked = validateSkill(skillBody({ gather: [{ reader: 'url', as: 'page', params: {} }] }));
        expect(checked.errors.map((e) => [e.field, e.code])).toEqual([['gather[0].params.host', 'required'], ['gather[0].params.path', 'required']]);
    });

    it.each([
        ['*.github.com', 'wildcard'],
        ['*.nip.io', 'wildcard'],
        ['localhost', 'private'],
        ['intranet', 'private'],
        ['metadata.google.internal', 'private'],
        ['printer.local', 'private'],
        ['10.0.0.1', 'address'],
        ['169.254.169.254', 'address'],
        ['127.0.0.1:8080', 'address'],
        ['[::1]', 'address'],
        ['0x7f.1', 'address'],
        ['https://api.github.com', 'scheme'],
        ['api.github.com/repos', 'path'],
        ['user@api.github.com', 'invalid'],
        ['{{input.pr_link}}', 'invalid'],
        ['api.{{input.brief}}.com', 'invalid'],
        ['api.github.com:0', 'port'],
    ])('refuses the declared host %s (%s)', (host, reason) => {
        const checked = validateSkill(skillBody({ gather: [readStep({ host })] }));
        expect(checked.errors).toEqual([expect.objectContaining({ field: 'gather[0].params.host', code: 'host_not_allowed', reason })]);
    });

    it.each([
        ['repos/acme', 'must start with a single "/"'],
        ['//evil.com/x', 'must start with a single "/"'],
        ['/\\evil.com', 'backslash'],
        ['/a b', 'whitespace'],
        ['/a\tb', 'whitespace'],
        ['/a#frag', '"#"'],
        ['{{input.pr_link}}/x', 'must start with a single "/"'],
        ['https://evil.com/x', 'must start with a single "/"'],
    ])('refuses the path %j', (path, message) => {
        const checked = validateSkill(skillBody({ gather: [readStep({ path })] }));
        expect(checked.errors).toEqual([expect.objectContaining({ field: 'gather[0].params.path', code: 'invalid_path' })]);
        expect(checked.errors[0].message).toContain(message);
    });

    it.each([
        ['/x/{{gather.pr.text}}', 'undeclared_reader'],
        ['/x/{{memory}}', 'unknown_placeholder'],
        ['/x/{{answer.summary}}', 'unknown_placeholder'],
        ['/x/{{input.brief}}', 'undeclared_input'],
        ['/x{{#input.pr_link}}/y{{/input.pr_link}}', 'invalid_path'],
    ])('lets a path placeholder read only the task and declared inputs (%s)', (path, code) => {
        expect(codes(validateSkill(skillBody({ gather: [readStep({ path })] })))).toContain(code);
    });

    it('accepts a placeholder in the path and the query', () => {
        expect(validateSkill(skillBody({ gather: [readStep({ path: '/search/{{TaskKey}}?q={{input.pr_link | clip:200}}&per_page=5' })] })).ok).toBe(true);
    });

    it.each([
        ['a raw token', tok('gh', 'p_', '0123456789abcdef0123456789abcdef0123')],
        ['a name', 'github'],
        ['a number', 42],
        ['an object', { handle: 'sec_0123456789abcdef01234567' }],
    ])('takes a credential only as a secret handle, never %s', (what, value) => {
        const checked = validateSkill(skillBody({ gather: [readStep({ credential: value })] }));
        expect(checked.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'gather[0].params.credential', code: 'credential_invalid' })]));
    });

    it('declares the field on the strict schema', () => {
        expect(agentSkillsSchema.path('declaredHosts')).toBeTruthy();
    });
});

describe('placeholders reach only the path and the query, never the host, scheme or port', () => {
    const EVIL = [
        '@evil.com',
        'x@evil.com:80',
        '//evil.com',
        '\\\\evil.com',
        '/\\evil.com',
        '%2F%2Fevil.com',
        '%40evil.com',
        '%5C%5Cevil.com',
        '..%2F..%2F..%2Fevil',
        '../../..',
        'https://evil.com/',
        ':8080',
        '?x=1#y',
        '／／evil.com',
        'evil.com\r\nHost: evil.com',
    ];
    const PATHS = ['/{{input.pr_link}}', '/a/{{input.pr_link}}/b', '/a?q={{input.pr_link}}', '/{{input.pr_link}}{{input.pr_link}}'];

    it.each(EVIL.flatMap((value) => PATHS.map((path) => [value, path])))('%j in %s stays on the declared origin', (value, path) => {
        const out = externalReads.buildUrl({ host: HOST, path }, { input: { pr_link: value } });
        const url = new URL(out);
        expect(url.protocol).toBe('https:');
        expect(url.hostname).toBe(HOST);
        expect(url.port).toBe('');
        expect(url.username + url.password).toBe('');
        expect(url.hash).toBe('');
        expect(out.startsWith(`https://${HOST}/`)).toBe(true);
    });

    it('keeps a declared port and nothing else', () => {
        const url = new URL(externalReads.buildUrl({ host: 'status.example.com:8443', path: '/v1/{{input.pr_link}}' }, { input: { pr_link: ':9999@evil.com' } }));
        expect(url.host).toBe('status.example.com:8443');
    });

    it('refuses a template that would leave the origin even before any value is filled in', () => {
        expect(() => externalReads.buildUrl({ host: HOST, path: '//evil.com/{{input.pr_link}}' }, { input: { pr_link: 'x' } })).toThrow(/path/);
        expect(() => externalReads.buildUrl({ host: '*.github.com', path: '/x' }, {})).toThrow(/host/);
    });
});

describe('save checks every declared host against the live workspace allowlist', () => {
    it('refuses a host the list does not name, naming the host', async () => {
        await allow(['github.com']);
        const errors = await errorsOf(skillRecord.createSkill(C, skillBody()));
        expect(errors).toEqual([expect.objectContaining({ field: 'gather[0].params.host', code: 'host_not_allowed', host: HOST })]);
        expect(errors[0].message).toContain(HOST);
        expect(skillRows()).toHaveLength(0);
    });

    it('accepts a listed host and stores it on the row', async () => {
        await allow([HOST]);
        const saved = await skillRecord.createSkill(C, skillBody());
        expect(saved.declaredHosts).toEqual([HOST]);
        expect(skillRows()[0].declaredHosts).toEqual([HOST]);
    });

    it('still refuses when the allowlist is empty', async () => {
        const errors = await errorsOf(skillRecord.createSkill(C, skillBody()));
        expect(errors.map((e) => e.code)).toEqual(['host_not_allowed']);
        await allow([]);
        expect((await errorsOf(skillRecord.createSkill(C, skillBody()))).map((e) => e.code)).toEqual(['host_not_allowed']);
        expect(skillRows()).toHaveLength(0);
    });

    it('accepts a host a listed suffix covers', async () => {
        await allow(['*.github.com']);
        expect((await skillRecord.createSkill(C, skillBody())).declaredHosts).toEqual([HOST]);
    });

    it('holds the port: https on 443 unless the host names one', async () => {
        await allow([`${HOST}:443`, 'status.example.com:443']);
        expect((await skillRecord.createSkill(C, skillBody())).declaredHosts).toEqual([HOST]);
        const errors = await errorsOf(skillRecord.createSkill(C, skillBody({ key: 'status.read', gather: [readStep({ host: 'status.example.com:8443' })] })));
        expect(errors.map((e) => [e.code, e.host])).toEqual([['host_not_allowed', 'status.example.com:8443']]);
    });

    it('refuses a private or reserved host even when a list written around the console names it', async () => {
        seedRawList(['localhost', '10.0.0.1', 'metadata.google.internal', '169.254.169.254']);
        for (const host of ['localhost', '10.0.0.1', 'metadata.google.internal', '169.254.169.254']) {
            // eslint-disable-next-line no-await-in-loop
            const errors = await errorsOf(skillRecord.createSkill(C, skillBody({ gather: [readStep({ host })] })));
            expect(errors.map((e) => e.code)).toEqual(['host_not_allowed']);
        }
        expect(skillRows()).toHaveLength(0);
    });

    it('checks every read, and names each refused host', async () => {
        await allow([HOST]);
        const errors = await errorsOf(skillRecord.createSkill(C, skillBody({
            gather: [readStep(), readStep({ host: 'raw.githubusercontent.com', path: '/acme/app/main/README.md' }, { reader: 'url', as: 'readme' })],
        })));
        expect(errors).toEqual([expect.objectContaining({ field: 'gather[1].params.host', code: 'host_not_allowed', host: 'raw.githubusercontent.com' })]);
    });

    it('reads the allowlist of the saving workspace only', async () => {
        await allow([HOST], C2);
        expect((await errorsOf(skillRecord.createSkill(C, skillBody()))).map((e) => e.code)).toEqual(['host_not_allowed']);
    });

    it('refuses the save when the allowlist cannot be read', async () => {
        const spy = jest.spyOn(allowlist, 'hostsFor').mockRejectedValueOnce(new Error('down'));
        const errors = await errorsOf(skillRecord.createSkill(C, skillBody()));
        expect(errors.map((e) => e.code)).toEqual(['allowlist_unreadable']);
        spy.mockRestore();
    });

    it('checks an update too, and clears the hosts when the reads go', async () => {
        await allow([HOST]);
        await skillRecord.createSkill(C, skillBody());
        const refused = await errorsOf(skillRecord.updateSkill(C, 'pr.fetch', { gather: [readStep({ host: 'evil.example.com' })] }));
        expect(refused.map((e) => [e.code, e.host])).toEqual([['host_not_allowed', 'evil.example.com']]);
        expect(skillRows()[0].declaredHosts).toEqual([HOST]);

        const cleared = await skillRecord.updateSkill(C, 'pr.fetch', { inputs: ['brief'], gather: [{ reader: 'task' }], prompt: { template: '{{input.brief}}', output: '{"summary":"..."}' } });
        expect(cleared.declaredHosts).toEqual([]);
    });

    it('leaves an ordinary skill update without the field', async () => {
        await skillRecord.createSkill(C, plainSkill());
        const updated = await skillRecord.updateSkill(C, 'pr.fetch', { description: 'x' });
        expect(updated).not.toHaveProperty('declaredHosts');
        expect(mockDbFor(C).calls.some((c) => c.type === allowlist.COLLECTION)).toBe(false);
    });
});

describe('a credential is a handle to a skill_read secret in this workspace', () => {
    beforeEach(() => allow([HOST]));

    it('accepts a live skill_read handle and stores only the handle', async () => {
        const { handle } = await credential();
        const saved = await skillRecord.createSkill(C, skillBody({ gather: [readStep({ credential: handle })] }));
        expect(saved.gather[0].params.credential).toBe(handle);
        expect(JSON.stringify(skillRows()[0])).not.toMatch(/ghp_/);
    });

    it('refuses a handle that does not exist', async () => {
        const errors = await errorsOf(skillRecord.createSkill(C, skillBody({ gather: [readStep({ credential: `sec_${'0'.repeat(24)}` })] })));
        expect(errors).toEqual([expect.objectContaining({ field: 'gather[0].params.credential', code: 'credential_not_found' })]);
    });

    it('refuses a handle of another kind', async () => {
        const { handle } = await credential('integration');
        const errors = await errorsOf(skillRecord.createSkill(C, skillBody({ gather: [readStep({ credential: handle })] })));
        expect(errors).toEqual([expect.objectContaining({ field: 'gather[0].params.credential', code: 'credential_wrong_kind' })]);
    });

    it('refuses a revoked handle', async () => {
        const { handle } = await credential();
        await secrets.revoke({ companyId: C, handle, actor: ACTOR });
        expect((await errorsOf(skillRecord.createSkill(C, skillBody({ gather: [readStep({ credential: handle })] })))).map((e) => e.code)).toEqual(['credential_not_found']);
    });

    it('refuses a handle from another workspace', async () => {
        const { handle } = await credential(externalReads.CREDENTIAL_KIND, C2);
        expect((await errorsOf(skillRecord.createSkill(C, skillBody({ gather: [readStep({ credential: handle })] })))).map((e) => e.code)).toEqual(['credential_not_found']);
    });

    it('refuses any handle while the secrets store is off', async () => {
        const { handle } = await credential();
        delete process.env.SECRETS_STORE;
        expect((await errorsOf(skillRecord.createSkill(C, skillBody({ gather: [readStep({ credential: handle })] })))).map((e) => e.code)).toEqual(['credential_not_found']);
    });
});

describe('a raw secret anywhere in the skill body is refused', () => {
    const SECRETS = [
        ['a GitHub token', `ghp_${'a1B2c3D4e5'.repeat(3)}abcdef`],
        ['a GitHub fine-grained token', tok('github', '_pat_', '11ABCDEFG0', 'x'.repeat(40))],
        ['a GitLab token', tok('gl', 'pat-', 'AbCdEf0123456789xyzw')],
        ['an Anthropic key', tok('sk-', 'ant-api03-', 'Q'.repeat(40))],
        ['an OpenAI key', tok('sk-', 'proj-', 'a1'.repeat(24))],
        ['an AWS access key id', tok('AK', 'IA', 'IOSFODNN7EXAMPLE')],
        ['a Google API key', tok('AI', 'za', 'B'.repeat(35))],
        ['a Slack token', tok('xo', 'xb-', '123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx')],
        ['a Stripe key', tok('sk', '_live_', '4eC39HqLyjWDarjtT1zdp7dc')],
        ['a private key', tok('-----BEGIN RSA ', 'PRIVATE KEY-----', '\nMIIEow')],
        ['a JWT', tok('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')],
        ['a bearer header', 'Authorization: Bearer 3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c'],
        ['credentials in a URL', 'https://deploy:hunter2secret@example.com/x'],
        ['a keyed query value', '/v1/items?api_key=Zx81kQp02LmN73vB&x=1'],
    ];

    it.each(SECRETS)('refuses %s in the prompt', (what, secret) => {
        const checked = validateSkill(plainSkill({ prompt: { instructions: `Use this: ${secret}`, template: '{{input.brief}}', output: '{"summary":"..."}' } }));
        expect(checked.errors).toEqual([expect.objectContaining({ field: 'prompt.instructions', code: 'secret_in_body' })]);
        expect(checked.errors[0].message).not.toContain(secret.slice(8, 20));
    });

    it('finds one in a read path, an emit mapping and the description', () => {
        const checked = validateSkill(skillBody({
            description: `token ghp_${'z'.repeat(36)}`,
            gather: [readStep({ path: '/repos?access_token=abcdEFGH1234ijkl5678' })],
            emit: [{ action: 'task.comment', params: { body: `{{answer.summary}} ${tok('xo', 'xp-', '1'.repeat(12), '-', '2'.repeat(12), '-abcdefabcdef')}` } }],
        }));
        expect(checked.errors.filter((e) => e.code === 'secret_in_body').map((e) => e.field).sort()).toEqual(['description', 'emit[0].params.body', 'gather[0].params.path']);
    });

    it.each([
        'Use sk-learn or scikit-learn for the model.',
        'Stay within the token budget and keep the tokens short.',
        'The bearer of bad news is not the author.',
        'Authorization: see the vault entry named github-read.',
        'password: ask the owner',
        'Commit 3f786850e387550fdab836ed7e6dc881de23001b fixed it; request id 123e4567-e89b-12d3-a456-426614174000.',
        'Link: https://github.com/acme/app/pull/7 and https://example.com/a?page=2&per_page=50',
        'Handle sec_0123456789abcdef01234567 is the credential.',
        'Keys look like ghp_ or sk- followed by characters; never paste one.',
        'AKIA is how AWS key ids start.',
        '/v1/items?api_key={{input.brief}}&token={{TaskKey}}',
        'renderTaskBreakdownIntoSubtasksWithEstimatesAndOwners',
        'task-management, sprint-planning, sk-8 build, eyJ alone',
        'user@example.com wrote the brief',
        '-----BEGIN CERTIFICATE-----',
    ])('lets ordinary text through: %s', (textValue) => {
        expect(findSecrets({ prompt: { instructions: textValue } })).toEqual([]);
        expect(validateSkill(plainSkill({ description: textValue.slice(0, 1000) })).errors.filter((e) => e.code === 'secret_in_body')).toEqual([]);
    });

    it('is not applied with the flag off', () => {
        delete process.env[FLAG];
        expect(validateSkill(plainSkill({ description: `ghp_${'z'.repeat(36)}` })).ok).toBe(true);
    });
});

describe('running a skill with a declared read before the run-time slice', () => {
    let spies;
    beforeEach(() => {
        spies = [jest.spyOn(http, 'request'), jest.spyOn(https, 'request'), jest.spyOn(http, 'get'), jest.spyOn(https, 'get'), jest.spyOn(dns, 'lookup')];
        const doc = validateSkill(skillBody()).value;
        mockDbFor(C).seed(SCHEMA_TYPE.AGENT_SKILLS, doc);
    });
    afterEach(() => spies.forEach((s) => s.mockRestore()));

    const noFetch = () => spies.forEach((s) => expect(s).not.toHaveBeenCalled());

    it('fails with external_reads_not_available and fetches nothing', async () => {
        await expect(orchestrator.gather({ skillSlug: 'pr.fetch', task: TASK, companyId: C, startedBy: ACTOR.id }))
            .rejects.toMatchObject({ code: 'external_reads_not_available', deterministic: true, message: expect.stringContaining('external_reads_not_available') });
        noFetch();
    });

    it('fails the same way with the flag off', async () => {
        delete process.env[FLAG];
        await expect(orchestrator.gather({ skillSlug: 'pr.fetch', task: TASK, companyId: C, startedBy: ACTOR.id })).rejects.toMatchObject({ code: 'external_reads_not_available' });
        noFetch();
    });

    it.each(['url', 'api'])('the %s reader itself refuses to run', async (reader) => {
        await expect(readers.read(reader, C, { task: TASK }, { host: HOST, path: '/x' })).rejects.toMatchObject({ code: 'external_reads_not_available' });
        noFetch();
    });
});
