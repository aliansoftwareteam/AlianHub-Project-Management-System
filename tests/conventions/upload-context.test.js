const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE_DIRS = ['Modules', 'Config', 'utils', 'middlewares', 'event', 'socket', 'common-storage', 'routes'];
const HELPER = path.join('utils', 'contextMulter.js');

const walk = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, out); } else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
};

const sources = () => [...SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))), path.join(ROOT, 'index.js')].filter((f) => fs.existsSync(f));
const rel = (file) => path.relative(ROOT, file);

/* multer reads the form in busboy's callbacks, which leave the request's AsyncLocalStorage stores behind. */
describe('every upload keeps the request context', () => {
    it('mounts multer only through utils/contextMulter', () => {
        const direct = /require\(\s*['"`]multer['"`]\s*\)/;
        const hits = sources().filter((file) => rel(file) !== HELPER && direct.test(fs.readFileSync(file, 'utf8')));
        expect(hits.map(rel)).toEqual([]);
    });
});
