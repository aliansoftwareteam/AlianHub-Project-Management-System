const fs = require('fs');
const path = require('path');
const glob = (dir, out = []) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) glob(p, out); else if (/routes\d*\.js$/.test(f)) out.push(p); } return out; };

/* app.use only guards the prefixes it is given. A module that registers a new
 * /api/v2 prefix and forgets the guard list ships open — that is how imports,
 * epics, exports, reactions, recent-visits, search and the email triggers were
 * found answering anyone with a company id in a header. */
const PUBLIC_BY_DESIGN = ['/api/v2/auth', '/api/v2/sso', '/api/v2/github-signup', '/api/v2/gitlab-signup', '/api/v2/google-signup', '/api/v2/logout', '/api/v2/session', '/api/v2/public-shares', '/api/v2/changelog', '/api/v2/sendForgotPasswordEmail', '/api/v2/scim',
    // signup and invitation flows: nobody has a token yet
    '/api/v2/createUser', '/api/v2/sendVerificationEmail', '//api/v2/verifyEmail'.replace('//', '/'), '/api/v2/generateToken', '/api/v2/checkPermission'];
const SELF_GUARDED = ['/api/v2/agents', '/api/v2/api-tokens', '/api/v2/automations', '/api/v2/billing', '/api/v2/intake', '/api/v2/invoices', '/api/v2/webhooks', '/api/v2/instance', '/api/v2/timesheet-approval', '/api/v2/generate'];

describe('every /api/v2 prefix is guarded, public by design, or guards itself', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'Config', 'setMiddleware.js'), 'utf8');
    const guarded = new Set((src.match(/"\/api\/v2\/[A-Za-z\/:-]+"/g) || []).map((s) => s.replace(/"/g, '')));
    const registered = new Set();
    for (const file of glob(path.join(__dirname, '..', 'Modules'))) {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*['"](\/api\/v2\/[A-Za-z-]+)/g)) registered.add(m[1]);
    }
    it('registers something (the scan works)', () => { expect(registered.size).toBeGreaterThan(20); });
    for (const prefix of [...registered].sort()) {
        it(`${prefix}`, () => {
            // A guard entry may name a sub-path ("/api/v2/company/create"); that guards the routes under it.
            const guardedByPath = [...guarded].some((g) => g === prefix || g.startsWith(prefix + '/'));
            const ok = guardedByPath || PUBLIC_BY_DESIGN.includes(prefix) || SELF_GUARDED.includes(prefix);
            expect(ok).toBe(true);
        });
    }
});
