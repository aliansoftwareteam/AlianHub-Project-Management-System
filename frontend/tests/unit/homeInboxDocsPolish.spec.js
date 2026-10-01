/* Home, the Inbox and the Docs hub read from one type scale and one spacing scale. Read from the
   sources: the stylesheets these three pages ship, and the two Home components whose markup changed. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TaskRow from '@/components/molecules/Home/TaskRow.vue';
import SetupChecklist from '@/components/molecules/Home/SetupChecklist.vue';
import { DENSITY_KEY, loadInboxDensity, saveInboxDensity } from '@/views/Inbox/inboxDensity';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const styleOf = (rel) => {
    const source = read(rel);
    if (!rel.endsWith('.vue')) return withoutComments(source);
    return withoutComments([...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'));
};
const templateOf = (rel) => {
    const source = read(rel);
    return source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>'));
};

const HOME = 'components/molecules/Home/style.css';
const HOME_VIEW = 'views/Home/style.css';
const INBOX = 'views/Inbox/Inbox.vue';
const HUB = 'views/Pages/PagesSpace.vue';
const HOME_PARTS = [
    'components/molecules/Home/AgendaCard.vue',
    'components/molecules/Home/AssignedCommentsCard.vue',
    'components/molecules/Home/HomeCardsMenu.vue',
    'components/molecules/Home/MyWorkCard.vue',
    'components/molecules/Home/PlannerPanel.vue',
    'components/molecules/Home/RecentsCard.vue',
    'components/molecules/Home/SetupChecklist.vue',
    'components/molecules/Home/StandupCard.vue',
    'components/molecules/Home/TaskRow.vue',
    'components/molecules/Home/TimerChip.vue',
    'components/molecules/Home/WaitingOnYouCard.vue',
    'views/Home/TodayOverdue.vue',
];
const STYLED = [HOME, HOME_VIEW, INBOX, HUB, ...HOME_PARTS.filter((rel) => /<style/.test(read(rel)))];
const TEMPLATES = [...HOME_PARTS, INBOX, HUB];

const withoutMedia = (css) => {
    let out = '';
    let at = 0;
    for (;;) {
        const start = css.slice(at).search(/@(media|container)\b/);
        if (start === -1) return out + css.slice(at);
        out += css.slice(at, at + start);
        let depth = 0;
        let i = css.indexOf('{', at + start);
        do {
            if (css[i] === '{') depth += 1;
            if (css[i] === '}') depth -= 1;
            i += 1;
        } while (depth && i < css.length);
        at = i;
    }
};
const blocksOf = (css, prelude) => {
    const blocks = [];
    let from = 0;
    for (;;) {
        const start = css.indexOf(prelude, from);
        if (start === -1) return blocks.join('\n');
        const open = css.indexOf('{', start);
        let depth = 1;
        let at = open + 1;
        while (depth && at < css.length) {
            if (css[at] === '{') depth += 1;
            if (css[at] === '}') depth -= 1;
            at += 1;
        }
        blocks.push(css.slice(open + 1, at - 1));
        from = at;
    }
};
const phoneOf = (css) => blocksOf(css, '@media (max-width: 767px)');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};
const declaration = (body, property) => {
    const match = new RegExp(`(^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(body);
    return match ? match[2].trim() : '';
};
const base = (rel) => withoutMedia(styleOf(rel));
const value = (rel, selector, property) => declaration(ruleBody(base(rel), selector), property);

const declarations = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
    body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => ({ selector: selector.trim(), property: d.slice(0, d.indexOf(':')).trim(), value: d.slice(d.indexOf(':') + 1).trim() })));

const outsideFunctions = (text) => {
    let out = '';
    let depth = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (depth === 0 && /^(var|calc|max|min|clamp)\(/.test(text.slice(i))) {
            i = text.indexOf('(', i);
            depth = 1;
        } else if (depth > 0) {
            if (text[i] === '(') depth += 1;
            if (text[i] === ')') depth -= 1;
        } else {
            out += text[i];
        }
    }
    return out;
};

const tokens = withoutComments(read('assets/css/tokens.css'));
const tokenBlock = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    return start === -1 ? '' : tokens.slice(start + selector.length + 2, tokens.indexOf('}', start));
};
const custom = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const ROOT = custom(tokenBlock(':root'));
const CLASSIC = { ...ROOT, ...custom(tokenBlock(':root[data-variant="classic"]')) };
const compactAt = tokens.indexOf('[data-density="compact"]');
const COMPACT = { ...ROOT, ...custom(tokens.slice(compactAt, tokens.indexOf('}', compactAt))) };
const PHONE = { ...ROOT, ...custom(ruleBody(tokens.slice(tokens.indexOf('@media (max-width: 767px) {\n    body {')), 'body')) };

/* What a declaration computes to under a set of tokens: `initial` and a missing token both
   leave the fallback, which is how the classic look keeps the sizes it had. */
