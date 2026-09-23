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

    test('the previous and next chevrons have no white disc', () => {
        expect(ruleBody(css, '.pft .calendar-button .fc-icon::before')).toMatch(/background:\s*transparent/);
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
