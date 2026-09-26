import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(css|scss|vue)$/.test(entry.name) ? [full] : [];
});

describe('global element styles', () => {
    test('no stylesheet styles every <nav> by its tag', () => {
        const bareNav = /(^|[\s,}])nav(\s+a[^{,]*)?\s*\{/m;
        const offenders = walk(SRC).filter((file) => bareNav.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(SRC, file));
        expect(offenders).toEqual([]);
    });

    test('the starter template green active-link colour is gone', () => {
        expect(read('App.vue')).not.toMatch(/#42b983/i);
    });
});

describe('the "available, not enabled" app teaser', () => {
    const css = read('components/molecules/AppTeaserBlock/style.css');

    test('stays inside its column: width 100% includes its padding and border', () => {
        const rule = ruleBody(css, '.app-teaser-banner');
        expect(rule).toMatch(/width:\s*100%/);
        expect(rule).toMatch(/box-sizing:\s*border-box/);
    });
});

describe('Settings → Instance → Knowledge on a phone', () => {
    const vue = read('views/Settings/Instance/InstanceKnowledge.vue');
    const scoped = vue.slice(vue.indexOf('<style scoped>'));

    test('a workspace card head wraps instead of pushing its button off screen', () => {
        expect(ruleBody(scoped, '.in-card__head')).toMatch(/flex-wrap:\s*wrap/);
        expect(ruleBody(scoped, '.in-card__title')).toMatch(/overflow-wrap:\s*anywhere/);
        expect(ruleBody(scoped, '.in-card__title')).toMatch(/flex:\s*1 1 160px/);
    });
});

describe('project header icons in dark mode', () => {
    test('the voice-notes icon has no white tile of its own', () => {
        expect(read('assets/images/svg/Voice_Record.svg')).not.toMatch(/fill="white"|fill="#fff(fff)?"/i);
    });

    test('the watchers button border follows the theme', () => {
        const css = read('views/Projects/components/project-header.css');
        expect(ruleBody(css, '.ph2 .open__watcher')).toMatch(/border-color:\s*var\(--border\)/);
    });
});

describe('the calendar controls in the project toolbar', () => {
    const css = read('views/Projects/components/project-filters.css');

    test('the month title beats the legacy !important grey', () => {
        expect(ruleBody(css, '.pft .monthly-calendar-view')).toMatch(/color:\s*var\(--ink\)\s*!important/);
    });

    test('on a phone the filter pill is sized by its content, not a percentage', () => {
        const phone = css.slice(css.indexOf('@media (max-width: 767px)'));
        const rule = ruleBody(phone, '.pft .top-filter-section');
        expect(rule).toMatch(/box-sizing:\s*border-box/);
        expect(rule).toMatch(/width:\s*auto/);
        expect(rule).toMatch(/min-width:\s*40px/);
    });

    test('the previous and next chevrons have no white disc', () => {
        expect(ruleBody(css, '.pft .calendar-button .fc-icon::before')).toMatch(/background:\s*transparent/);
    });
});

describe('the project calendar layout', () => {
    test('stacks its bar over the grid even though Chat shares the .ah-page.cv root', () => {
        const tokens = read('assets/css/tokens.css');
        expect(tokens).toMatch(/\.ah-page\.cv[,\s]/);
        const css = read('views/Projects/ProjectCalendarView/style.css');
        expect(ruleBody(css, '.ah-page.cv')).toMatch(/flex-direction:\s*column/);
        expect(read('views/Projects/ProjectCalendarView/CalendarViewComponent.vue')).toMatch(/<style scoped src="\.\/style\.css">/);
    });
});

describe('the project calendar card in dark mode', () => {
    test('the legacy white sprint card takes the dark surface when it holds the calendar', () => {
        const css = read('assets/css/tokens.css');
        expect(ruleBody(css, ':root[data-theme="dark"] .ah-page .sprint:has(.cv)')).toMatch(/background-color:\s*var\(--surface\)/);
    });
});

describe('keyframe animations under prefers-reduced-motion', () => {
    const tokens = read('assets/css/tokens.css');

    const reduceBlocks = () => {
        const blocks = [];
        let at = tokens.indexOf('@media (prefers-reduced-motion: reduce)');
        while (at !== -1) {
            let depth = 0;
            let end = tokens.indexOf('{', at);
            for (; end < tokens.length; end += 1) {
                if (tokens[end] === '{') depth += 1;
                if (tokens[end] === '}' && --depth === 0) break;
            }
            blocks.push(tokens.slice(at, end + 1));
            at = tokens.indexOf('@media (prefers-reduced-motion: reduce)', end);
        }
        return blocks.join('\n');
    };

    const splitTopLevel = (list) => {
        const parts = [];
        let depth = 0;
        let start = 0;
        [...list].forEach((ch, i) => {
            if (ch === '(') depth += 1;
            if (ch === ')') depth -= 1;
            if (ch === ',' && depth === 0) {
                parts.push(list.slice(start, i).trim());
                start = i + 1;
            }
        });
        parts.push(list.slice(start).trim());
        return parts;
    };

    const animationRule = () => {
        const match = /([^{}]+)\{([^{}]*animation-duration[^{}]*)\}/.exec(reduceBlocks());
        return match ? { selectors: splitTopLevel(match[1].replace(/\/\*[\s\S]*?\*\//g, '')), body: match[2] } : null;
    };

    const stopped = (html) => {
        const rule = animationRule();
        if (!rule) return false;
        const host = document.createElement('div');
        host.innerHTML = html;
        const el = host.querySelector('[data-probe]') || host.firstElementChild;
        const elementSelector = rule.selectors.filter((s) => !s.includes('::')).join(', ');
        return el.matches(elementSelector);
    };

    test('shimmers and pulses end at once, on elements and their ::before and ::after', () => {
        const rule = animationRule();
        expect(rule).not.toBeNull();
        expect(rule.body).toMatch(/animation-duration:\s*\.01ms\s*!important/);
        expect(rule.body).toMatch(/animation-iteration-count:\s*1\s*!important/);
        expect(rule.selectors.some((s) => s.endsWith('::before'))).toBe(true);
        expect(rule.selectors.some((s) => s.endsWith('::after'))).toBe(true);
    });

    test.each([
        '<div class="cskel-shimmer"></div>',
        '<div class="skelaton-loader"></div>',
        '<div class="skeleton-bar"></div>',
        '<div class="plm-skel"></div>',
        '<div class="lwc-skel"></div>',
        '<span class="lwc-dot"></span>',
        '<div class="ppm-skel"></div>',
        '<div class="prc-skel"></div>',
        '<div class="ubc-skel"></div>',
        '<div class="cw__skeleton-line"></div>',
        '<div class="pd-skeleton"></div>',
        '<span class="ah-agent-strip__pulse"></span>',
        '<span class="mt-banner__dot"></span>',
        '<span class="ewr-running-badge"></span>',
        '<span class="ttt__rec-live"></span>',
        '<span class="clip__dot"></span>',
    ])('%s stops', (html) => {
        expect(stopped(html)).toBe(true);
    });

    test.each([
        '<span class="ah-spin"></span>',
        '<div class="auth__spinner"></div>',
        '<span class="oauth-spinner"></span>',
        '<span class="ttt__spinner"></span>',
        '<span class="pal__spin"></span>',
        '<span class="ah-off__spinner is-spinning"></span>',
        '<div class="spinner"></div>',
        '<span class="custom-spinner"></span>',
        '<span class="ai-estimate-spinner"></span>',
        '<span class="aitc__orb"></span>',
        '<button class="ah-summary__refresh"></button>',
        '<div class="custom-loader"><div class="loaderBar" data-probe></div></div>',
        '<div class="loader"><div class="bar1" data-probe></div></div>',
    ])('%s keeps turning, since a frozen spinner reads as stuck', (html) => {
        expect(stopped(html)).toBe(false);
    });

    test('transitions stay near-instant as before', () => {
        expect(reduceBlocks()).toMatch(/transition-duration:\s*\.01ms\s*!important/);
    });
});

describe('legacy blocks inside the task panel in dark mode', () => {
    const css = read('components/organisms/TaskDetailOverlay/style.css');
    const dark = (selector) => ruleBody(css, `:root[data-theme="dark"] .ah-detail__panel ${selector}`);

    test.each([
        ['.black', /color:\s*var\(--ink\)/],
        ['.blue', /color:\s*var\(--brand\)/],
        ['.add_description_button', /background:\s*var\(--surface-2\)/],
        ['.app-teaser-banner__title', /color:\s*var\(--ink\)/],
        ['.app-teaser-banner__cta', /color:\s*var\(--brand\)/],
    ])('%s takes its colour from the theme tokens', (selector, expected) => {
        expect(dark(selector)).toMatch(expected);
    });
});

describe('radio inputs that use .ah-check', () => {
    const tokens = read('assets/css/tokens.css');

    test('are drawn round, not as a square box', () => {
        expect(ruleBody(tokens, '.ah-check[type="radio"]')).toMatch(/border-radius:\s*50%/);
    });

    test('show a centre dot when checked instead of the tick', () => {
        const dot = ruleBody(tokens, '.ah-check[type="radio"]:checked::after');
        expect(dot).toMatch(/border-radius:\s*50%/);
        expect(dot).toMatch(/background:\s*var\(--on-brand\)/);
        expect(dot).toMatch(/border:\s*0/);
        expect(dot).toMatch(/transform:\s*none/);
    });

    test('checkboxes keep their square box and tick', () => {
        expect(ruleBody(tokens, '.ah-check')).toMatch(/border-radius:\s*4px/);
        expect(ruleBody(tokens, '.ah-check:checked::after')).toMatch(/transform:\s*rotate\(-45deg\)/);
    });
});