const compute = (text, map) => {
    let out = text;
    for (let pass = 0; pass < 12; pass += 1) {
        const next = out
            .replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (whole, name, fallback) => {
                const set = map[name];
                if (name.startsWith('--font-')) return whole;
                if (set !== undefined && set !== 'initial') return set;
                return fallback === undefined ? whole : fallback.trim();
            })
            .replace(/calc\(((?:[^()]|\([^()]*\))+)\)/g, (whole, sum) => {
                if (!/^[\d\s.+\-*/()px]+$/.test(sum)) return whole;
                return `${Math.round(Function(`return (${sum.replace(/px/g, '')});`)() * 100) / 100}px`;
            })
            .replace(/max\(([^()]+)\)/g, (whole, list) => {
                const sizes = list.split(',').map((part) => part.trim());
                return sizes.every((size) => /^[\d.]+px$/.test(size)) ? `${Math.max(...sizes.map(parseFloat))}px` : whole;
            });
        if (next === out) break;
        out = next;
    }
    return out.replace(/\s+/g, ' ').trim();
};
const px = (rel, selector, property, map = ROOT) => {
    const computed = compute(value(rel, selector, property), map);
    if (!/^-?[\d.]+px$/.test(computed)) throw new Error(`${selector} { ${property} } is "${computed}"`);
    return parseFloat(computed);
};

