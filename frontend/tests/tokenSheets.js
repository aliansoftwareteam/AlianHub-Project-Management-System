/* Reads a stylesheet the way a look sees it: tokens.css says what each look sets, a rule's var()s
   are resolved against that, and min(), max() and calc() are worked out as a browser would. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

export const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
export const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
export const styleOf = (rel) => withoutComments(rel.endsWith('.vue')
    ? [...read(rel).matchAll(/<style(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    : read(rel));
export const templateOf = (rel) => read(rel).slice(0, read(rel).indexOf('<script'));

export function mediaBlocks(source, query) {
    const blocks = [];
    let from = 0;
    for (;;) {
        const start = source.indexOf(`@media ${query}`, from);
        if (start === -1) return blocks.join('\n');
        const open = source.indexOf('{', start);
        let depth = 1;
        let at = open + 1;
        while (depth && at < source.length) {
            if (source[at] === '{') depth += 1;
            if (source[at] === '}') depth -= 1;
            at += 1;
        }
        blocks.push(source.slice(open + 1, at - 1));
        from = at;
    }
}
export const withoutMedia = (source) => source.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');

/* What one selector ends up with inside a stylesheet: every rule that lists it, later ones winning. */
export function declarations(css, selector) {
    const out = {};
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].forEach(([, selectors, body]) => {
        if (!selectors.split(',').map((s) => s.trim()).includes(selector)) return;
        body.split(';').map((d) => d.trim()).filter(Boolean).forEach((d) => {
            out[d.slice(0, d.indexOf(':')).trim()] = d.slice(d.indexOf(':') + 1).trim();
        });
    });
    return out;
}
export const declared = (rel, selector, property) => declarations(withoutMedia(styleOf(rel)), selector)[property] || '';
export const PHONE = '(max-width: 767px)';
export const within = (rel, query, selector, property) => declarations(mediaBlocks(styleOf(rel), query), selector)[property] || '';
export const onPhone = (rel, selector, property) => within(rel, PHONE, selector, property);

const tokens = withoutComments(read('assets/css/tokens.css'));
const block = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    return start === -1 ? '' : tokens.slice(start + selector.length + 2, tokens.indexOf('}', start));
};
const custom = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const base = custom(block(':root'));
const phoneAt = tokens.indexOf('@media (max-width: 767px) {\n    body {');
const phoneBody = tokens.slice(phoneAt, tokens.indexOf('}', phoneAt));
const compactAt = tokens.indexOf('[data-density="compact"]');

export const ENV = {
    dense: base,
    compact: { ...base, ...custom(tokens.slice(compactAt, tokens.indexOf('}', compactAt))) },
    classic: { ...base, ...custom(block(':root[data-variant="classic"]')) },
    a: { ...base, ...custom(block(':root[data-variant="a"]')) },
    c: { ...base, ...custom(block(':root[data-variant="c"]')) },
    phone: { ...base, ...custom(phoneBody) },
};
export const LOOKS = ['dense', 'classic', 'a', 'c'];
export const UNSET_IN_CLASSIC = Object.keys(ENV.classic).filter((name) => ENV.classic[name] === 'initial');

/* The font families stay as written: a size is what a look changes. */
const FAMILY = /var\((--font-(?:ui|mono))\)/g;
export function resolve(value, env) {
    let out = value.replace(FAMILY, '<$1>');
    for (let pass = 0; pass < 24 && out.includes('var('); pass += 1) {
        out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/, (whole, name, fallback) => {
            if (env[name] !== undefined && env[name] !== 'initial') return env[name];
            if (fallback !== undefined) return fallback.trim();
            throw new Error(`${name} is not set and has no fallback in "${value}"`);
        }).replace(FAMILY, '<$1>');
    }
    return out.replace(/<(--font-(?:ui|mono))>/g, 'var($1)');
}
export function computed(value, env) {
    let out = resolve(value, env);
    const number = (expression) => {
        const sum = expression.replace(/px/g, '');
        if (!sum.trim() || !/^[\d\s.+\-*/]+$/.test(sum)) throw new Error(`cannot compute "${expression}" in "${value}"`);
        return Function(`return (${sum});`)();
    };
    for (let pass = 0; pass < 24 && /(min|max|calc)\(/.test(out); pass += 1) {
        out = out.replace(/(min|max|calc)\(([^()]*)\)/, (whole, fn, inside) => {
            const parts = inside.split(',').map(number);
            return `${fn === 'calc' ? parts[0] : Math[fn](...parts)}px`;
        });
    }
    return out;
}
export const px = (value, env) => {
    const out = computed(value, env);
    if (!/^-?[\d.]+(px)?$/.test(out)) throw new Error(`"${value}" is not one length (got "${out}")`);
    return parseFloat(out);
};
export const size = (rel, selector, property, look) => px(declared(rel, selector, property), ENV[look]);
export const text = (rel, selector, property, look) => computed(declared(rel, selector, property), ENV[look]);
export const phoneSize = (rel, selector, property) => px(onPhone(rel, selector, property), ENV.phone);

const rules = (rel) => [...styleOf(rel).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    declarations: body.split(';').map((d) => d.trim()).filter(Boolean),
}));
const outsideVar = (declaration) => declaration.replace(/var\((?:[^()]|\([^()]*\))*\)/g, '');
/* A size is a look's when it comes from a type token, with or without a fixed step added to it. */
const TYPE_TOKEN = /var\(\s*--(?:fs-|text-|row-font|chip-font|avatar-font|[\w-]+-(?:fs|font)\b)/;

export const hexColours = (rel) => styleOf(rel).match(/#[0-9a-fA-F]{3,8}\b(?![-\w])/g) || [];
/* A scrim darkens whatever is behind it in either theme, so it is the one colour written out. */
export const literalColours = (rel, { scrims = [] } = {}) => rules(rel).flatMap(({ selector, declarations: list }) => list
    .filter((d) => /rgba?\(|hsla?\(/.test(d))
    .filter((d) => !(scrims.includes(selector) && /^background\s*:\s*rgba\(0, 0, 0, \.\d+\)$/.test(d)))
    .map((d) => `${selector} { ${d} }`));
export const fixedFontSizes = (rel) => rules(rel).flatMap(({ selector, declarations: list }) => list
    .filter((d) => /^font(-size)?\s*:/.test(d))
    .filter((d) => /\d(px|rem|em)\b/.test(outsideVar(d)) && !TYPE_TOKEN.test(d))
    .map((d) => `${selector} { ${d} }`));
export const unsetWithoutFallback = (rel) => UNSET_IN_CLASSIC.filter((name) => new RegExp(`var\\(\\s*${name}\\s*\\)`).test(styleOf(rel)));
export const inkThreeText = (rel) => rules(rel).flatMap(({ selector, declarations: list }) => list
    .filter((d) => /^color\s*:\s*var\(--ink-3\)/.test(d))
    .map((d) => `${selector} { ${d} }`));

export const classesIn = (template) => [...template.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))
    .concat([...template.matchAll(/'([\w-]+)'\s*:/g)].map((m) => m[1]))
    .filter(Boolean);
export const LEGACY_CLASS = /^(bg-white|bg-light-gray|btn-white|black|blue|gray\d*|GunPowder|form-control|font-size-\d+|font-weight-\d+|border-radius-\d+-px|[pm][trblxy]?-\d+px|m[trbl]-\d+)$/;
