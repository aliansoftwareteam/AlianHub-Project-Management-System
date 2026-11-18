/* A component's root class that a stylesheet reaching every page also positions: the component is lifted
   out of its place by a rule written for something else. Static scan, no dependencies.
   Not counted: a rule that only sets `position` (a utility such as .position-fi, used on purpose), and a
   sheet the component loads itself or that sits in the component's folder or a folder above it. */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');
const COMPONENT_DIRS = ['views', 'components'];
const PASS_THROUGH = ['template', 'teleport', 'transition', 'transition-group', 'transitiongroup', 'keep-alive', 'keepalive', 'suspense'];
const LIFTS = /^position\s*:\s*(?:fixed|absolute)\b/i;
const BARE_CLASS = /^\.(-?[A-Za-z_][\w-]*)$/;

const walk = (dir, keep, out = []) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, keep, out);
        else if (keep(entry.name)) out.push(full);
    });
    return out;
};

const blank = (text) => text.replace(/[^\n]/g, ' ');

const maskCss = (css) => css
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, blank)
    .replace(/url\([^)]*\)/gi, blank)
    .replace(/#\{[^}]*\}/g, blank)
    .replace(/(^|[\s;{}])\/\/[^\n]*/g, (line, lead) => lead + blank(line.slice(lead.length)));

/* The classes a sheet lifts out of the flow, and places, through a selector that is one class and nothing
   else, at the top level or inside an at-rule such as @media. */
function liftedClasses(css) {
    const text = maskCss(css);
    const found = new Set();
    const open = [];
    let from = 0;
    const declared = (end) => {
        const rule = open[open.length - 1];
        const declaration = text.slice(from, end).trim();
        if (!rule || !declaration.includes(':')) return;
        if (LIFTS.test(declaration)) rule.lifts = true;
        else rule.others += 1;
    };
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '{') {
            open.push({ prelude: text.slice(from, i).trim(), lifts: false, others: 0 });
            from = i + 1;
        } else if (ch === ';') {
            declared(i);
            from = i + 1;
        } else if (ch === '}') {
            declared(i);
            const rule = open.pop();
            from = i + 1;
            if (rule && rule.lifts && rule.others > 0 && open.every((outer) => outer.prelude.startsWith('@'))) {
                rule.prelude.split(',').map((selector) => BARE_CLASS.exec(selector.trim())).filter(Boolean).forEach((match) => found.add(match[1]));
            }
        }
    }
    return [...found];
}

const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;

const styleBlocks = (vue) => [...vue.matchAll(STYLE_BLOCK)].map(([, attrs, css]) => ({
    scoped: /\b(?:scoped|module)\b/i.test(attrs),
    src: (/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1] || '',
    css,
}));

const resolveFrom = (src, file, request) => (request.startsWith('@/') ? path.join(src, request.slice(2)) : path.resolve(path.dirname(file), request));

const sheetsNamedIn = (src, file, text) => [...text.matchAll(/["']([^"'\n]+\.css)["']/g)].map((match) => resolveFrom(src, file, match[1]));

/* The first element a component renders and the classes written on it, looking through the wrappers that render no element of their own. */
function rootClasses(vue) {
    const start = vue.search(/<template\b[^>]*>/i);
    if (start === -1) return [];
    const body = vue.slice(start).replace(/<!--[\s\S]*?-->/g, blank);
    const tags = body.matchAll(/<([A-Za-z][\w.-]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g);
    let first = true;
    for (const [, name, attrs] of tags) {
        if (first) { first = false; continue; }
        if (PASS_THROUGH.includes(name.toLowerCase())) continue;
        const written = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
        return written ? (written[1] || written[2] || '').split(/\s+/).filter(Boolean) : [];
    }
    return [];
}

const isAbove = (dir, file) => !path.relative(dir, file).startsWith('..');

/* Every sheet that is not scoped to one component: a .css file (also one pulled in with @import from a scoped
   block, which the build leaves unscoped), and a <style> block without `scoped`. */
function globalSheets(src = SRC) {
    const vueFiles = walk(src, (name) => name.endsWith('.vue'));
    const scopedBySrc = new Set();
    const sheets = [];
    vueFiles.forEach((file) => {
        styleBlocks(fs.readFileSync(file, 'utf8')).forEach((block) => {
            if (block.src && block.scoped) scopedBySrc.add(resolveFrom(src, file, block.src));
            if (!block.scoped && !block.src) sheets.push({ file, css: block.css });
        });
    });
    walk(src, (name) => name.endsWith('.css') && !name.endsWith('.module.css'))
        .filter((file) => !scopedBySrc.has(file))
        .forEach((file) => sheets.push({ file, css: fs.readFileSync(file, 'utf8') }));
    return sheets;
}

/* { 'views/X.vue': ['class <- sheet', ...] } for each component whose root class a sheet of another part of the app lifts. */
function findCollisions(src = SRC) {
    const liftedBy = new Map();
    globalSheets(src).forEach(({ file, css }) => liftedClasses(css).forEach((name) => {
        if (!liftedBy.has(name)) liftedBy.set(name, new Set());
        liftedBy.get(name).add(file);
    }));
    const relative = (file) => path.relative(src, file).split(path.sep).join('/');
    const hits = {};
    COMPONENT_DIRS.map((dir) => path.join(src, dir)).filter((dir) => fs.existsSync(dir))
        .flatMap((dir) => walk(dir, (name) => name.endsWith('.vue')))
        .forEach((file) => {
            const vue = fs.readFileSync(file, 'utf8');
            const loaded = new Set([file, ...sheetsNamedIn(src, file, vue)]);
            const own = (sheet) => loaded.has(sheet) || isAbove(path.dirname(sheet), file);
            const found = rootClasses(vue).flatMap((name) => [...(liftedBy.get(name) || [])]
                .filter((sheet) => !own(sheet))
                .map((sheet) => `${name} <- ${relative(sheet)}`));
            if (found.length) hits[relative(file)] = found.sort();
        });
    return hits;
}

module.exports = { SRC, liftedClasses, rootClasses, globalSheets, findCollisions };