describe('what was converted carries no colour or class of its own', () => {
    it.each(STYLED)('%s has no hex colour', (rel) => {
        expect(styleOf(rel).match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([]);
    });

    it.each([INBOX, HUB, ...HOME_PARTS.filter((rel) => /<style/.test(read(rel)))])('%s spells no colour out', (rel) => {
        expect(styleOf(rel).match(/rgba?\([^)]*\)/g) || []).toEqual([]);
    });

    it('the Home stylesheet keeps its literal colours in its two token blocks', () => {
        const rules = styleOf(HOME).replace(/:root[^{]*\{[^}]*\}/g, '');
        expect(rules.match(/rgba?\([^)]*\)/g) || []).toEqual([]);
    });

    it.each(TEMPLATES)('%s uses no legacy utility class and no inline style', (rel) => {
        const template = templateOf(rel);
        const classes = [...template.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
        expect(classes.filter((name) => /^(bg-white|font-size-\d+|font-weight-\d+|gray81|black|blue)$/.test(name))).toEqual([]);
        expect(template.match(/\sstyle="[^"]*"/g) || []).toEqual([]);
    });

    it.each(STYLED)('%s never colours text with --ink-3', (rel) => {
        expect(styleOf(rel)).not.toMatch(/(?<![-\w])color\s*:\s*var\(\s*--ink-3\s*\)/);
    });
});

describe('one type scale', () => {
    const fontDeclarations = (rel) => declarations(styleOf(rel)).filter(({ property }) => property === 'font' || property === 'font-size');

    it.each(STYLED)('%s sets no font size outside a token', (rel) => {
        const fixed = fontDeclarations(rel)
            .filter(({ value: v }) => /\d(px|rem|em)\b/.test(outsideFunctions(v)))
            .map(({ selector, property, value: v }) => `${selector} { ${property}: ${v} }`);
        expect(fixed).toEqual([]);
    });

    it.each(STYLED)('%s takes every font size from the scale', (rel) => {
        const off = fontDeclarations(rel)
            .filter(({ value: v }) => v !== 'inherit' && !/var\(--(fs-(2xs|xs|sm|md|lg|xl)|row-font|chip-font|avatar-font|text-(label|data|body|small|h3))\b/.test(v))
            .map(({ selector, property, value: v }) => `${selector} { ${property}: ${v} }`);
        expect(off).toEqual([]);
    });

    const LABEL = '600 var(--fs-xs, 10.5px)/var(--lh-tight, 1.2) var(--font-ui)';

    it.each([[HOME_VIEW, '.home'], [INBOX, '.ibx'], [HUB, '.hub']])('%s: every .ah-label under %s is the one label style, in the UI font', (rel, root) => {
        expect(value(rel, root, '--text-label')).toBe(LABEL);
    });

    it.each([
        ['.hc-group', '600 var(--fs-xs, 10.5px)/var(--lh-tight, 1.2) var(--font-ui)'],
        ['.hs-label', '600 var(--fs-xs, 10px)/var(--lh-tight, 1.2) var(--font-ui)'],
    ])('Home %s is that label', (selector, font) => {
        const body = ruleBody(base(HOME), selector);
        expect(declaration(body, 'font')).toBe(font);
        expect(declaration(body, 'text-transform')).toBe('uppercase');
        expect(declaration(body, 'letter-spacing')).toBe('.06em');
        expect(declaration(body, 'color')).toBe('var(--ink-label)');
    });

    it('the table head of the wiki list and the standup headings use the label token', () => {
        expect(value(HUB, '.hub__wiki-head', 'font')).toBe('var(--text-label)');
        expect(value('components/molecules/Home/StandupCard.vue', '.hstand__heading', 'font')).toBe('var(--text-label)');
    });

    it.each([
        [HOME, '.ah-page .ah-toolbar__title', 'font-size', '--fs-lg'],
        [INBOX, '.ibx__toolbar .ah-toolbar__title', 'font', '--fs-lg'],
        [HUB, '.ah-page.hub .ah-toolbar__title', 'font', '--fs-lg'],
        [HOME, '.hc-card__title', 'font', '--fs-lg'],
        [HOME, '.hc-setup__title', 'font', '--fs-lg'],
        [HOME, '.hp-panel__head', 'font', '--fs-lg'],
        [INBOX, '.ibx__zero-title', 'font', '--fs-lg'],
        [HUB, '.hub__card-title', 'font', '--fs-md'],
        [HOME, '.hc-row', 'font', '--fs-md'],
        [INBOX, '.ibx', 'font-size', '--row-font'],
        [HUB, '.hub__row', 'font', '--row-font'],
        [HUB, '.hub__wiki-row', 'font-size', '--row-font'],
        [HOME, '.hc-row__meta', 'font', '--fs-sm'],
        [HOME, '.ah-toolbar__date', 'font', '--fs-sm'],
        [INBOX, '.ibx__when', 'font', '--fs-sm'],
        [INBOX, '.ibx__target', 'font', '--fs-sm'],
        [HUB, '.hub__row-time', 'font', '--fs-sm'],
        [HUB, '.hub__when', 'font', '--fs-sm'],
        [HUB, '.hub__card-excerpt', 'font', '--fs-sm'],
        [HOME, '.hc-group__sort', 'font', '--fs-xs'],
    ])('%s %s { %s } reads %s', (rel, selector, property, token) => {
        expect(value(rel, selector, property)).toContain(`var(${token}`);
    });

    it.each([
        [HOME, '.hc-group__sort'], [HOME, '.hc-row__meta'], [HOME, '.hc-row__project'], [HOME, '.ah-toolbar__date'], [HOME, '.hc-agenda__nav'], [HOME, '.hp-days'], [HOME, '.hc-timer__label'],
        [INBOX, '.ibx__when'], [INBOX, '.ibx__target'], [INBOX, '.ibx__snooze-hint'],
        [HUB, '.hub__row-time'], [HUB, '.hub__when'],
    ])('%s %s is set in the UI font', (rel, selector) => {
        expect(value(rel, selector, 'font')).toContain('var(--font-ui)');
    });

    it.each([
        [HOME, ['.hc-add__hint', '.hc-agenda__time', '.hc-block__dur', '.hc-group__count', '.hc-setup__ring span', '.hc-timer__clock', '.hp-grid', '.hs-search__kbd']],
        [INBOX, ['.ibx__navcount', '.ibx__tabcount']],
        [HUB, ['.hub__item-badge', '.hub__item-count']],
    ])('%s keeps the mono font for keys, counts and clock times only', (rel, allowed) => {
        const mono = declarations(styleOf(rel)).filter(({ value: v }) => /--font-mono|--text-data/.test(v)).map(({ selector }) => selector);
        expect([...new Set(mono)].sort()).toEqual(allowed);
    });

    it('an agent tag is a label, not a number: it drops the mono chip', () => {
        expect(templateOf(INBOX)).not.toMatch(/ah-chip--mono ibx__agent/);
        expect(read(HUB)).not.toMatch(/ah-chip--mono hub__tag/);
    });
});

describe('My Work rows', () => {
    const row = (selector, property) => value(HOME, selector, property);

    it('the title is the column that takes the free space, and keeps a share of a narrow row', () => {
        expect(row('.hc-row__title', 'flex')).toBe('1 1 0%');
        expect(row('.hc-row__title', 'min-width')).toBe('40%');
        expect(row('.hc-row__title', 'text-overflow')).toBe('ellipsis');
    });

    it('everything after the title gives way before the title does', () => {
        expect(row('.hc-row__tail', 'flex')).toBe('0 1 auto');
        expect(row('.hc-row__tail', 'min-width')).toBe('0');
    });

    it('the project is a chip that shrinks, up to a maximum width', () => {
        expect(row('.hc-row__project', 'flex')).toBe('0 1 auto');
        expect(row('.hc-row__project', 'min-width')).toBe('0');
        expect(parseFloat(row('.hc-row__project', 'max-width'))).toBeLessThanOrEqual(128);
        expect(row('.hc-row__project', 'text-overflow')).toBe('ellipsis');
        expect(row('.hc-row__project', 'height')).toBe('var(--chip-h)');
        expect(row('.hc-row__project', 'border-radius')).toBe('var(--r-chip)');
    });

    it.each(['.hc-row__prio', '.hc-row__meta', '.hc-row__act'])('%s keeps its own width', (selector) => {
        expect(row(selector, 'flex')).toBe('none');
    });

    it('a row does not move under the pointer: the timer sits over the end of the title and the grip in the gutter', () => {
        const css = styleOf(HOME);
        expect(row('.hc-row__timer', 'position')).toBe('absolute');
        expect(row('.hc-row__tail', 'position')).toBe('relative');
        expect(row('.hc-row__grip', 'position')).toBe('absolute');
        expect(row('.hc-row', 'position')).toBe('relative');
        expect(css).not.toMatch(/\.hc-row:hover \.hc-row__(act|timer|grip|date)[^{]*\{[^}]*(display|position|width|margin)\s*:/);
        expect(templateOf('components/molecules/Home/TaskRow.vue')).toMatch(/class="hc-row__act hc-row__timer"/);
    });

    it('a timer that is not shown is not a target lying over the title', () => {
        const css = styleOf(HOME);
        expect(row('.hc-row__timer', 'visibility')).toBe('hidden');
        expect(row('.hc-row__timer', 'pointer-events')).toBe('none');
        expect(css).toMatch(/\.hc-row:hover \.hc-row__timer,[^{]*\.hc-row:focus-within \.hc-row__timer[^{]*\{[^}]*visibility:\s*visible;[^}]*pointer-events:\s*auto/);
    });

    it('a running timer stays in the row, where it takes its own width', () => {
        expect(declaration(ruleBody(base(HOME), '.hc-row__timer.is-on'), 'position')).toBe('static');
        expect(declaration(ruleBody(base(HOME), '.hc-row__timer.is-on'), 'visibility')).toBe('visible');
    });

    it('the empty due date keeps its place; only its icon waits for the pointer or the keyboard', () => {
        const css = styleOf(HOME);
        expect(row('.hc-row__date-icon', 'opacity')).toBe('0');
        expect(css).toMatch(/\.hc-row:hover \.hc-row__date-icon,[^{]*\.hc-row:focus-within \.hc-row__date-icon[^{]*\{[^}]*opacity:\s*1/);
        expect(blocksOf(css, '@media (hover: none)')).toMatch(/\.hc-row__date-icon\s*\{[^}]*opacity:\s*1/);
    });

    it('a narrow card folds the row instead of cutting the title', () => {
        const css = styleOf(HOME);
        expect(value(HOME, '.hc-mywork', 'container')).toBe('hc-mywork / inline-size');
        const narrow = blocksOf(css, '@container hc-mywork (max-width: 360px)');
        expect(declaration(ruleBody(narrow, '.hc-row'), 'flex-wrap')).toBe('wrap');
        expect(declaration(ruleBody(narrow, '.hc-row__title'), 'flex-basis')).toMatch(/^calc\(100% - /);
        expect(declaration(ruleBody(narrow, '.hc-row__tail'), 'flex-basis')).toBe('100%');
    });

    it('folded, the title line is a full target on a phone without pushing the second line away', () => {
        const narrow = blocksOf(styleOf(HOME), '@container hc-mywork (max-width: 360px)');
        expect(declaration(ruleBody(narrow, '.hc-row__title'), 'min-height')).toBe('var(--hit-min)');
        const lift = declaration(ruleBody(narrow, '.hc-row__tail'), 'margin-top');
        expect(compute(lift, ROOT)).toBe('0px');
        expect(compute(lift, PHONE)).toBe('-8px');
    });

    const task = (extra = {}) => ({ _id: 't1', TaskName: 'Launch-day runbook, rollback plan and owner sign-off', Task_Priority: 'HIGH', ...extra });
    const mountRow = (props = {}) => mount(TaskRow, { props: { task: task(), projectName: 'AlianHub Platform', ...props }, global: { stubs: { ShellIcon: true } } });

    it('the whole title is in the tooltip', () => {
        expect(mountRow().find('.hc-row__title').attributes('title')).toBe(task().TaskName);
    });

    it('the project is a chip with its full name in a tooltip, after the title', () => {
        const wrapper = mountRow();
        const chip = wrapper.find('.hc-row__tail .hc-row__project');
        expect(chip.text()).toBe('AlianHub Platform');
        expect(chip.attributes('title')).toBe('AlianHub Platform');
        expect(wrapper.find('.hc-row').element.children[1].classList.contains('hc-row__title')).toBe(true);
    });

    it('an empty due date is the icon action the List uses, named for assistive tech, not a line of text', async () => {
        const wrapper = mountRow();
        const button = wrapper.find('button.hc-row__date');
        expect(button.exists()).toBe(true);
        expect(button.text()).toBe('');
        expect(button.attributes('aria-label')).toBe('List.cell_set');
        expect(button.attributes('title')).toBe('List.cell_set');
        expect(wrapper.text()).not.toContain('Home.set_date');
        await button.trigger('click');
        expect(wrapper.emitted('set-date')).toHaveLength(1);
    });

    it('a due date is plain meta text', () => {
        const wrapper = mountRow({ task: task({ DueDate: new Date(Date.now() + 5 * 864e5).toISOString() }) });
        expect(wrapper.find('.hc-row__date').exists()).toBe(false);
        expect(wrapper.find('.hc-row__meta').exists()).toBe(true);
    });

    it('a group heading is a label with its count as a number', () => {
        const template = templateOf('components/molecules/Home/MyWorkCard.vue');
        expect(template.match(/class="hc-group__count"/g).length).toBeGreaterThanOrEqual(6);
        expect(template).not.toMatch(/\}\} · \{\{ (groups\.|work\.)/);
    });
});

describe('the setup checklist', () => {
    const steps = [
        { key: 'company', label: 'Home.step_company', done: true },
        { key: 'invite', label: 'Home.step_invite', cta: 'Home.invite_team', done: false },
        { key: 'permissions', label: 'Home.step_permissions', note: 'Home.step_permissions_note', done: false },
    ];
    const mountChecklist = () => mount(SetupChecklist, { props: { companyName: 'Acme', steps }, global: { stubs: { ShellIcon: true } } });

    it('shows the progress, the one next step and its action; the rest stays folded', () => {
        const wrapper = mountChecklist();
        expect(wrapper.find('.hc-setup__ring').text()).toBe('1/3');
        expect(wrapper.find('.hc-setup__next').text()).toContain('Home.step_invite');
        expect(wrapper.find('.hc-setup__next').text()).not.toContain('Home.step_permissions');
        expect(wrapper.find('.hc-setup__cta').text()).toBe('Home.invite_team');
        expect(wrapper.find('.hc-setup__steps').exists()).toBe(false);
        expect(wrapper.find('s').exists()).toBe(false);
        const toggle = wrapper.find('button.hc-setup__toggle');
        expect(toggle.attributes('aria-expanded')).toBe('false');
        expect(toggle.attributes('aria-controls')).toBe('hc-setup-steps');
    });

    it('opens to the full list, where a done step is marked and a later one can be started', async () => {
        const wrapper = mountChecklist();
        await wrapper.find('.hc-setup__toggle').trigger('click');
        expect(wrapper.find('.hc-setup__toggle').attributes('aria-expanded')).toBe('true');
        const items = wrapper.findAll('#hc-setup-steps .hc-setup__step');
        expect(items).toHaveLength(3);
        expect(items[0].classes()).toContain('is-done');
        expect(items[1].classes()).toContain('is-active');
        expect(wrapper.find('s').exists()).toBe(false);
        await items[2].find('button').trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['permissions']);
    });

    it('the action still starts the next step', async () => {
        const wrapper = mountChecklist();
        await wrapper.find('.hc-setup__cta').trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['invite']);
    });

    it('reads from the card tokens', () => {
        expect(value(HOME, '.hc-setup', 'padding')).toContain('var(--card-pad-y, 14px)');
        expect(value(HOME, '.hc-setup', 'border-radius')).toContain('var(--r-lg, 12px)');
        expect(value(HOME, '.hc-setup__next', 'font')).toContain('var(--fs-md');
        expect(value(HOME, '.hc-setup__toggle', 'font')).toContain('var(--fs-sm');
        expect(value(HOME, '.hc-setup__step', 'font')).toContain('var(--fs-md');
    });
});

describe('Home cards and the top line', () => {
    it('every card head is one control tall, so titles and their buttons share a line', () => {
        expect(value(HOME, '.hc-card__head', 'min-height')).toBe('var(--control-h, 0px)');
        expect(value(HOME, '.hp-panel__head', 'min-height')).toBe('var(--control-h, 0px)');
    });

    it.each([
        ['components/molecules/Home/AssignedCommentsCard.vue', '.hc-assigned__hide'],
        ['components/molecules/Home/RecentsCard.vue', '.hrec__hide'],
        ['components/molecules/Home/StandupCard.vue', '.hstand__tool'],
        ['components/molecules/Home/WaitingOnYouCard.vue', '.hwait__hide'],
    ])('%s: the head button is that control', (rel, selector) => {
        expect(value(rel, selector, 'width')).toBe('var(--control-h, 26px)');
        expect(value(rel, selector, 'height')).toBe('var(--control-h, 26px)');
    });

    it('the planner panel starts on the line the cards start on', () => {
        expect(value(HOME, '.ah-page__content', 'padding')).toMatch(/^var\(--page-pad-y, 20px\) /);
        expect(value(HOME, '.hp-panel', 'padding')).toMatch(/^var\(--page-pad-y, 16px\) /);
    });

    it('on a phone the toolbar is taller than its buttons, which are all one height', () => {
        const phone = phoneOf(styleOf(HOME_VIEW));
        expect(declaration(ruleBody(phone, '.ah-tbtn'), 'height')).toBe('var(--hit-min)');
        expect(declaration(ruleBody(phone, '.home .ah-toolbar'), 'min-height')).toBe('calc(var(--hit-min) + 2 * var(--sp-3, 6px))');
        expect(declaration(ruleBody(phoneOf(styleOf('components/molecules/Home/HomeCardsMenu.vue')), '.hcm__toggle'), 'width')).toBe('var(--hit-min)');
    });
});

describe('Inbox rows', () => {
    it('sit in the row family of the List', () => {
        expect(value(INBOX, '.ibx__card', 'padding')).toBe('calc(var(--cell-pad-y, 9px) + 2px) var(--cell-pad-x, 13px)');
        expect(value(INBOX, '.ibx__head', 'min-height')).toBe('calc(var(--row-h) - 2 * var(--cell-pad-y))');
        expect(value(INBOX, '.ibx__avatar', 'width')).toBe('var(--avatar-size)');
        expect(value(INBOX, '.ibx__glyph', 'width')).toBe('var(--avatar-size)');
        expect(value(INBOX, '.ibx__card', 'border-radius')).toBe('var(--r-lg, 10px)');
        expect(value(INBOX, '.ibx__actions .ah-btn--sm', 'height')).toBe('var(--control-h, 28px)');
        expect(templateOf(INBOX)).toMatch(/<UserProfile[^>]*width="var\(--avatar-size\)"/);
    });

    it('compact is tighter than the default', () => {
        const parts = (map) => [parseFloat(compute(value(INBOX, '.ibx__card', 'padding'), map)), px(INBOX, '.ibx', 'font-size', map), px(INBOX, '.ibx__avatar', 'width', map), px(INBOX, '.ibx__head', 'min-height', map)];
        const comfortable = parts(ROOT);
        const compact = parts(COMPACT);
        compact.forEach((size, i) => expect(size).toBeLessThanOrEqual(comfortable[i]));
        expect(compact.slice(0, 3).every((size, i) => size < comfortable[i])).toBe(true);
        expect(compact[3]).toBeGreaterThanOrEqual(24);
    });

    it('the density is set on the page root, where the compact tokens apply', () => {
        const template = templateOf(INBOX);
        expect(template).toMatch(/<div class="ah-page ibx" :data-density="density"/);
        expect(template).toMatch(/<ViewDensityControl :model-value="density" @update:model-value="setDensity" \/>/);
    });

    describe('the chosen density', () => {
        beforeEach(() => localStorage.clear());

        it('is comfortable until one is chosen', () => {
            expect(loadInboxDensity()).toBe('comfortable');
        });

        it('is kept for the next visit', () => {
            saveInboxDensity('compact');
            expect(localStorage.getItem(DENSITY_KEY)).toBe('compact');
            expect(loadInboxDensity()).toBe('compact');
        });

        it('ignores a value it does not know', () => {
            localStorage.setItem(DENSITY_KEY, 'huge');
            expect(loadInboxDensity()).toBe('comfortable');
            saveInboxDensity('huge');
            expect(localStorage.getItem(DENSITY_KEY)).toBe('comfortable');
        });
    });

    it('nothing in a row changes size or appears under the pointer', () => {
        const css = styleOf(INBOX);
        const hover = [...css.matchAll(/([^{}]*:hover[^{}]*)\{([^{}]*)\}/g)].map((m) => m[2]).join(';');
        expect(hover).not.toMatch(/(^|[;\s])(display|padding|margin|height|width|border-width|font(-size|-weight)?)\s*:/);
        expect(value(INBOX, '.ibx__card', 'border-left')).toBe('3px solid transparent');
    });

    it('the unread marker and the undo bar take their colours from tokens', () => {
        expect(value(INBOX, '.ibx__card.is-agent', 'border-left-color')).toBe('var(--agent)');
        expect(value(INBOX, '.ibx__undo', 'color')).toBe('var(--rail-ink-strong)');
        expect(value(INBOX, '.ibx__undo-btn', 'color')).toBe('var(--rail-brand)');
    });

    it('the empty state is on the scale', () => {
        expect(value(INBOX, '.ibx__zero-title', 'font')).toBe('var(--fw-title, 600) var(--fs-lg, 15px)/var(--lh-snug, 1.3) var(--font-ui)');
        expect(value(INBOX, '.ibx__zero-sub', 'font-size')).toBe('var(--fs-md, 12.5px)');
        expect(value(INBOX, '.ibx__zero-mark', 'border-radius')).toBe('50%');
    });
});

describe('the Docs hub', () => {
    it('list rows are List rows', () => {
        expect(value(HUB, '.hub__row', 'min-height')).toBe('var(--row-h)');
        expect(value(HUB, '.hub__row', 'box-sizing')).toBe('border-box');
        expect(value(HUB, '.hub__row', 'padding')).toBe('var(--cell-pad-y) var(--cell-pad-x, 14px)');
        expect(value(HUB, '.hub__wiki-row', 'padding')).toBe('calc(var(--cell-pad-y, 9px) + 2px) var(--cell-pad-x, 14px)');
        expect(read(HUB)).toMatch(/paddingLeft: `calc\(var\(--cell-pad-x, 14px\) \+ \$\{\(page\.depth \|\| 0\)\} \* var\(--row-indent\)\)`/);
    });

    it('section headers, the search field and the cards are on tokens', () => {
        expect(value(HUB, '.hub__section-head', 'min-height')).toBe('var(--control-h, 30px)');
        expect(value(HUB, '.hub__search .hub__search-input', 'height')).toBe('var(--control-h-lg, 32px)');
        expect(value(HUB, '.hub__search .hub__search-input', 'font-size')).toBe('var(--fs-md, 12.5px)');
        expect(value(HUB, '.hub__content', 'padding')).toBe('var(--page-pad-y, 20px) var(--page-pad-x, 24px) calc(2 * var(--page-pad-y, 20px))');
        expect(value(HUB, '.hub__content', 'gap')).toBe('var(--gap-stack, 16px)');
        expect(value(HUB, '.hub__card', 'padding')).toBe('var(--card-pad-y, 12px) var(--card-pad-x, 14px)');
        expect(value(HUB, '.hub__item', 'min-height')).toBe('var(--control-h, 0px)');
        expect(value(HUB, '.hub__view-select', 'height')).toBe('var(--control-h, 30px)');
        expect(value(HUB, '.hub__blank', 'border')).toBe('1.5px dashed var(--brand-border)');
    });

    it('the side lists of the hub and the Inbox are one pattern', () => {
        ['padding', 'gap', 'font-size'].forEach((property) => {
            expect(value(HUB, '.hub__side', property), property).toBe(value(INBOX, '.ibx__side', property));
        });
        expect(value(HUB, '.hub__side', 'padding')).toBe('var(--sp-6, 14px) var(--sp-4, 10px)');
        expect(value(HUB, '.hub__item', 'border-radius')).toBe(value(INBOX, '.ibx__navitem', 'border-radius'));
        expect(value(HUB, '.hub__item', 'padding')).toBe(value(INBOX, '.ibx__navitem', 'padding'));
    });
});

describe('the classic look still computes the sizes these rules had', () => {
    it.each([
        [HOME, '.hc-group', 'font', '600 10.5px/1.2 var(--font-ui)'],
        [HOME, '.hc-group', 'min-height', '0px'],
        [HOME, '.hs-label', 'font', '600 10px/1.2 var(--font-ui)'],
        [HOME, '.hc-group__sort', 'font', '500 10.5px/1.2 var(--font-ui)'],
        [HOME, '.hc-row', 'gap', '10px'],
        [HOME, '.hc-row', 'min-height', '24px'],
        [HOME, '.hc-row__meta', 'font', '400 10.5px/1 var(--font-ui)'],
        [HOME, '.ah-toolbar__date', 'font', '500 11px/1 var(--font-ui)'],
        [HOME, '.hc-card__head', 'min-height', '0px'],
        [HOME, '.hc-setup', 'padding', '14px 18px'],
        [HOME, '.hc-setup__title', 'font', '600 13.5px/1.3 var(--font-ui)'],
        [HOME, '.hp-panel', 'padding', '16px 18px'],
        [HOME, '.hp-days', 'font', '500 10.5px/1 var(--font-ui)'],
        [HOME, '.hc-timer__label', 'font', '500 10px/1.2 var(--font-ui)'],

        [INBOX, '.ibx', 'font-size', '12.5px'],
        [INBOX, '.ibx__side', 'padding', '14px 10px'],
        [INBOX, '.ibx__side', 'font-size', '13px'],
        [INBOX, '.ibx__navitem', 'font', '500 13px/1.3 var(--font-ui)'],
        [INBOX, '.ibx__navitem', 'border-radius', '7px'],
        [INBOX, '.ibx__side-foot', 'font-size', '11.5px'],
        [HOME, '.ah-page .ah-toolbar__title', 'font-size', '14px'],
        [INBOX, '.ibx__toolbar .ah-toolbar__title', 'font', '600 14px/1.2 var(--font-ui)'],
        [INBOX, '.ibx__tab', 'font', '500 12.5px/1 var(--font-ui)'],
        [INBOX, '.ibx__markall', 'font', '600 12px/1 var(--font-ui)'],
        [INBOX, '.ibx__keys', 'font-size', '10.5px'],
        [INBOX, '.ibx__list', 'padding', '12px 14px 20px'],
        [INBOX, '.ibx__list', 'gap', '8px'],
        [INBOX, '.ibx__card', 'padding', '11px 13px'],
        [INBOX, '.ibx__card', 'gap', '7px'],
        [INBOX, '.ibx__card', 'border-radius', '10px'],
        [INBOX, '.ibx__when', 'font', '400 10px/1 var(--font-ui)'],
        [INBOX, '.ibx__target', 'font', '400 10.5px/1 var(--font-ui)'],
        [INBOX, '.ibx__agent', 'font-size', '8.5px'],
        [INBOX, '.ibx__actions .ah-btn--sm', 'height', '28px'],
        [INBOX, '.ibx__actions .ah-btn--sm', 'padding', '0 10px'],
        [INBOX, '.ibx__actions .ah-btn--sm', 'font-size', '11.5px'],
        [INBOX, '.ibx__reply-input', 'font-size', '12.5px'],
        [INBOX, '.ibx__zero-title', 'font', '600 15px/1.3 var(--font-ui)'],
        [INBOX, '.ibx__foot', 'font-size', '11.5px'],
        [INBOX, '.ibx__snooze-hint', 'font', '400 11px/1.2 var(--font-ui)'],
        [INBOX, '.ibx__undo', 'font-size', '12.5px'],
        [INBOX, '.ibx__undo', 'min-height', '33px'],
        [INBOX, '.ibx__undo-btn', 'font', '600 12.5px/1 var(--font-ui)'],

        [HUB, '.hub__side', 'padding', '14px 10px'],
        [HUB, '.hub__side', 'font-size', '13px'],
        [HUB, '.hub__search .hub__search-input', 'height', '32px'],
        [HUB, '.hub__search .hub__search-input', 'font-size', '12.5px'],
        [HUB, '.hub__item', 'font', '400 13px/1.3 var(--font-ui)'],
        [HUB, '.hub__item', 'border-radius', '7px'],
        [HUB, '.hub__item-count', 'font', '500 11px/1 var(--font-mono)'],
        [HUB, '.ah-page.hub .ah-toolbar__title', 'font', '600 14px/1.2 var(--font-ui)'],
        [HUB, '.hub__view-select', 'height', '30px'],
        [HUB, '.hub__view-select', 'font', '500 12.5px/1 var(--font-ui)'],
        [HUB, '.hub__content', 'padding', '20px 24px 40px'],
        [HUB, '.hub__content', 'gap', '16px'],
        [HUB, '.hub__section-head', 'min-height', '30px'],
        [HUB, '.hub__grid', 'gap', '10px'],
        [HUB, '.hub__card', 'padding', '12px 14px'],
        [HUB, '.hub__card-title', 'font', '600 13px/1.3 var(--font-ui)'],
        [HUB, '.hub__card-excerpt', 'font', '400 11.5px/1.45 var(--font-ui)'],
        [HUB, '.hub__tag', 'font-size', '8.5px'],
        [HUB, '.hub__when', 'font', '400 10.5px/1.2 var(--font-ui)'],
        [HUB, '.hub__row', 'padding', '9px 14px'],
        [HUB, '.hub__row', 'font', '400 12.5px/1.3 var(--font-ui)'],
        [HUB, '.hub__row-time', 'font', '400 10.5px/1.2 var(--font-ui)'],
        [HUB, '.hub__wiki-row', 'padding', '11px 14px'],
        [HUB, '.hub__wiki-row', 'font-size', '12.5px'],
        [HUB, '.hub__wiki-state', 'font', '600 11.5px/1.2 var(--font-ui)'],
        [HUB, '.hub__tpl-cta', 'font', '600 12px/1.2 var(--font-ui)'],
        [HUB, '.hub__blank', 'font', '600 12.5px/1.2 var(--font-ui)'],
        [HUB, '.hub__empty', 'padding', '22px'],
    ])('%s %s { %s } is %s', (rel, selector, property, former) => {
        expect(compute(value(rel, selector, property), CLASSIC)).toBe(former);
    });

    it('no rule reads a token the classic look un-sets without carrying a fallback', () => {
        const unset = Object.keys(CLASSIC).filter((name) => CLASSIC[name] === 'initial');
        expect(unset.length).toBeGreaterThan(15);
        STYLED.forEach((rel) => {
            const css = styleOf(rel);
            expect(unset.filter((name) => new RegExp(`var\\(\\s*${name}\\s*\\)`).test(css)), rel).toEqual([]);
        });
    });
});

/* axe's target-size rule (WCAG 2.5.8), which the e2e accessibility suite runs: a control is at
   least 24 by 24 px, or its centre is at least 12px from the nearest edge of every other control. */
describe('the controls keep a 24px target', () => {
    const FLOOR = 24;

    it('--hit-min is the floor, and 40px on a phone', () => {
        expect(parseFloat(ROOT['--hit-min'])).toBeGreaterThanOrEqual(FLOOR);
        expect(parseFloat(PHONE['--hit-min'])).toBe(40);
    });

    it.each([
        [HOME, '.hc-group__sort', 'min-height'],
        [HOME, '.hc-row__act', 'width'],
        [HOME, '.hc-row__act', 'height'],
        [HOME, '.hc-row', 'min-height'],
        [HOME, '.hc-tab', 'min-height'],
        [HOME, '.hc-agenda__nav button', 'min-width'],
        [HOME, '.hc-agenda__nav button', 'min-height'],
        [HOME, '.hc-setup__toggle', 'min-height'],
        [HOME, '.hc-setup__dismiss', 'min-height'],
        [HOME, '.hc-setup__step button', 'min-height'],
        [HOME, '.hc-setup__cta', 'height'],
        [HOME, '.hp-panel__close', 'width'],
        [HOME, '.hp-panel__close', 'height'],
        [HOME, '.hp-days button', 'min-height'],
        [HOME, '.hc-personal__open', 'height'],
        ['components/molecules/Home/AssignedCommentsCard.vue', '.hc-assigned__hide', 'width'],
        ['components/molecules/Home/RecentsCard.vue', '.hrec__hide', 'height'],
        ['components/molecules/Home/RecentsCard.vue', '.hrec__retry', 'min-height'],
        ['components/molecules/Home/StandupCard.vue', '.hstand__tool', 'width'],
        ['components/molecules/Home/StandupCard.vue', '.hstand__task', 'min-height'],
        ['components/molecules/Home/WaitingOnYouCard.vue', '.hwait__hide', 'width'],
        ['components/molecules/Home/WaitingOnYouCard.vue', '.hwait__inbox', 'min-height'],
        [INBOX, '.ibx__navitem', 'min-height'],
        [INBOX, '.ibx__tab', 'min-height'],
        [INBOX, '.ibx__markall', 'min-height'],
        [INBOX, '.ibx__actions .ah-btn--sm', 'height'],
        [INBOX, '.ibx__undo-btn', 'min-height'],
        [HUB, '.hub__item', 'min-height'],
        [HUB, '.hub__view-select', 'height'],
        [HUB, '.hub__row', 'min-height'],
        [HUB, '.hub__wiki-page', 'min-height'],
    ])('%s %s { %s } is 24px or more', (rel, selector, property) => {
        expect(px(rel, selector, property)).toBeGreaterThanOrEqual(FLOOR);
    });

    it('the task checkbox stays small, with its centre 12px or more from the title beside it', () => {
        const box = px(HOME, '.hc-row__check', 'width');
        expect(box / 2 + px(HOME, '.hc-row', 'gap')).toBeGreaterThanOrEqual(FLOOR / 2);
    });

    it.each([
        [HOME, '.hc-group__sort', 'min-height'],
        [HOME, '.hc-tab', 'min-height'],
        [HOME, '.hc-agenda__nav button', 'min-height'],
        [HOME, '.hp-days button', 'min-height'],
        [HOME, '.hc-setup__toggle', 'min-height'],
        [HOME, '.hc-setup__step button', 'min-height'],
        [HOME, '.hc-add, .hc-connect, .hc-personal__open', 'min-height'],
        [INBOX, '.ibx__tab', 'min-height'],
        [INBOX, '.ibx__markall', 'min-height'],
        [INBOX, '.ibx__undo-btn', 'min-height'],
        [INBOX, '.ibx__actions .ah-btn--sm', 'height'],
        [HUB, '.hub__view-select', 'height'],
        [HUB, '.hub__row', 'min-height'],
        [HUB, '.hub__wiki-btn', 'width'],
        [HUB, '.hub__wiki-btn', 'height'],
        [HUB, '.hub .ah-btn--sm', 'min-height'],
        [INBOX, '.ibx .ah-btn--sm', 'min-height'],
        ['components/molecules/Home/AssignedCommentsCard.vue', '.hc-assigned__resolve', 'min-height'],
        ['components/molecules/Home/StandupCard.vue', '.hstand__state .ah-btn--sm', 'min-height'],
    ])('on a phone %s %s { %s } reaches --hit-min', (rel, selector, property) => {
        const css = styleOf(rel);
        const set = declaration(ruleBody(phoneOf(css), selector), property) || declaration(ruleBody(withoutMedia(css), selector), property);
        const size = parseFloat(compute(set, PHONE));
        expect(size, `${selector} { ${property}: ${set} }`).toBeGreaterThanOrEqual(parseFloat(PHONE['--hit-min']));
    });
});
