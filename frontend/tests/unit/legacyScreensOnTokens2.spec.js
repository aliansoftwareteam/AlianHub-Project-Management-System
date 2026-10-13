import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const exists = (rel) => fs.existsSync(path.join(SRC, rel));
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/&#\d+;/g, '');
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
            expect(css, rel).toMatch(/table\.table\.timesheet_table tr th\.current_date[^{]*\{\s*background:\s*var\(--brand\)\s*!important;\s*color:\s*var\(--on-brand\)\s*!important/);
            expect(ruleBody(css, '.timesheet_table_wrapper'), rel).toMatch(/overflow:\s*auto/);
        }
    });

    test('arrows drawn for a white page are masks that take the text colour', () => {
        const tracker = templateOf(read('views/Timesheet/TrackerTimeSheet/TrackerTimesheet.vue'));
        expect(tracker).not.toMatch(/rectangle_(left|right)Arrow\.png"/);
        expect(tracker.match(/class="ah-mask-icon"/g).length).toBeGreaterThanOrEqual(2);
    });
});

describe('timesheet and workload data cells take the row type', () => {
    test('the week grid of My timesheet', () => {
        const css = stylesOf('views/Timesheet/UserTimeSheet/UserTimesheet.vue');
        expect(ruleBody(css, '.ut2-row')).toMatch(/min-height:\s*var\(--row-h\)/);
        expect(ruleBody(css, '.ut2-row')).toMatch(/padding:\s*var\(--cell-pad-y, 10px\) var\(--cell-pad-x, 14px\)/);
        expect(ruleBody(css, '.ut2-row')).toMatch(/font:\s*500 var\(--row-font, 12px\)\/1\.2 var\(--font-mono\)/);
        expect(css).toMatch(/\n\.ut2-task \{[^}]*font:\s*400 var\(--row-font, 12\.5px\)\/1\.3 var\(--font-ui\)/);
        expect(ruleBody(css, '.ut2-row--head')).toMatch(/font:\s*var\(--text-label\)/);
    });

    test('the workload grid', () => {
        const css = stylesOf('views/Timesheet/WorkloadTimesheet/WorkloadTimesheet.vue');
        expect(ruleBody(css, '.wl__name')).toMatch(/font-size:\s*var\(--row-font, 12\.5px\)/);
        expect(ruleBody(css, '.wl__total')).toMatch(/font:\s*600 var\(--row-font, 12px\)\/1 var\(--font-mono\)/);
        expect(ruleBody(css, '.wl__row--head')).toMatch(/font:\s*var\(--text-label\)/);
        expect(ruleBody(css, '.wl__sub')).toMatch(/font-size:\s*11px/);
    });

    test('the project timesheet table', () => {
        for (const rel of ['views/Timesheet/style.css', 'components/atom/TimesheetView/style.css']) {
            expect(stylesOf(rel).match(/font-size:\s*var\(--row-font, 13px\)/g), rel).toHaveLength(2);
        }
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

    test('the project settings sidebar is a themed sidebar and restates the shared forms\' colours on its own panel', () => {
        const vue = read('components/atom/ProjectSettingSidebar/ProjectSettingSidebar.vue');
        const template = templateOf(vue);
        expect(template).toMatch(/<Sidebar themed /);
        expect(template).toMatch(/class="ah-btn ah-btn--secondary ah-btn--sm mr-010"/);
        expect(template).toMatch(/class="ah-btn ah-btn--primary ah-btn--sm"/);
        expect(classValues(template)).not.toMatch(LEGACY_CLASS);
        const css = stylesOf('components/atom/ProjectSettingSidebar/ProjectSettingSidebar.vue');
        expect(declarations(css)).not.toMatch(COLOUR_LITERAL);
        expect(ruleBody(css, '.pss__setting-panel')).toMatch(/--tsf-selected:\s*var\(--brand\);\s*background:\s*var\(--surface\)/);
        expect(css).toMatch(/\.pss__setting-panel :is\(\.task-heading-desktop, \.task-heading-mobile, \.taskstatustitle-desktop, \.taskstatustitle-mobile\) \{ color: var\(--ink\) !important; \}/);
        expect(ruleBody(css, '.pss__setting-panel .form-control')).toMatch(/background:\s*var\(--surface\) !important;\s*color:\s*var\(--ink\) !important/);
    });

    test('the template picker marks the chosen template with a class a themed host can recolour', () => {
        const vue = read('components/molecules/TemplateSelectForm/TemplateSelectForm.vue');
        expect(templateOf(vue)).toMatch(/'is-selected': isSelected\(tempVal\)/);
        expect(templateOf(vue)).not.toMatch(/:style="isSelected/);
        expect(vue).toMatch(/\.templated_name\.is-selected \{\s*color: var\(--tsf-selected, #3845B3\) !important;/);
    });

    test('the confirmation sidebar is a token surface with shared buttons', () => {
        const template = templateOf(read('components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue'));
        expect(template).toMatch(/<Sidebar themed /);
        expect(template).toMatch(/class="ah-btn ah-btn--secondary"/);
        const css = stylesOf('components/molecules/ConfirmationSidebar/style.css');
        expect(ruleBody(css, '.conformation__sidebar-component')).toMatch(/background:\s*var\(--canvas\)/);
        expect(ruleBody(css, '.conformation__sidebar-component')).toMatch(/color-scheme:\s*var\(--scheme\)/);
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
        expect(card.match(/class="ah-mask-icon erp_app /g)).toHaveLength(2);
        const page = templateOf(read('views/Settings/Projects/Projects.vue'));
        expect(page).not.toMatch(/(left|right)_arrow\.svg"/);
        expect(page.match(/class="ah-mask-icon pg__arrow/g).length).toBeGreaterThanOrEqual(4);
    });
});
