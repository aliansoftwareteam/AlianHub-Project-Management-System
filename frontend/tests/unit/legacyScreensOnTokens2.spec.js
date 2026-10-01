import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const exists = (rel) => fs.existsSync(path.join(SRC, rel));
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
const templateOf = (vue) => vue.slice(vue.indexOf('<template>'), vue.lastIndexOf('</template>'));
const stylesOf = (rel) => {
    const text = read(rel);
    if (rel.endsWith('.css')) return withoutComments(text);
    return withoutComments([...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'));
};
const declarations = (css) => [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).join('\n');
const classValues = (template) => [...template.matchAll(/[\s<]:?class="([^"]*)"/g)].map((m) => m[1]).join('\n');
const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i;
const LEGACY_CLASS = /(?<![\w-])(bg-white|bg-light-gray|bg-lightgray|bg-black|bg-blue|black|white|blue|red|gray|gray81|dark-gray|GunPowder|color47|btn-white|outline-primary|outline-secondary|btn-secondary|form-control|font-size-\d+|font-weight-\d+)(?![\w-])/;

/* Colours of other companies' marks are theirs, not the theme's. */
const BRAND_MARKS = /#4a154b|#5865f2/gi;

const TIMESHEET_VIEWS = [
    'views/Timesheet/ProjectTimesheet/ProjectTimesheet.vue',
    'views/Timesheet/TrackerTimeSheet/TrackerTimesheet.vue',
    'components/atom/TimesheetView/ProjectTimeSheetView/ProjectTimesheetView.vue',
    'components/atom/TimesheetView/ProjectTimeSheetView/ProjectTimesheetTrComponent.vue',
    'components/atom/TimesheetView/TrackerTimeSheetView/ScreenshotTime.vue',
    'components/atom/TimesheetView/TrackerTimeSheetView/TimebarComponent.vue',
];
const CARD_VIEWS = [
    'components/molecules/TalkToText/TalkToTextPopover.vue',
    'components/molecules/SprintScrum/SprintSetupModal.vue',
    'components/organisms/MetricSummaryCard/MetricSummaryCard.vue',
    'views/Integrations/IntegrationsHub.vue',
];
const SHARED_VIEWS = [
    'components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue',
    'components/atom/ProjectSettingSidebar/ProjectSettingSidebar.vue',
];
const SETTINGS_VIEWS = [
    'views/Settings/Integrations/Integrations.vue',
    'views/Settings/Instance/InstanceShell.vue',
    'views/Settings/Instance/InstanceAgents.vue',
    'views/Settings/Instance/MaintenanceBanner.vue',
];
const SHEETS = [
    'views/Timesheet/style.css',
    'components/atom/TimesheetView/style.css',
    'components/atom/TimesheetView/TrackerTimeSheetView/ScreenshotTime.css',
    'components/atom/TimesheetView/TrackerTimeSheetView/TimebarComponent.css',
    'components/molecules/Select/style.css',
    'components/molecules/ConfirmationSidebar/style.css',
    'views/Settings/settingsShell.css',
];

describe('batch 2: screens and shared pieces moved onto the design tokens', () => {
    test.each([...TIMESHEET_VIEWS, ...CARD_VIEWS, ...SHARED_VIEWS, ...SETTINGS_VIEWS, ...SHEETS])('%s paints no colour that is not a token', (rel) => {
        expect(declarations(stylesOf(rel)).replace(BRAND_MARKS, '')).not.toMatch(COLOUR_LITERAL);
    });

    test.each([...TIMESHEET_VIEWS, ...CARD_VIEWS, ...SHARED_VIEWS])('%s has no colour literal and no legacy colour or type class in its template', (rel) => {
        const template = withoutComments(templateOf(read(rel)));
        expect(template).not.toMatch(COLOUR_LITERAL);
        expect(classValues(template)).not.toMatch(LEGACY_CLASS);
    });

    test.each([...TIMESHEET_VIEWS, ...CARD_VIEWS, ...SHARED_VIEWS, ...SETTINGS_VIEWS, ...SHEETS])('%s never uses the 40%% ink for text', (rel) => {
        expect(declarations(stylesOf(rel))).not.toMatch(/(^|[;\s])color:\s*var\(--ink-3\)/);
    });
});

describe('legacy timesheets', () => {
    test('the dark override sheet is gone and nothing imports it', () => {
        expect(exists('views/Timesheet/legacyTimesheetTheme.css')).toBe(false);
        for (const rel of TIMESHEET_VIEWS) expect(read(rel), rel).not.toMatch(/legacyTimesheetTheme/);
    });

    test.each(['views/Timesheet/ProjectTimesheet/ProjectTimesheet.vue', 'views/Timesheet/TrackerTimeSheet/TrackerTimesheet.vue'])('%s opts into the theme and uses the themed filter menu', (rel) => {
        const template = templateOf(read(rel));
        expect(template).toMatch(/class="ah-page timesheet_view /);
        expect(template).toMatch(/<DropDown [^>]*\bthemed\b/);
    });

    test('the table head, foot, sticky column and today marker sit on opaque token surfaces', () => {
        for (const rel of ['views/Timesheet/style.css', 'components/atom/TimesheetView/style.css']) {
            const css = stylesOf(rel);
            expect(ruleBody(css, 'table.table.timesheet_table thead,table.table.timesheet_table th'), rel).toMatch(/background:\s*linear-gradient\(var\(--fill\), var\(--fill\)\) var\(--surface-2\)\s*!important/);
            expect(ruleBody(css, 'table.table.timesheet_table tr th.current_date'), rel).toMatch(/background:\s*var\(--brand\)\s*!important/);
            expect(ruleBody(css, 'table.table.timesheet_table tr th.current_date'), rel).toMatch(/color:\s*var\(--on-brand\)\s*!important/);
            expect(ruleBody(css, '.timesheet_table_wrapper'), rel).toMatch(/overflow:\s*auto/);
        }
    });

    test('arrows drawn for a white page are masks that take the text colour', () => {
        const tracker = templateOf(read('views/Timesheet/TrackerTimeSheet/TrackerTimesheet.vue'));
        expect(tracker).not.toMatch(/rectangle_(left|right)Arrow\.png"/);
        expect(tracker.match(/class="ah-mask-icon"/g).length).toBeGreaterThanOrEqual(2);
    });
});

describe('shared pickers', () => {
    test('Select takes a themed prop, as DropDown does, and the milestone header turns it on', () => {
        const vue = read('components/molecules/Select/Select.vue');
        expect(vue).toMatch(/themed:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/);
        expect(templateOf(vue)).toMatch(/'sel-tokens': themed/);
        const css = stylesOf('components/molecules/Select/style.css');
        expect(ruleBody(css, '.sel-tokens .select-option-value')).toMatch(/background:\s*var\(--surface\)/);
        expect(ruleBody(css, '.sel-tokens .custom-select-options')).toMatch(/color:\s*var\(--ink\)/);
        expect(templateOf(read('components/atom/MilestoneReportThead/MilestoneReportThead.vue')).match(/<SelectComp\s+themed/g)).toHaveLength(2);
        expect(stylesOf('views/MilestoneReport/MilestoneReport.css')).not.toMatch(/\.days-selected-dropdown \.select-option-value/);
    });

    test('the confirmation sidebar is a token surface with shared buttons', () => {
        const template = templateOf(read('components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue'));
        expect(template).toMatch(/class="ah-btn ah-btn--secondary"/);
        const css = stylesOf('components/molecules/ConfirmationSidebar/style.css');
        expect(ruleBody(css, '.conformation__sidebar-component')).toMatch(/background:\s*var\(--canvas\)/);
        expect(ruleBody(css, '.conformation__sidebar-component')).toMatch(/color-scheme:\s*var\(--scheme, light\)/);
        expect(ruleBody(css, '.archive-delete-title')).toMatch(/color:\s*var\(--ink\)/);
    });
});

describe('settings stragglers and backdrops', () => {
    const tokens = withoutComments(read('assets/css/tokens.css'));

    test('dialog backdrops have a token', () => {
        expect(tokens).toMatch(/--scrim:\s*rgba\(0, 0, 0, \.35\);/);
        expect(ruleBody(stylesOf('views/Settings/settingsShell.css'), '.st__scrim')).toMatch(/background:\s*var\(--scrim\)/);
        expect(stylesOf('components/molecules/SprintScrum/SprintSetupModal.vue')).toMatch(/background:\s*var\(--scrim\)/);
    });

    test('instance pages read tokens that exist, without a hex fallback', () => {
        expect(stylesOf('views/Settings/Instance/InstanceAgents.vue')).not.toMatch(/var\(--accent/);
        expect(ruleBody(stylesOf('views/Settings/Instance/InstanceShell.vue'), '.in-pre')).toMatch(/color:\s*var\(--rail-ink-strong\)/);
        expect(ruleBody(stylesOf('views/Settings/Instance/MaintenanceBanner.vue'), '.mt-banner')).toMatch(/background:\s*var\(--warn-bg\);/);
    });
});

describe('primitives in tokens.css', () => {
    const tokens = withoutComments(read('assets/css/tokens.css'));

    test('the hover, danger, dark, tabs and scrollbar primitives read tokens and keep the former value as the fallback', () => {
        expect(ruleBody(tokens, '.ah-btn--outline:hover:not(:disabled)')).toMatch(/background:\s*var\(--brand-ring, rgba\(47, 57, 144, \.16\)\)/);
        expect(ruleBody(tokens, '.ah-btn--danger')).toMatch(/color:\s*var\(--on-danger, #fff\)/);
        expect(ruleBody(tokens, '.ah-btn--dark')).toMatch(/color:\s*var\(--rail-ink-strong, #fff\)/);
        expect(ruleBody(tokens, '.ah-tabs')).toMatch(/background:\s*var\(--track, rgba\(0, 0, 0, \.05\)\)/);
        expect(tokens).not.toMatch(/:root\[data-theme="dark"\] \.ah-tabs/);
        expect(ruleBody(tokens, '.ah-scroll')).toMatch(/scrollbar-color:\s*var\(--border, rgba\(0, 0, 0, \.18\)\) transparent/);
    });

    test('white on the danger button reads in both themes', () => {
        expect(tokens).toMatch(/--on-danger:\s*#ffffff;/);
        expect(/:root\[data-theme="dark"\] \{[^}]*--on-danger:\s*#111114;/.test(tokens)).toBe(true);
    });
});

describe('icons drawn from files become masks', () => {
    test('the milestone filter icon, the project card star and required views, and the pagination arrows', () => {
        expect(stylesOf('views/MilestoneReport/MilestoneReport.css')).not.toMatch(/background-image:\s*url\(/);
        const card = templateOf(read('components/molecules/ProjectsListingSetting/ProjectsListingSetting.vue'));
        expect(card).not.toMatch(/<img/);
        expect(card).toMatch(/class="ah-mask-icon pls__star"/);
        expect(card).toMatch(/class="ah-mask-icon erp_app"/);
        const page = templateOf(read('views/Settings/Projects/Projects.vue'));
        expect(page).not.toMatch(/(left|right)_arrow\.svg"/);
        expect(page.match(/class="ah-mask-icon pg__arrow/g).length).toBeGreaterThanOrEqual(4);
    });
});
