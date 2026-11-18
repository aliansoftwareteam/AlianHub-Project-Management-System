const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(process.env.LOG_DIR || 'log');
const KINDS = ['error', 'combined', 'track'];
const FILE_RX = /^(error|combined|track)-(\d{4}-\d{2}-\d{2})\.log$/;

/* Pure: picks the newest rotated file of one kind from a directory listing.
 * Only the three basenames winston writes are ever considered, so a query
 * string can never name another file. */
function pickLogFile(kind, names) {
    if (!KINDS.includes(kind)) return null;
    const candidates = names
        .map((name) => name.match(FILE_RX))
        .filter((m) => m && m[1] === kind)
        .map((m) => ({ name: m[0], date: m[2] }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
    return candidates.length ? candidates[0].name : null;
}

function listLogFiles(dir = LOG_DIR) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    return names.filter((n) => FILE_RX.test(n)).sort().reverse().map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, size: stat.size, modifiedAt: stat.mtime };
    });
}

/* Pure: the last `lines` lines of a text, newest last. */
function tailLines(text, lines) {
    const all = String(text).split(/\r?\n/);
    if (all.length && all[all.length - 1] === '') all.pop();
    return all.slice(Math.max(0, all.length - lines));
}

async function readTail(kind, lines = 500, dir = LOG_DIR) {
    const name = pickLogFile(kind, fs.existsSync(dir) ? fs.readdirSync(dir) : []);
    if (!name) return { file: null, lines: [] };
    const file = path.join(dir, name);
    const { size } = fs.statSync(file);
    // 200 bytes per line is generous for winston's format; read at most that window.
    const window = Math.min(size, Math.max(lines * 200, 64 * 1024));
    const handle = await fs.promises.open(file, 'r');
    try {
        const buffer = Buffer.alloc(window);
        await handle.read(buffer, 0, window, size - window);
        const text = buffer.toString('utf8');
        const tail = tailLines(window < size ? text.slice(text.indexOf('\n') + 1) : text, lines);
        return { file: name, size, lines: tail };
    } finally {
        await handle.close();
    }
}

function resolveLogFile(name, dir = LOG_DIR) {
    if (!FILE_RX.test(String(name))) return null;
    const file = path.join(dir, path.basename(name));
    return fs.existsSync(file) ? file : null;
}

module.exports = { LOG_DIR, KINDS, FILE_RX, pickLogFile, listLogFiles, tailLines, readTail, resolveLogFile };
