const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OAUTH = path.join(ROOT, 'Modules', 'OAuthServer');
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

/* A person consents on the consent screen and nowhere else: the S2 test-only path is gone, and no process
 * setting, header or environment can stand in for the screen's form, its CSRF token and a signed-in person. */
describe('MCP OAuth consent has no bypass', () => {
    it('has no test-only consent module', () => {
        expect(fs.existsSync(path.join(OAUTH, 'consent.js'))).toBe(false);
    });

    it('names no test consent header or switch anywhere in the server', () => {
        const hits = sources().filter((file) => /x-oauth-test-consent|TEST_CONSENT|testConsent\b/i.test(fs.readFileSync(file, 'utf8')));
        expect(hits.map(rel)).toEqual([]);
    });

    it('does not read NODE_ENV in the authorization server outside its issuer check', () => {
        const hits = walk(OAUTH).filter((file) => /NODE_ENV/.test(fs.readFileSync(file, 'utf8')) && !file.endsWith('config.js'));
        expect(hits.map(rel)).toEqual([]);
    });

    it('issues a code only from the consent answer', () => {
        const callers = walk(OAUTH).filter((file) => /\bissueCode\(/.test(fs.readFileSync(file, 'utf8')) && !file.endsWith('grants.js'));
        expect(callers.map(rel)).toEqual([path.join('Modules', 'OAuthServer', 'consentController.js')]);
    });
});
