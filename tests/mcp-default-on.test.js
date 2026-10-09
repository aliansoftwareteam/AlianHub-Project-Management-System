const dataFlag = require('../Modules/Mcp/dataFlag');
const manageFlag = require('../Modules/Mcp/manageFlag');
const workFlag = require('../Modules/Mcp/workFlag');
const oauth = require('../Modules/OAuthServer/config');
const taint = require('../Modules/Agents/taint');
const { describeSettings, validateSettings } = require('../Modules/Instance/settingsCatalog');

const FLAGS = { MCP_TOOLS_DATA: dataFlag, MCP_TOOLS_MANAGE: manageFlag, MCP_TOOLS_WORK: workFlag };
const KEYS = [...Object.keys(FLAGS), 'MCP_OAUTH', 'MCP_OAUTH_DCR', 'MCP_OAUTH_ISSUER', 'AGENT_TAINT_ROUTING', 'APIURL', 'NODE_ENV'];
const HTTPS = { APIURL: 'https://hub.example.com' };
const ALL_OFF = { MCP_TOOLS_DATA: 'off', MCP_TOOLS_MANAGE: 'off', MCP_TOOLS_WORK: 'off', MCP_OAUTH: 'off' };

let saved;
beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    KEYS.forEach((key) => { delete process.env[key]; });
});
afterEach(() => {
    KEYS.forEach((key) => {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    });
});

describe('the MCP tool flags', () => {
    it.each(Object.keys(FLAGS))('%s is on when unset or empty', (key) => {
        expect(FLAGS[key].enabled()).toBe(true);
        process.env[key] = '  ';
        expect(FLAGS[key].enabled()).toBe(true);
    });

    it.each(Object.keys(FLAGS).flatMap((key) => ['off', 'false', '0', 'no', 'OFF'].map((value) => [key, value])))('%s=%s turns it off', (key, value) => {
        process.env[key] = value;
        expect(FLAGS[key].enabled()).toBe(false);
    });

    it.each(Object.keys(FLAGS))('%s=on stays on', (key) => {
        process.env[key] = 'on';
        expect(FLAGS[key].enabled()).toBe(true);
    });
});

describe('MCP_OAUTH', () => {
    it('is both when unset and the issuer is an https origin', () => {
        expect(oauth.mode(HTTPS)).toBe(oauth.MODE.BOTH);
        expect(oauth.unsetIssuerProblem(HTTPS)).toBe('');
    });

    it('is both when unset on a developer machine', () => {
        expect(oauth.mode({ APIURL: 'http://localhost:4000' })).toBe(oauth.MODE.BOTH);
    });

    it('stays off when unset and the issuer could not boot, and says why', () => {
        const env = { APIURL: 'http://hub.example.com', NODE_ENV: 'production' };
        expect(oauth.mode(env)).toBe(oauth.MODE.OFF);
        expect(oauth.unsetIssuerProblem(env)).toMatch(/https/);
        expect(oauth.mode({})).toBe(oauth.MODE.OFF);
    });

    it('an explicit off wins', () => {
        expect(oauth.mode({ ...HTTPS, MCP_OAUTH: 'off' })).toBe(oauth.MODE.OFF);
        expect(oauth.mode({ ...HTTPS, MCP_OAUTH: 'false' })).toBe(oauth.MODE.OFF);
        expect(oauth.unsetIssuerProblem({ APIURL: 'http://hub.example.com', NODE_ENV: 'production', MCP_OAUTH: 'off' })).toBe('');
    });

    it('an explicit on with an issuer that cannot boot still stops the server', () => {
        const app = { get: jest.fn(), post: jest.fn(), use: jest.fn(), delete: jest.fn(), put: jest.fn() };
        const env = { MCP_OAUTH: 'on', APIURL: 'http://hub.example.com', NODE_ENV: 'production' };
        expect(() => require('../Modules/OAuthServer/routes').init(app, env)).toThrow(/MCP_OAUTH/);
    });

    it('unset with an issuer that cannot boot registers nothing instead of stopping the server', () => {
        const app = { get: jest.fn(), post: jest.fn(), use: jest.fn(), delete: jest.fn(), put: jest.fn() };
        expect(() => require('../Modules/OAuthServer/routes').init(app, { APIURL: 'http://hub.example.com', NODE_ENV: 'production' })).not.toThrow();
        expect(app.get).not.toHaveBeenCalled();
        expect(app.post).not.toHaveBeenCalled();
    });

    it('dynamic client registration stays off by default', () => {
        expect(oauth.dcrOn(HTTPS)).toBe(false);
        expect(oauth.dcrOn({ ...HTTPS, MCP_OAUTH_DCR: 'on' })).toBe(true);
    });
});

