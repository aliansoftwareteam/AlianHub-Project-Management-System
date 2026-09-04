const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.cache']);

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const rel = (p) => path.relative(ROOT, p);
const moduleDirs = fs.readdirSync(path.join(ROOT, 'Modules'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const moduleFiles = walk(path.join(ROOT, 'Modules'));
const frontendFiles = walk(path.join(ROOT, 'frontend', 'src'));

// Legacy exceptions that predate the rule; each one is removed when its file is.
const ROUTE_FILE_EXCEPTIONS = new Set(['Modules/Auth/routes2.js']);

describe('module folders', () => {
    it('never use snake_case', () => {
        expect(moduleDirs.filter((d) => d.includes('_'))).toEqual([]);
    });
    it('are not lowercased variants of the canonical names', () => {
        expect(moduleDirs.filter((d) => ['usersmodule', 'checkinstallstep'].includes(d.toLowerCase()) && d !== 'CheckInstallStep')).toEqual([]);
    });
});

describe('file names', () => {
    it('contain no "compoment" typo', () => {
        const hits = [...moduleFiles, ...frontendFiles].map(rel).filter((p) => /compoment/i.test(p));
        expect(hits).toEqual([]);
    });
    it('register routes from routes.js only', () => {
        const hits = moduleFiles.map(rel).filter((p) => /\/routes?\d+\.js$/.test(p) && !ROUTE_FILE_EXCEPTIONS.has(p));
        expect(hits).toEqual([]);
    });
    it('do not carry a redundant -config suffix', () => {
        const hits = walk(path.join(ROOT, 'Config')).map(rel).filter((p) => /-config\.js$/.test(p));
        expect(hits).toEqual([]);
    });
});

describe('config', () => {
    it.each(['config.js', 'env.js', 'collections.js', 'schemaType.js'])('has Config/%s', (file) => {
        expect(fs.existsSync(path.join(ROOT, 'Config', file))).toBe(true);
    });
});
