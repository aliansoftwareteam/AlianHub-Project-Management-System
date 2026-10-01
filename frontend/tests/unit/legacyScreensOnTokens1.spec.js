import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test, vi } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
const templateOf = (vue) => vue.slice(vue.indexOf('<template>'), vue.lastIndexOf('</template>'));
const scriptOf = (vue) => (/<script[^>]*>([\s\S]*?)<\/script>/.exec(vue) || ['', ''])[1];
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
const LEGACY_CLASS = /(?<![\w-])(bg-white|bg-light-gray|bg-lightgray|bg-black|black|white|blue|gray81|dark-gray|GunPowder|lightGrey|lightGreyColor|light-purple|btn-white|outline-primary|outline-secondary|form-control|font-size-\d+|font-weight-\d+)(?![\w-])/;

const VIEWS = [
    'views/MilestoneReport/MilestoneReport.vue',
    'components/atom/MilestoneReportThead/MilestoneReportThead.vue',
    'components/atom/MilestoneReportTbody/MilestoneReportTbody.vue',
    'components/atom/MilestoneReportTbodyProject/MilestoneReportTbodyProject.vue',
    'components/atom/MilestoneReportTbodyMilestone/MilestoneReportTbodyMilestone.vue',
    'components/atom/MilestoneTotal/MilestoneTotal.vue',
    'views/VarianceReport/VarianceReport.vue',
    'views/CapacityPlanning/CapacityPlanning.vue',
    'views/CustomReports/CustomReports.vue',
    'views/Settings/TimeOff/TimeOff.vue',
    'views/Settings/Scim/ScimSettings.vue',
    'views/Settings/AgentClients/AgentClients.vue',
    'components/molecules/ProjectsListingSetting/ProjectsListingSetting.vue',
];
const SHEETS = [
    'views/MilestoneReport/MilestoneReport.css',
    'views/Timesheet/timeV2.css',
    'components/molecules/ProjectsListingSetting/style.css',
    'views/Settings/Projects/style.css',
];

