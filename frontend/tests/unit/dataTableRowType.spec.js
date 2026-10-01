/* Data a person scans in a table is set in the List's row type, and a text row is as tall as a
   List row. Headers, meta lines and helper text keep the small or label type. Read from the
   stylesheets, with the tokens of each look worked out as the browser would. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const withoutMedia = (source) => source.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
const styleOf = (rel) => withoutMedia(withoutComments(rel.endsWith('.vue')
    ? [...read(rel).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    : read(rel)));

function declarations(css, selector) {
    const out = {};
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].forEach(([, selectors, body]) => {
        if (!selectors.split(',').map((s) => s.trim()).includes(selector)) return;
        body.split(';').map((d) => d.trim()).filter(Boolean).forEach((d) => {
            out[d.slice(0, d.indexOf(':')).trim()] = d.slice(d.indexOf(':') + 1).trim();
        });
    });
    return out;
}
const declared = (rel, selector, property) => declarations(styleOf(rel), selector)[property] || '';

const tokens = withoutComments(read('assets/css/tokens.css'));
const block = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    return start === -1 ? '' : tokens.slice(start + selector.length + 2, tokens.indexOf('}', start));
};
const custom = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const base = custom(block(':root'));
const ENV = Object.fromEntries(['a', 'b', 'c', 'classic'].map((look) => [look, { ...base, ...custom(block(`:root[data-variant="${look}"]`)) }]));
ENV.dense = base;

const FAMILY = /var\((--font-(?:ui|mono))\)/g;
function computed(value, env) {
    let out = value.replace(FAMILY, '<$1>');
    for (let pass = 0; pass < 32 && out.includes('var('); pass += 1) {
        out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/, (whole, name, fallback) => {
            if (env[name] !== undefined && env[name] !== 'initial') return env[name];
            if (fallback !== undefined) return fallback.trim();
            throw new Error(`${name} is not set and has no fallback in "${value}"`);
        }).replace(FAMILY, '<$1>');
    }
    const number = (expression) => {
        const sum = expression.replace(/px/g, '');
        if (!sum.trim() || !/^[\d\s.+\-*/]+$/.test(sum)) throw new Error(`cannot compute "${expression}" in "${value}"`);
        return Math.round(Function(`return (${sum});`)() * 1000) / 1000;
    };
    for (let pass = 0; pass < 32 && /\([^()]*\)/.test(out); pass += 1) {
        out = out.replace(/(min|max|calc)?\(([^()]*)\)/, (whole, fn, inside) => {
            const parts = inside.split(',').map(number);
            return `${fn === 'min' || fn === 'max' ? Math[fn](...parts) : parts[0]}px`;
        });
    }
    return out.replace(/<(--font-(?:ui|mono))>/g, 'var($1)');
}
const px = (value, env) => parseFloat(computed(value, env));

/* [file, the rule that sets a cell's text, the header rule, the rule that pads a row, old padding] */
const TABLES = [
    ['views/Settings/Audit/AuditLog.vue', '.al__table td', '.al__table th', '.al__table td', '11px 12px'],
    ['views/Settings/Instance/InstanceShell.vue', '.in-table td', '.in-table th', '.in-table td', '8px 8px'],
    ['views/Settings/Integrations/Integrations.vue', '.ig__logs-table td', '.ig__logs-table th', '.ig__logs-table td', '6px 8px'],
    ['views/Settings/Integrations/StoredSecrets.vue', '.sec__table td', '.sec__table th', '.sec__table td', '6px 8px'],
    ['views/Ai/SkillLibrary.vue', '.ai-table td', '.ai-table th', '.ai-table td', '9px 10px'],
    ['views/Ai/AgentRevisionHistory.vue', '.ai-revisions__table td', '.ai-revisions__table th', '.ai-revisions__table td', '8px 8px'],
    ['views/Ai/AiQuality.vue', '.ai-quality__table td', '.ai-quality__table th', '.ai-quality__table td', '8px 10px'],
    ['views/Ai/AiHealth.vue', '.ai-health__table td', '.ai-health__table th', '.ai-health__table td', '9px 10px'],
    ['components/molecules/Setting/PermissionMatrix.vue', '.pm__perm-name', '.pm__row--head', '.pm__row', '8px 16px'],
    ['views/Settings/Template/style.css', '.tp__name', '.tp__row--head', '.tp__row', '11px 14px'],
];
const fontSizeOf = (rel, selector, env) => {
    const rule = declarations(styleOf(rel), selector);
    if (rule['font-size']) return computed(rule['font-size'], env);
    return /(?:^|\s)([\d.]+px)\//.exec(computed(rule.font, env))[1];
};

