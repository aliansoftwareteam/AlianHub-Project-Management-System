const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CONSENT = path.join(ROOT, 'Modules', 'OAuthServer', 'consent.js');
const SOURCE_DIRS = ['Modules', 'Config', 'utils', 'middlewares', 'migrations', 'scripts', 'event', 'socket', 'common-storage'];

const walk = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, out); } else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
};

const sources = () => [...SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))), path.join(ROOT, 'index.js'), path.join(ROOT, 'server.js')].filter((f) => fs.existsSync(f));
const rel = (file) => path.relative(ROOT, file);

/* Until the S3 consent screen, the only way to complete /oauth/authorize is the test consent path. It must
 * stay switched by NODE_ENV === 'test' alone, read per request, so no deployment can turn it on by setting
 * some other variable, and no other code may reach around it. */
describe('the MCP OAuth test-only consent path', () => {
    const text = fs.readFileSync(CONSENT, 'utf8');

    it('is enabled by exactly NODE_ENV === \'test\' and nothing else', () => {
        const gate = text.match(/const testConsentEnabled = \(\) => (.+);/);
        expect(gate && gate[1]).toBe("process.env.NODE_ENV === 'test'");
        expect(text.match(/process\.env\.[A-Z_]+/g)).toEqual(['process.env.NODE_ENV']);
    });

    it('checks the gate before it reads the consent header or the session', () => {
        const body = text.slice(text.indexOf('const testConsent = '));
        const gateAt = body.indexOf('if (!testConsentEnabled()) return resolve(null);');
        expect(gateAt).toBeGreaterThan(-1);
        expect(gateAt).toBeLessThan(body.indexOf('TEST_CONSENT_HEADER'));
        expect(gateAt).toBeLessThan(body.indexOf('verifyJWTTokenWithCV2'));
    });

    it('is reached only from the authorize handler', () => {
        const users = sources().filter((file) => file !== CONSENT && /require\(['"][./]*(?:Modules\/OAuthServer\/)?consent['"]\)|x-oauth-test-consent|TEST_CONSENT_HEADER|testConsent\b/.test(fs.readFileSync(file, 'utf8')));
        expect(users.map(rel)).toEqual([path.join('Modules', 'OAuthServer', 'controller.js')]);
    });

    it('is not switched on by any environment the app is shipped or run with', () => {
        const shipped = ['.env.example', 'Dockerfile', 'docker-compose.yml', 'nodemon.json', 'package.json', path.join('e2e', 'support', 'server.js')]
            .map((file) => path.join(ROOT, file)).filter((file) => fs.existsSync(file));
        for (const file of shipped) expect([rel(file), /NODE_ENV["']?\s*[:=]\s*["']?test\b/.test(fs.readFileSync(file, 'utf8'))]).toEqual([rel(file), false]);
    });
});
