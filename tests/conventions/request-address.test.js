const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE_DIRS = ['Modules', 'Config', 'utils', 'middlewares', 'event', 'socket', 'common-storage'];

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

/* A client can send any x-forwarded-for it likes. Only req.ip, which follows TRUST_PROXY, says which hop to believe. */
describe('request addresses follow the trust-proxy setting', () => {
    it('never reads the forwarded header directly', () => {
        const directRead = /headers\s*(\[\s*['"`]x-forwarded-for|\.\s*x-forwarded-for)|\.get\(\s*['"`]x-forwarded-for|header\(\s*['"`]x-forwarded-for/i;
        const hits = sources().filter((file) => directRead.test(fs.readFileSync(file, 'utf8')));
        expect(hits.map(rel)).toEqual([]);
    });

    it('never falls back to the raw socket address', () => {
        const hits = sources()
            .filter((file) => !file.endsWith(path.join('utils', 'requestAddress.js')))
            .filter((file) => /connection\s*\??\.\s*remoteAddress/.test(fs.readFileSync(file, 'utf8')));
        expect(hits.map(rel)).toEqual([]);
    });
});