describe('the table padding token', () => {
    it('centres one line of row type in a List row', () => {
        expect(base['--table-pad-y']).toBe('calc((var(--row-h) - var(--row-font) * var(--lh-body)) / 2)');
    });

    it.each(['dense', 'a', 'b', 'c'])('makes a text row as tall as a List row in %s', (look) => {
        const env = ENV[look];
        const line = px('calc(var(--row-font) * var(--lh-body))', env);
        expect(2 * px('var(--table-pad-y)', env) + line).toBeCloseTo(px('var(--row-h)', env), 2);
        expect(px('var(--table-pad-y)', env)).toBeGreaterThanOrEqual(px('var(--cell-pad-y)', env));
    });

    it('is 6.9px in the dense default', () => {
        expect(px('var(--table-pad-y)', ENV.dense)).toBe(6.9);
    });

    it('is un-set in classic, so each table keeps the padding it had', () => {
        expect(ENV.classic['--table-pad-y']).toBe('initial');
        expect(ENV.classic['--cell-pad-x']).toBe('initial');
    });

    it('is set once, on the root: no look restates it and no density changes it', () => {
        ['a', 'b', 'c'].forEach((look) => expect(custom(block(`:root[data-variant="${look}"]`))['--table-pad-y'], look).toBeUndefined());
        const compactAt = tokens.indexOf('[data-density="compact"]');
        expect(tokens.slice(compactAt, tokens.indexOf('}', compactAt))).not.toContain('--table-pad-y');
    });
});

describe.each(TABLES)('%s', (rel, cell, head, row, formerPadding) => {
    it(`${cell} is set in the row type`, () => {
        const rule = declarations(styleOf(rel), cell);
        expect(`${rule.font || ''} ${rule['font-size'] || ''}`).toContain('var(--row-font, 12.5px)');
        expect(fontSizeOf(rel, cell, ENV.dense)).toBe('13px');
        expect(px('var(--row-font)', ENV.dense)).toBe(13);
    });

    it(`${head} is not`, () => {
        const rule = declarations(styleOf(rel), head);
        expect(Object.keys(rule).length).toBeGreaterThan(0);
        expect(`${rule.font || ''} ${rule['font-size'] || ''}`).not.toContain('--row-font');
    });

    it('classic computes the 12.5px and the padding it had', () => {
        expect(fontSizeOf(rel, cell, ENV.classic)).toBe('12.5px');
        const padding = computed(declared(rel, row, 'padding'), ENV.classic).split(' ');
        expect(`${padding[0]} ${padding[1] || padding[0]}`).toBe(formerPadding);
    });

    it('a row is padded from the table token', () => {
        expect(declared(rel, row, 'padding')).toMatch(/^var\(--table-pad-y, \d+px\) /);
        expect(computed(declared(rel, row, 'padding'), ENV.dense).split(' ')[0]).toBe('6.9px');
    });
});

describe('real tables keep their header over their cells', () => {
    it.each(TABLES.filter(([, cell]) => cell.endsWith(' td')))('%s: both pad sideways from --cell-pad-x', (rel, cell, head) => {
        const side = (selector) => declared(rel, selector, 'padding').split(/\s+(?=var\(--cell-pad-x)/)[1];
        expect(side(cell)).toMatch(/^var\(--cell-pad-x, \d+px\)$/);
        expect(side(head)).toBe(side(cell));
    });
});

describe('what stays small inside a table', () => {
    it('the audit log\'s id, cost and meta lines', () => {
        ['.al__id', '.al__cost', '.al__meta'].forEach((selector) => {
            expect(declared('views/Settings/Audit/AuditLog.vue', selector, 'font-size'), selector).toBe('var(--fs-sm, 12.5px)');
        });
    });

    it('a table\'s own base type, which its header and caption inherit', () => {
        ['views/Settings/Instance/InstanceShell.vue|.in-table', 'views/Ai/AgentRevisionHistory.vue|.ai-revisions__table', 'components/molecules/Setting/PermissionMatrix.vue|.pm', 'views/Settings/Template/style.css|.tp__table'].forEach((entry) => {
            const [rel, selector] = entry.split('|');
            expect(declared(rel, selector, 'font'), entry).toBe('var(--text-small)');
        });
    });
});
