/* A role playbook is the one text a role agent works from, as a prompt for a connected AI and as an in-product
 * skill. It may name only MCP tools that exist, carries every section of the model playbook, and hands work only
 * to roles written beside it. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../Modules/Agents/roles');
const KEYS = ['slug', 'name', 'blueprint', 'department', 'team', 'tools', 'hands_to', 'gates'];
const LISTS = ['tools', 'hands_to', 'gates'];
const OPTIONAL_LISTS = ['tools_optional', 'starter_rules', 'tags'];
const STARTER_RULE = /^(type|tag|priority):\S.*$/;
const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const SECTIONS = [
    'Who it is',
    'What it is responsible for',
    'When to use it',
    'What it needs before it starts (and asks for when missing)',
    'How it works, step by step',
    'What it delivers in AlianHub',
    'Quality checklist',
    'When it hands over to a person',
    'What it never does',
    'AlianHub tools it uses',
    'Example',
];

const playbooks = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return playbooks(full);
    return entry.name.endsWith('.md') ? [full] : [];
});

const parse = (file) => {
    const text = fs.readFileSync(file, 'utf8');
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { text, meta: null, body: text };
    const meta = {};
    match[1].split('\n').filter((line) => line.trim()).forEach((line) => {
        const [, key, value] = line.match(/^([a-z_]+):\s*(.*)$/) || [];
        if (!key) return;
        const list = value.match(/^\[(.*)\]$/);
        meta[key] = list ? list[1].split(',').map((item) => item.trim()).filter(Boolean) : value.trim();
    });
    return { text, meta, body: match[2] };
};

const FILES = playbooks(ROOT).map((file) => ({ file, rel: path.relative(ROOT, file), ...parse(file) }));
const allTools = (meta) => [...meta.tools, ...(Array.isArray(meta.tools_optional) ? meta.tools_optional : [])];
const QUEUE = ['queue.list', 'queue.claim', 'queue.release'];
const toolName = /^[a-z_]+(\.[a-z_]+)+$/;

describe('role playbooks', () => {
    let registered;

    beforeAll(() => {
        registered = new Set(require('../../Modules/Mcp/tools').registered().map((tool) => tool.name));
    });

    it('finds the playbooks and the tool list (the scan works)', () => {
        expect(FILES.length).toBeGreaterThan(0);
        expect(registered.has('task.get')).toBe(true);
    });

    it('open with frontmatter holding every key', () => {
        const short = FILES.flatMap(({ rel, meta }) => (meta ? KEYS.filter((key) => meta[key] === undefined || meta[key] === '').map((key) => `${rel}: ${key}`) : [`${rel}: no frontmatter`]));
        expect(short).toEqual([]);
        const notLists = FILES.flatMap(({ rel, meta }) => LISTS.filter((key) => !Array.isArray(meta[key])).map((key) => `${rel}: ${key}`));
        expect(notLists).toEqual([]);
        const badOptional = FILES.flatMap(({ rel, meta }) => OPTIONAL_LISTS.filter((key) => meta[key] !== undefined && !Array.isArray(meta[key])).map((key) => `${rel}: ${key}`));
        expect(badOptional).toEqual([]);
    });

    it('keep a tool either required or optional, not both', () => {
        const both = FILES.flatMap(({ rel, meta }) => (meta.tools_optional || []).filter((name) => meta.tools.includes(name)).map((name) => `${rel}: ${name}`));
        expect(both).toEqual([]);
    });

    it('write each starter rule as a type, tag or priority condition, with a priority the company has', () => {
        const bad = FILES.flatMap(({ rel, meta }) => (meta.starter_rules || []).filter((rule) => !STARTER_RULE.test(rule) || (rule.startsWith('priority:') && !PRIORITIES.includes(rule.slice('priority:'.length)))).map((rule) => `${rel}: ${rule}`));
        expect(bad).toEqual([]);
    });

    it('keep tags short, few and distinct, and never name a tag twice', () => {
        const bad = FILES.flatMap(({ rel, meta }) => {
            const tags = meta.tags || [];
            const lower = tags.map((tag) => tag.toLowerCase());
            return [
                ...tags.filter((tag) => tag.length > 50).map((tag) => `${rel}: ${tag} is too long`),
                ...(tags.length > 6 ? [`${rel}: more than 6 tags`] : []),
                ...(new Set(lower).size !== lower.length ? [`${rel}: a tag is named twice`] : []),
            ];
        });
        expect(bad).toEqual([]);
    });

    it('offer a tag condition only for a tag the same role proposes, so the rule has a tag to wait for', () => {
        const orphan = FILES.flatMap(({ rel, meta }) => (meta.starter_rules || [])
            .filter((rule) => rule.startsWith('tag:') && !(meta.tags || []).map((tag) => tag.toLowerCase()).includes(rule.slice('tag:'.length).toLowerCase()))
            .map((rule) => `${rel}: ${rule}`));
        expect(orphan).toEqual([]);
    });

    it('give starter rules to a handful of roles in every blueprint', () => {
        const byBlueprint = new Map();
        FILES.forEach(({ meta }) => byBlueprint.set(meta.blueprint, (byBlueprint.get(meta.blueprint) || 0) + ((meta.starter_rules || []).length ? 1 : 0)));
        expect([...byBlueprint].filter(([, count]) => count < 3 || count > 8).map(([blueprint]) => blueprint)).toEqual([]);
    });

    it('use a slug no other blueprint uses, since readAll refuses a repeated slug', () => {
        const seen = new Map();
        FILES.forEach(({ rel, meta }) => seen.set(meta.slug, [...(seen.get(meta.slug) || []), rel]));
        expect([...seen.values()].filter((rels) => rels.length > 1)).toEqual([]);
    });

    it('name their team as lower-case words joined by hyphens, so a pack groups them', () => {
        const bad = FILES.filter(({ meta }) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(meta.team || ''))).map(({ rel, meta }) => `${rel}: ${meta.team}`);
        expect(bad).toEqual([]);
    });

    it('are named by their slug, in the folder of their blueprint', () => {
        const wrong = FILES.filter(({ rel, meta }) => rel !== path.join(meta.blueprint, `${meta.slug}.md`)).map(({ rel }) => rel);
        expect(wrong).toEqual([]);
    });

    it('carry every section of the model playbook, in its order', () => {
        const missing = FILES.flatMap(({ rel, body }) => {
            const headings = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
            const at = SECTIONS.map((section) => headings.findIndex((heading) => heading === section || heading.startsWith(`${section} (`)));
            const absent = SECTIONS.filter((section, i) => at[i] < 0).map((section) => `${rel}: ${section}`);
            const ordered = at.every((index, i) => i === 0 || index > at[i - 1]);
            return absent.length || ordered ? absent : [`${rel}: sections out of order`];
        });
        expect(missing).toEqual([]);
    });

    it('list only MCP tools that exist', () => {
        const unknown = FILES.flatMap(({ rel, meta }) => allTools(meta).filter((name) => !registered.has(name)).map((name) => `${rel}: ${name}`));
        expect(unknown).toEqual([]);
    });

    it('name in the text only tools that exist, and only tools the frontmatter lists', () => {
        const stray = FILES.flatMap(({ rel, meta, body }) => [...body.matchAll(/`([^`]+)`/g)]
            .map((m) => m[1])
            .filter((name) => toolName.test(name))
            .filter((name) => !registered.has(name) || !allTools(meta).includes(name))
            .map((name) => `${rel}: ${name}`));
        expect(stray).toEqual([]);
    });

    it('show every listed tool in the tools section', () => {
        const unnamed = FILES.flatMap(({ rel, meta, body }) => {
            const section = (body.split(/^## AlianHub tools it uses$/m)[1] || '').split(/^## /m)[0];
            return allTools(meta).filter((name) => !section.includes(`\`${name}\``)).map((name) => `${rel}: ${name}`);
        });
        expect(unnamed).toEqual([]);
    });

    it('take routed work from their queue, unless the frontmatter says routed: false', () => {
        const routed = FILES.filter(({ meta }) => meta.routed !== 'false');
        expect(routed.length).toBeGreaterThan(0);
        expect(FILES.filter(({ meta }) => ![undefined, 'true', 'false'].includes(meta.routed)).map(({ rel }) => rel)).toEqual([]);
        const short = routed.flatMap(({ rel, meta }) => QUEUE.filter((name) => !meta.tools.includes(name)).map((name) => `${rel}: ${name}`));
        expect(short).toEqual([]);
        const firstStep = routed.filter(({ body }) => {
            const section = (body.split(/^## How it works, step by step$/m)[1] || '').split(/^## /m)[0];
            return !/^1\. \*\*Take the work/.test(section.trim());
        }).map(({ rel }) => rel);
        expect(firstStep).toEqual([]);
    });

    it('hand work only to roles written in the same blueprint', () => {
        const slugs = new Set(FILES.map(({ meta }) => `${meta.blueprint}/${meta.slug}`));
        const dangling = FILES.flatMap(({ rel, meta }) => meta.hands_to.filter((slug) => !slugs.has(`${meta.blueprint}/${slug}`)).map((slug) => `${rel}: ${slug}`));
        expect(dangling).toEqual([]);
    });

    it('use plain punctuation: no em dash', () => {
        expect(FILES.filter(({ text }) => text.includes('—')).map(({ rel }) => rel)).toEqual([]);
    });
});
