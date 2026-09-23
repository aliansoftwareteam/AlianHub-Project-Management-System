const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SELF = path.relative(ROOT, __filename);

/* Flags that were removed. The task history under Tasks/ keeps their story, so it is not scanned. */
const RETIRED = ['PR_SUMMARY_AS_DATA'];

const ROOTS = ['Modules', 'Config', 'scripts', 'tests', 'docs', 'migrations', 'utils', 'middlewares', 'event', 'common-storage', 'e2e', 'frontend/src', 'frontend/tests'];
const FILES = ['.env.example', 'frontend/.env.example', 'index.js', 'package.json', 'CLAUDE.md', 'README.md'];
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git']);
const TEXT = /\.(js|cjs|mjs|ts|vue|json|md|ya?ml|sh|example|html)$/;

const walk = (dir, out) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    entries.forEach((entry) => {
        if (SKIP.has(entry.name)) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (TEXT.test(entry.name)) out.push(full);
    });
    return out;
};

const scanned = () => [
    ...ROOTS.flatMap((dir) => walk(path.join(ROOT, dir), [])),
    ...FILES.map((file) => path.join(ROOT, file)).filter((file) => fs.existsSync(file)),
].map((file) => path.relative(ROOT, file)).filter((file) => file !== SELF);

describe('retired flags', () => {
    const files = scanned();

    it('scans the code, the docs and the env examples', () => {
        expect(files).toEqual(expect.arrayContaining(['Modules/Agents/skills/index.js', 'docs/ENV.md', '.env.example']));
    });

    it.each(RETIRED)('%s is read and documented nowhere', (flag) => {
        expect(files.filter((file) => fs.readFileSync(path.join(ROOT, file), 'utf8').includes(flag))).toEqual([]);
    });
});
