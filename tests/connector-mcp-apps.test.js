const fs = require('fs');
const path = require('path');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(async () => ({ status: 200, headers: {}, body: '{"access_token":"at","refresh_token":"rt","expires_in":28800,"scope":""}' })),
}));

const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { validate } = require('../Modules/Connectors/validate');
const registry = require('../Modules/Connectors/registry');
const connectorTools = require('../Modules/Connectors/tools');
const providerApi = require('../Modules/Connectors/providerApi');
const { accountFromToken } = require('../Modules/Connectors/tokenAccount');

/* The apps reached through their own MCP servers (tasks 075, 094, 095): each a folder of data that validates, whose
 * tools stay off until a shape is pinned, and that signs in the way its server allows. */

const MCP_APPS = ['notion', 'github', 'supabase', 'upwork', 'wisprflow', 'dropbox', 'hubspot', 'canva'];
const SELF_REGISTERING = ['notion', 'supabase', 'upwork', 'wisprflow', 'canva'];
const ENV_KEYS = ['CONNECTORS', 'AGENT_TAINT_ROUTING', 'CONNECTOR_GITHUB_CLIENT_ID', 'CONNECTOR_GITHUB_CLIENT_SECRET', 'HOSTING_MODE'];
const before = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const en = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');

beforeEach(() => {
    process.env.CONNECTORS = MCP_APPS.join(',');
    process.env.AGENT_TAINT_ROUTING = 'on';
    delete process.env.CONNECTOR_GITHUB_CLIENT_ID;
    delete process.env.CONNECTOR_GITHUB_CLIENT_SECRET;
    delete process.env.HOSTING_MODE;
    jest.clearAllMocks();
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('every app reached through its MCP server', () => {
    it('validates and is reached over https at a host it names', () => {
        MCP_APPS.forEach((id) => {
            const definition = registry.get(id);
            expect({ id, problems: definition ? validate(definition) : ['missing'] }).toEqual({ id, problems: [] });
            expect(definition.transport).toBe('mcp');
            expect(definition.egressHosts).toContain(new URL(definition.mcp.url).hostname);
        });
    });

    it('has tools that load, each with words on screen, and none on before a shape is pinned', () => {
        const tools = connectorTools.all().filter((tool) => MCP_APPS.includes(tool.provider));
        expect(tools.length).toBeGreaterThanOrEqual(MCP_APPS.length * 2);
        tools.forEach((tool) => {
            expect(en).toContain(`${tool.label.replace('Connectors.tool.', '')}: "`);
            expect(tool.mcp).toEqual({ tool: expect.any(String), shape: null });
            expect(connectorTools.isOn(tool)).toBe(false);
        });
    });

    it('gives the AI chat\'s pull request rule the input it sends', () => {
        const read = connectorTools.get('github.pull_request.read');
        expect(Object.keys(read.input.properties).sort()).toEqual(['owner', 'pullNumber', 'repo']);
        expect(read.input.required.sort()).toEqual(['owner', 'pullNumber', 'repo']);
    });

    it('keeps writing out of the apps where only reads were asked for', () => {
        const writes = connectorTools.all().filter((tool) => MCP_APPS.includes(tool.provider) && tool.kind === 'write').map((tool) => tool.key);
        expect(writes.sort()).toEqual(['github.issue.comment', 'notion.page.create']);
    });
});

describe('how each app signs in', () => {
    it('offers the apps that register themselves with nothing set for them', () => {
        SELF_REGISTERING.forEach((id) => expect({ id, signIn: registry.signIns(id, { companyApps: [] }) }).toEqual({ id, signIn: ['oauth'] }));
    });

    it('offers GitHub by personal token alone until a GitHub App is set, then both', () => {
        expect(registry.signIns('github', { companyApps: [] })).toEqual(['token']);
        process.env.CONNECTOR_GITHUB_CLIENT_ID = 'Iv1.test';
        process.env.CONNECTOR_GITHUB_CLIENT_SECRET = 'test-secret';
        expect(registry.signIns('github', { companyApps: [] })).toEqual(['oauth', 'token']);
    });

    it('does not offer HubSpot until an app is set for it, at the instance or the company', () => {
        expect(registry.isOffered('hubspot', { companyApps: [] })).toBe(false);
        expect(registry.isOffered('hubspot', { companyApps: ['hubspot'] })).toBe(true);
    });

    it('asks Supabase for a confidential client, since its token endpoint takes no public one', async () => {
        await providerApi.register({ definition: registry.get('supabase'), companyId: '6f0000000000000000000c41', actor: 'u', redirectUri: 'https://hub.example.test/api/v1/connector-oauth/supabase/callback' });
        const [url, opts] = safeFetch.mock.calls[0];
        expect(url).toBe('https://api.supabase.com/platform/oauth/apps/register');
        expect(JSON.parse(opts.data)).toMatchObject({ token_endpoint_auth_method: 'client_secret_post', redirect_uris: ['https://hub.example.test/api/v1/connector-oauth/supabase/callback'] });
    });

    it('asks a token endpoint for JSON, which GitHub answers only when asked', async () => {
        await providerApi.exchange({ definition: registry.get('github'), companyId: '6f0000000000000000000c41', actor: 'u', client: { clientId: 'Iv1.test', clientSecret: 's' }, code: 'c', verifier: 'v', redirectUri: 'https://hub.example.test/cb' });
        const [url, opts] = safeFetch.mock.calls[0];
        expect(url).toBe('https://github.com/login/oauth/access_token');
        expect(opts.headers.Accept).toBe('application/json');
    });

    it('asks for no scope at all when an app grants access without scopes', () => {
        const url = new URL(providerApi.consentUrl({ definition: registry.get('notion'), clientId: 'c', redirectUri: 'https://hub.example.test/cb', scopes: [], state: 's', challenge: 'x' }));
        expect(url.searchParams.has('scope')).toBe(false);
        const wispr = new URL(providerApi.consentUrl({ definition: registry.get('wisprflow'), clientId: 'c', redirectUri: 'https://hub.example.test/cb', scopes: registry.scopesFor('wisprflow', ['meetings']), state: 's', challenge: 'x' }));
        expect(wispr.searchParams.get('scope')).toBe('openid email offline_access');
    });
});

describe('the account a token belongs to', () => {
    const idToken = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

    it('comes from the fields an app sends, then an id token, then one stable id per person', () => {
        const read = accountFromToken(['workspace_id'], ['workspace_name']);
        expect(read({ tokenResponse: { workspace_id: 'w1', workspace_name: 'Acme' } })).toEqual({ id: 'w1', label: 'Acme' });
        expect(read({ tokenResponse: { id_token: idToken({ sub: 'u-9', email: 'p@example.test' }) } })).toEqual({ id: 'u-9', label: 'p@example.test' });
        expect(read({ tokenResponse: { access_token: 'at' } })).toEqual({ id: 'member', label: '' });
        expect(read({ tokenResponse: { id_token: 'not-a-token' } })).toEqual({ id: 'member', label: '' });
    });
});
