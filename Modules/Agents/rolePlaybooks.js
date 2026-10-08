const fs = require('fs');
const path = require('path');
const logger = require('../../Config/loggerConfig');

const ROOT = path.join(__dirname, 'roles');
const KEYS = ['slug', 'name', 'blueprint', 'department', 'tools', 'hands_to', 'gates'];
const LISTS = ['tools', 'hands_to', 'gates'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class PlaybookError extends Error {}

const filesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return entry.name.endsWith('.md') ? [full] : [];
});

const parseFrontmatter = (block) => Object.fromEntries(block.split('\n').filter((line) => line.trim()).map((line) => {
    const [, key, value] = line.match(/^([a-z_]+):\s*(.*)$/) || [];
    if (!key) throw new PlaybookError(`cannot read the frontmatter line "${line.trim()}"`);
    const list = value.match(/^\[(.*)\]$/);
    return [key, list ? list[1].split(',').map((item) => item.trim()).filter(Boolean) : value.trim()];
}));

const parse = (text, rel) => {
    const fail = (why) => { throw new PlaybookError(`Role playbook ${rel}: ${why}`); };
    const match = String(text).replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) fail('it does not open with a --- frontmatter block');
    let meta;
    try { meta = parseFrontmatter(match[1]); } catch (error) { fail(error.message); }
    const missing = KEYS.filter((key) => meta[key] === undefined || meta[key] === '');
    if (missing.length) fail(`the frontmatter lacks ${missing.join(', ')}`);
    const notLists = LISTS.filter((key) => !Array.isArray(meta[key]));
    if (notLists.length) fail(`${notLists.join(', ')} must be a [list]`);
    if (!SLUG.test(meta.slug) || !SLUG.test(meta.blueprint)) fail('the slug and the blueprint must be lower-case words joined by hyphens');
    if (rel !== undefined && rel !== path.join(meta.blueprint, `${meta.slug}.md`)) fail(`it must live at ${path.join(meta.blueprint, `${meta.slug}.md`)}`);
    const body = match[2].trim();
    if (!body) fail('the playbook text is empty');
    return {
        slug: meta.slug,
        name: meta.name,
        blueprint: meta.blueprint,
        department: meta.department,
        ...(meta.team ? { team: meta.team } : {}),
        tools: meta.tools,
        handsTo: meta.hands_to,
        gates: meta.gates,
        body,
    };
};

/* A broken playbook is left out and reported, so one bad file never takes the other roles or the prompt list down. */
const readAll = (root = ROOT, report = (message) => logger.error(message)) => {
    const seen = new Map();
    const roles = filesUnder(root).sort().flatMap((file) => {
        try {
            const role = parse(fs.readFileSync(file, 'utf8'), path.relative(root, file));
            if (seen.has(role.slug)) throw new PlaybookError(`Role playbook ${role.blueprint}/${role.slug}.md: the slug "${role.slug}" is also used by ${seen.get(role.slug)}/${role.slug}.md`);
            seen.set(role.slug, role.blueprint);
            return [Object.freeze(role)];
        } catch (error) {
            report(error instanceof PlaybookError ? error.message : `Role playbook ${path.relative(root, file)}: ${error.message}`);
            return [];
        }
    });
    return Object.freeze(roles);
};

let cached = null;
const all = () => {
    if (!cached) cached = readAll();
    return cached;
};

const find = (blueprint, slug) => all().find((role) => role.blueprint === String(blueprint) && role.slug === String(slug)) || null;

const summary = (role, max) => {
    const who = ((role.body.split(/^## Who it is\s*$/m)[1] || '').split(/^## /m)[0].trim().split(/\n\s*\n/)[0] || '').replace(/\s+/g, ' ').trim();
    const sentences = who.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [who];
    let kept = '';
    for (const sentence of sentences) {
        const next = `${kept} ${sentence.trim()}`.trim();
        if (next.length > max) break;
        kept = next;
    }
    return kept || who.slice(0, max).trim();
};

module.exports = { PlaybookError, parse, readAll, all, find, summary };
