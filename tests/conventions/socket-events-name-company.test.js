const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCANNED = ['Modules', 'socket', 'event', 'utils', 'Config', 'middlewares'];
/* The relays of these modules send an event only to sockets of the company it names. */
const MODULES = ['task', 'userIdNotification', 'generalReminder', 'project', 'sprints', 'folders'];
const RELAYED_TYPES = ['update', 'insert', 'delete'];

const sourceFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
});

const withoutComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const enclosingObject = (source, at) => {
    let depth = 0;
    let start = at;
    for (; start >= 0; start -= 1) {
        if (source[start] === '}') depth += 1;
        else if (source[start] === '{') {
            if (depth === 0) break;
            depth -= 1;
        }
    }
    depth = 0;
    let end = at;
    for (; end < source.length; end += 1) {
        if (source[end] === '{') depth += 1;
        else if (source[end] === '}') {
            if (depth === 0) break;
            depth -= 1;
        }
    }
    return source.slice(start, end + 1);
};

const isRelayed = (payload) => {
    const type = /\btype:\s*['"]([A-Za-z]+)['"]/.exec(payload);
    return !type || RELAYED_TYPES.includes(type[1]);
};

const payloadsIn = (file) => {
    const source = withoutComments(fs.readFileSync(file, 'utf8'));
    const marker = new RegExp(`module:\\s*['"](?:${MODULES.join('|')})['"]`, 'g');
    const found = [];
    for (let match = marker.exec(source); match; match = marker.exec(source)) {
        const payload = enclosingObject(source, match.index);
        if (!isRelayed(payload)) continue;
        found.push({
            where: `${path.relative(ROOT, file)}:${source.slice(0, match.index).split('\n').length}`,
            namesCompany: /\bcompanyId\b/.test(payload),
        });
    }
    return found;
};

describe('events that are relayed inside one company', () => {
    const payloads = SCANNED.flatMap((dir) => sourceFiles(path.join(ROOT, dir))).flatMap(payloadsIn);

    it('are found by this scan', () => {
        expect(payloads.length).toBeGreaterThan(80);
    });

    it('name the company they were written in', () => {
        expect(payloads.filter((payload) => !payload.namesCompany).map((payload) => payload.where)).toEqual([]);
    });
});