describe('screens moved onto the design tokens', () => {
    test.each([...VIEWS, ...SHEETS])('%s paints no colour that is not a token', (rel) => {
        expect(declarations(stylesOf(rel))).not.toMatch(COLOUR_LITERAL);
    });

    test.each(VIEWS)('%s has no colour literal and no legacy colour or type class in its template', (rel) => {
        const template = withoutComments(templateOf(read(rel)));
        expect(template).not.toMatch(COLOUR_LITERAL);
        expect(classValues(template)).not.toMatch(LEGACY_CLASS);
    });

    test.each(VIEWS)('%s sets no colour literal from its script', (rel) => {
        expect(scriptOf(read(rel)).replace(/\/\/.*$/gm, '')).not.toMatch(/['"`]#[0-9a-f]{3,8}['"`]|\brgba?\(/i);
    });

    test.each([...VIEWS, ...SHEETS])('%s never uses the 40% ink for text', (rel) => {
        expect(declarations(stylesOf(rel))).not.toMatch(/(^|[;\s])color:\s*var\(--ink-3\)/);
    });
});

describe('the dark-mode opt-out list in tokens.css', () => {
    const tokens = withoutComments(read('assets/css/tokens.css'));
    const optOut = /:root\[data-theme="dark"\] \.ah-app__view,[^{]*\{[^}]*color-scheme:\s*light/.exec(tokens);

    test('no longer names the surfaces that now follow the theme', () => {
        expect(optOut).not.toBeNull();
        for (const name of ['.pls__apps', '.pto-card', '.scim-card']) expect(optOut[0]).not.toContain(name);
    });

    test('still names the shared legacy containers of the later slices', () => {
        for (const name of ['.ah-app__view', '#my-sidebar', '#my-modal', '#my-dropdown', '#my-image-slider', '.bg-white', '.swal2-container', 'iframe']) {
            expect(optOut[0]).toContain(name);
        }
    });
});

describe('Settings → Time off', () => {
    const vue = read('views/Settings/TimeOff/TimeOff.vue');
    const template = templateOf(vue);
    const css = stylesOf('views/Settings/TimeOff/TimeOff.vue');

    test('both cards are the shared card and every field is a themed input', () => {
        expect(template.match(/class="ah-card pto-card"/g)).toHaveLength(2);
        const fields = [...template.matchAll(/<(input|select)\b[^>]*>/g)].map((m) => m[0]);
        expect(fields.length).toBeGreaterThanOrEqual(8);
        for (const field of fields) expect(field).toMatch(/class="[^"]*\bah-input\b/);
    });

    test('the card no longer forces light ink, and the status badge takes the status tokens', () => {
        expect(ruleBody(css, '.pto-card')).not.toMatch(/background|color/);
        expect(ruleBody(css, '.pto-badge--pending')).toMatch(/background:\s*var\(--warn-bg\)[^}]*color:\s*var\(--warn-ink\)/);
        expect(ruleBody(css, '.pto-badge--approved')).toMatch(/background:\s*var\(--ok-bg\)[^}]*color:\s*var\(--ok-ink\)/);
        expect(ruleBody(css, '.pto-badge--rejected')).toMatch(/background:\s*var\(--danger-bg\)[^}]*color:\s*var\(--danger-ink\)/);
        expect(template).toMatch(/class="ah-chip pto-badge" :class="`pto-badge--\$\{e\.status\}`"/);
    });

    test('the table head, cells and row lines come from tokens and the table scrolls inside its card', () => {
        expect(ruleBody(css, '.pto-table th')).toMatch(/background:\s*var\(--surface-2\)/);
        expect(ruleBody(css, '.pto-table th')).toMatch(/color:\s*var\(--ink-2\)/);
        expect(ruleBody(css, '.pto-table td')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.pto-table td')).toMatch(/border-bottom:\s*1px solid var\(--hairline\)/);
        expect(ruleBody(css, '.pto-table tbody tr:hover')).toMatch(/background:\s*var\(--surface-hover\)/);
        expect(ruleBody(css, '.pto-table-wrap')).toMatch(/overflow-x:\s*auto/);
    });

    test('sizes read the size tokens with the former pixel value as the fallback', () => {
        expect(ruleBody(css, '.pto')).toMatch(/padding:\s*var\(--page-pad-y, 20px\) var\(--page-pad-x, 20px\)/);
        expect(ruleBody(css, '.pto-table')).toMatch(/font-size:\s*var\(--fs-md, 13px\)/);
        expect(ruleBody(css, '.ah-input.pto-filter')).toMatch(/height:\s*var\(--control-h, 30px\)/);
    });

    test('on a phone the two dates stack and the filters take the row', () => {
        const phone = css.slice(css.indexOf('@media (max-width: 767px)'));
        expect(ruleBody(phone, '.pto-row.two')).toMatch(/flex-direction:\s*column/);
        expect(ruleBody(phone, '.pto-filters')).toMatch(/width:\s*100%/);
    });
});

describe('Settings → SCIM', () => {
    const vue = read('views/Settings/Scim/ScimSettings.vue');
    const template = templateOf(vue);
    const css = stylesOf('views/Settings/Scim/ScimSettings.vue');

    test('the card is the shared card, the switch a themed checkbox and the role a themed input', () => {
        expect(template).toMatch(/class="ah-card scim-card"/);
        expect(template).toMatch(/<input type="checkbox" class="ah-check"/);
        expect(template).toMatch(/<select [^>]*class="ah-input scim-select"/);
        expect(ruleBody(css, '.scim-card')).not.toMatch(/background|color/);
    });

    test('the connection block, the token and the warning take surface and status tokens', () => {
        expect(ruleBody(css, '.scim-urls')).toMatch(/background:\s*var\(--surface-2\)/);
        expect(ruleBody(css, '.scim-url code')).toMatch(/background:\s*var\(--surface\)[^}]*color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.scim-token-warn')).toMatch(/color:\s*var\(--warn-ink\)[^}]*background:\s*var\(--warn-bg\)/);
        expect(ruleBody(css, '.scim-msg--ok')).toMatch(/color:\s*var\(--ok-ink\)/);
        expect(ruleBody(css, '.scim-msg--err')).toMatch(/color:\s*var\(--danger-ink\)/);
    });

    test('its fallback messages are translated', async () => {
        const en = (await import('../../src/locales/en.js')).default;
        expect(en.Scim.saved).toBe('Saved');
        expect(en.Scim.failed).toBe('Failed');
        expect(scriptOf(vue)).not.toMatch(/'Saved'|'Failed'/);
    });
});