describe('AGENT_TAINT_ROUTING', () => {
    it('is on when unset while the tool flags are at their defaults', () => {
        expect(taint.enabled({})).toBe(true);
        expect(taint.enabled()).toBe(true);
    });

    it.each(Object.keys(FLAGS))('is on when unset while only %s is on', (key) => {
        expect(taint.enabled({ ...ALL_OFF, [key]: 'on' })).toBe(true);
    });

    it('is on when unset while only MCP_OAUTH is on', () => {
        expect(taint.enabled({ ...ALL_OFF, ...HTTPS, MCP_OAUTH: 'on' })).toBe(true);
    });

    it('is off when unset and every MCP flag is off', () => {
        expect(taint.enabled(ALL_OFF)).toBe(false);
    });

    it.each(['off', 'false', '0'])('an explicit %s wins over the tool flags', (value) => {
        expect(taint.enabled({ AGENT_TAINT_ROUTING: value })).toBe(false);
        process.env.AGENT_TAINT_ROUTING = value;
        expect(taint.enabled()).toBe(false);
    });

    it('an explicit on holds with every MCP flag off', () => {
        expect(taint.enabled({ ...ALL_OFF, AGENT_TAINT_ROUTING: 'on' })).toBe(true);
    });
});

describe('the instance settings page', () => {
    const row = (env, saved = {}, locked = []) => describeSettings({ saved, env, locked }).find((r) => r.key === 'AGENT_TAINT_ROUTING');

    it('shows taint routing under Security, on by default with the tools', () => {
        expect(row({})).toMatchObject({ group: 'security', type: 'boolean', value: 'true', default: 'true', source: 'default' });
    });

    it('shows it off by default when every MCP flag is off', () => {
        expect(row(ALL_OFF)).toMatchObject({ value: 'false', default: 'false', source: 'default' });
    });

    it('shows taint routing read-only: locked whether or not the environment names it', () => {
        expect(row({})).toMatchObject({ readOnly: true, locked: true });
        expect(row({ AGENT_TAINT_ROUTING: 'off' }, {}, ['AGENT_TAINT_ROUTING'])).toMatchObject({ value: 'false', source: 'env', locked: true });
        expect(row({ AGENT_TAINT_ROUTING: 'on' }, {}, ['AGENT_TAINT_ROUTING'])).toMatchObject({ value: 'true', source: 'env', locked: true });
    });

    it('refuses to save taint routing from the console', () => {
        expect(validateSettings({ AGENT_TAINT_ROUTING: 'false' })).toMatchObject({ valid: false, errors: { AGENT_TAINT_ROUTING: 'readonly' }, values: {} });
    });

    it('never applies a stored taint routing value', () => {
        const instance = require('../Config/instanceSettings');
        instance._resetForTests();
        expect(instance.applyInstanceSettings({ AGENT_TAINT_ROUTING: 'false' })).toEqual([]);
        expect(process.env.AGENT_TAINT_ROUTING).toBeUndefined();
        instance._resetForTests();
    });

    const toolRow = (key, env, saved = {}, locked = []) => describeSettings({ saved, env, locked }).find((r) => r.key === key);

    it.each(Object.keys(FLAGS))('shows %s under AI, on by default, off once saved off', (key) => {
        expect(toolRow(key, {})).toMatchObject({ group: 'ai', type: 'boolean', value: 'true', source: 'default', locked: false });
        expect(toolRow(key, {}, { [key]: 'false' })).toMatchObject({ value: 'false', source: 'saved' });
        expect(toolRow(key, { [key]: 'off' }, {}, [key])).toMatchObject({ value: 'false', source: 'env', locked: true });
    });

    it('shows MCP_OAUTH as a mode, needing a restart', () => {
        expect(toolRow('MCP_OAUTH', HTTPS)).toMatchObject({ type: 'select', value: 'both', source: 'default', restart: true });
        expect(toolRow('MCP_OAUTH', { ...HTTPS, MCP_OAUTH: 'on' }, {}, ['MCP_OAUTH'])).toMatchObject({ value: 'both', locked: true });
        expect(toolRow('MCP_OAUTH', HTTPS, { MCP_OAUTH: 'off' })).toMatchObject({ value: 'off', source: 'saved' });
    });

    it('refuses to switch MCP_OAUTH on from the console while the issuer could not boot', () => {
        process.env.APIURL = 'http://hub.example.com';
        process.env.NODE_ENV = 'production';
        expect(validateSettings({ MCP_OAUTH: 'both' }).errors).toEqual({ MCP_OAUTH: 'mcp_issuer' });
        expect(validateSettings({ MCP_OAUTH: 'off' }).valid).toBe(true);
        process.env.APIURL = 'https://hub.example.com';
        expect(validateSettings({ MCP_OAUTH: 'both' }).valid).toBe(true);
    });
});