describe('Settings → Agent clients', () => {
    test('row lines and errors read tokens that exist', () => {
        const css = stylesOf('views/Settings/AgentClients/AgentClients.vue');
        expect(ruleBody(css, '.ac__row')).toMatch(/border-top:\s*1px solid var\(--hairline\)/);
        expect(ruleBody(css, '.ac__error')).toMatch(/color:\s*var\(--danger-ink\)/);
    });
});

describe('Settings → Projects card and its apps list', () => {
    const vue = read('components/molecules/ProjectsListingSetting/ProjectsListingSetting.vue');
    const template = templateOf(vue);
    const css = stylesOf('components/molecules/ProjectsListingSetting/style.css');

    test('the card is the shared card and the apps list inherits the theme', () => {
        expect(template).toMatch(/<div class="ah-card projectInfoDiv"/);
        expect(css).not.toMatch(/\.pls__apps\s*\{\s*--ink/);
        expect(ruleBody(css, '.projectInfoDiv')).toMatch(/color:\s*var\(--ink\)/);
    });

    test('status chips compute a readable ink per theme', () => {
        expect(template.match(/ah-status-ink/g)).toHaveLength(2);
        expect(template).toMatch(/:style="statusChipStyle\(\{ textColor: statusObj\.textColor, bgColor: statusObj\.backgroundColor \}\)"/);
        expect(template).toMatch(/:style="statusChipStyle\(statusObj\)"/);
        expect(template).not.toMatch(/!important/);
    });

    test('icons drawn from files take the text colour', () => {
        expect(template).toMatch(/class="ah-mask-icon setting__dots"/);
        expect(template).toMatch(/class="ah-mask-icon pls__go-icon"/);
        const apps = read('components/molecules/ProjectAppsList/ProjectAppsList.vue');
        expect(apps).toMatch(/class="ah-mask-icon appl__icon" :class="\{ 'is-on': modelValue\.includes\(app\.key\) \}"/);
        expect(apps).toMatch(/\.appl__icon\.is-on \{ color: var\(--brand\); \}/);
        expect(apps).not.toMatch(/<img/);
    });

    test('labels, dividers and the sharing buttons take tokens', () => {
        expect(ruleBody(css, '.pls__label')).toMatch(/color:\s*var\(--ink-2\)/);
        expect(ruleBody(css, '.p_owner')).toMatch(/border-right:\s*1px solid var\(--border\)/);
        expect(template).toMatch(/'ah-btn--outline': item\.isPrivateSpace === false, 'ah-btn--secondary': item\.isPrivateSpace !== false/);
        expect(ruleBody(css, '.task_type')).toMatch(/background:\s*var\(--fill\)/);
    });

    test('"not available" is translated', async () => {
        const en = (await import('../../src/locales/en.js')).default;
        expect(en.Projects.not_available).toBe('N/A');
        expect(template).not.toMatch(/>\s*N\/A\s*</);
        expect(template).not.toMatch(/'N\/A'/);
    });
});

describe('Milestone report', () => {
    const vue = read('views/MilestoneReport/MilestoneReport.vue');
    const template = templateOf(vue);
    const css = stylesOf('views/MilestoneReport/MilestoneReport.css');

    test('the view opts into the theme and its status menu is the themed panel', () => {
        expect(template).toMatch(/class="ah-page milestone-report-wrapper"/);
        expect(template).toMatch(/<DropDown [^>]*\bthemed\b/);
        expect(ruleBody(css, '.milestone-report-wrapper .product_top_bar')).toMatch(/background-color:\s*var\(--surface\)/);
        expect(ruleBody(css, '.milestone_table_filter_wrapper')).toMatch(/background-color:\s*var\(--canvas\)/);
    });

    test('the black arrow of the year and month select is inverted in dark', () => {
        expect(css).toMatch(/:root\[data-theme="dark"\] \.days-selected-dropdown \.select-option img \{\s*filter: invert\(1\) hue-rotate\(180deg\);/);
    });

    test('the sticky head and the sticky first column sit on opaque token surfaces', () => {
        expect(ruleBody(css, '.milestone-report-wrapper .milestone-report-table tr th')).toMatch(/background:\s*linear-gradient\(var\(--fill\), var\(--fill\)\) var\(--surface-2\)/);
        expect(ruleBody(css, '.milestone-report-wrapper .milestone-report-table tr th')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.milestone-report-wrapper .milestone-report-table tbody td')).toMatch(/background-color:\s*var\(--surface\)/);
        expect(ruleBody(css, '.milestone-report-wrapper .milestone-report-table .mr-row--total td')).toMatch(/background:\s*linear-gradient\(var\(--fill\), var\(--fill\)\) var\(--surface\)/);
        expect(ruleBody(css, '.milestone-report-wrapper .milestone-report-table .mr-row--open td')).toMatch(/background:\s*linear-gradient\(var\(--brand-tint\), var\(--brand-tint\)\) var\(--surface\)/);
    });

    test('today is marked with the brand and the ink that reads on it', () => {
        const body = ruleBody(css, '.milestone-report-wrapper .milestone-report-table .bg-color-highlight');
        expect(body).toMatch(/background:\s*var\(--brand\)\s*!important/);
        expect(body).toMatch(/color:\s*var\(--on-brand\)\s*!important/);
    });

    test('the table scrolls inside its wrapper and the wide first column lets go on a phone', () => {
        expect(ruleBody(css, '.milestone_table_filter_wrapper')).toMatch(/overflow:\s*auto/);
        const phone = css.slice(css.lastIndexOf('@media (max-width:767px)'));
        expect(phone).toMatch(/tr th:first-child,[^{]*tr td:first-child\s*\{[^}]*position:\s*relative/);
    });

    test('row toggles are buttons with a masked arrow, so the arrow shows in either theme', () => {
        for (const rel of ['components/atom/MilestoneReportTbody/MilestoneReportTbody.vue', 'components/atom/MilestoneReportTbodyProject/MilestoneReportTbodyProject.vue', 'components/atom/MilestoneTotal/MilestoneTotal.vue']) {
            const rows = templateOf(read(rel));
            expect(rows, rel).toMatch(/<button type="button" class="mr-toggle"[^>]*:aria-expanded=/);
            expect(rows, rel).toMatch(/class="ah-mask-icon"/);
            expect(rows, rel).not.toMatch(/alt="arrowToogle"/);
        }
    });

    test('milestone status chips compute a readable ink on the status colour', () => {
        for (const rel of ['components/atom/MilestoneReportTbodyMilestone/MilestoneReportTbodyMilestone.vue', 'components/atom/MilestoneTotal/MilestoneTotal.vue']) {
            expect(read(rel), rel).toMatch(/statusChipStyle\(/);
            expect(templateOf(read(rel)), rel).toMatch(/ah-status-ink/);
        }
    });

    test('the empty filter entry is translated', () => {
        expect(scriptOf(vue)).not.toMatch(/no Filter/);
    });
});

describe('Time area helpers shared by variance and capacity', () => {
    const css = stylesOf('views/Timesheet/timeV2.css');

    test('pills, hatching and the dark note read tokens in both themes without a dark override', () => {
        expect(ruleBody(css, '.tv-pill')).toMatch(/background:\s*var\(--fill\)/);
        expect(ruleBody(css, '.tv-dark')).toMatch(/color:\s*var\(--rail-ink-strong\)/);
        expect(ruleBody(css, '.tv-dark .tv-link')).toMatch(/color:\s*var\(--rail-brand\)/);
        expect(css).not.toMatch(/:root\[data-theme="dark"\] \.tv-(pill|hatch)/);
    });

    test('variance and capacity tracks take the track token', () => {
        expect(ruleBody(stylesOf('views/VarianceReport/VarianceReport.vue'), '.vr__track')).toMatch(/background:\s*var\(--track\)/);
        expect(ruleBody(stylesOf('views/CapacityPlanning/CapacityPlanning.vue'), '.cp__track')).toMatch(/background:\s*var\(--track\)/);
    });
});

describe('chart colours come from the tokens', () => {
    afterEach(() => vi.restoreAllMocks());

    const stubTokens = (values) => vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: (name) => values[name] || '' });

    test('readChartTokens resolves the series, label, grid and surface colours of the current theme', async () => {
        const { readChartTokens } = await import('@/utils/chartTokens');
        stubTokens({ '--brand': ' #a892ff', '--ok': '#3ad29f', '--warn': '#d98324', '--agent': '#6b5ce7', '--danger': '#ff7b85', '--ink-2': 'rgba(255, 255, 255, .62)', '--hairline': 'rgba(255, 255, 255, .09)', '--surface': '#18181c' });
        expect(readChartTokens()).toEqual({
            series: ['#a892ff', '#3ad29f', '#d98324', '#6b5ce7', '#ff7b85', 'rgba(255, 255, 255, .62)'],
            ink2: 'rgba(255, 255, 255, .62)',
            grid: 'rgba(255, 255, 255, .09)',
            surface: '#18181c',
        });
    });

    test('a token the build rewrote to another notation is handed over as the rgb() the browser computes', async () => {
        const { readChartTokens } = await import('@/utils/chartTokens');
        vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => (el === document.documentElement
            ? { getPropertyValue: (name) => (name === '--ink-2' ? 'hsla(0,0%,100%,.62)' : '') }
            : { color: 'rgba(255, 255, 255, 0.62)' }));
        expect(readChartTokens().ink2).toBe('rgba(255, 255, 255, 0.62)');
        expect(readChartTokens().surface).toBe('');
        expect(document.documentElement.querySelector('span')).toBeNull();
    });

    test('a chart that uses them is redrawn when the theme or the contrast changes', async () => {
        const { mount } = await import('@vue/test-utils');
        const { useChartTokens } = await import('@/utils/chartTokens');
        const values = { '--brand': '#2F3990' };
        stubTokens(values);
        let tokens;
        const wrapper = mount({ template: '<i />', setup() { tokens = useChartTokens(); } });
        expect(tokens.value.series[0]).toBe('#2F3990');
        values['--brand'] = '#a892ff';
        document.documentElement.setAttribute('data-theme', 'dark');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(tokens.value.series[0]).toBe('#a892ff');
        wrapper.unmount();
        document.documentElement.removeAttribute('data-theme');
    });

    test('the custom report builds its chart options from them', () => {
        const script = scriptOf(read('views/CustomReports/CustomReports.vue'));
        expect(script).toMatch(/const chart = useChartTokens\(\);/);
        expect(script).toMatch(/colors:\s*chart\.value\.series/);
        expect(script).toMatch(/foreColor:\s*chart\.value\.ink2/);
        expect(script).toMatch(/grid:\s*\{\s*borderColor:\s*chart\.value\.grid\s*\}/);
        expect(script).toMatch(/stroke:\s*\{[^}]*colors:\s*cfg\.chartType === 'pie' \? \[chart\.value\.surface\] : undefined/);
    });

    test('axes, legend and tooltip of a report chart are themed by the shared report stylesheet', () => {
        const css = read('views/Projects/Reports/reportsV2.css');
        expect(css).toMatch(/\.apexcharts-xaxis-label[^{]*\{ fill: var\(--ink-2\); \}/);
        expect(css).toMatch(/\.apexcharts-tooltip\.apexcharts-theme-light \{ background: var\(--surface\)/);
        expect(read('views/CustomReports/CustomReports.vue')).toMatch(/<style src="@\/views\/Projects\/Reports\/reportsV2\.css"><\/style>/);
    });
});
