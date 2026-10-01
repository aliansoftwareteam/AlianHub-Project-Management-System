import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as chipColors from '@/utils/statusChipColors';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const styles = (rel) => { const vue = read(rel); return vue.slice(vue.indexOf('<style')); };
const template = (rel) => { const vue = read(rel); return vue.slice(0, vue.indexOf('<script')); };
const withoutScript = (source) => source.replace(/<script[\s\S]*?<\/script>/g, '');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};

const COLOUR_DECLARATION = /(?:^|[;{\s"'`(])(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke)\s*:\s*([^;}]*)/gi;
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:white|black|red|blue|aliceblue|lightgr[ae]y)\b/i;
const hardCodedColours = (source) => {
    const found = [];
    source.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(COLOUR_DECLARATION)) {
            if (LITERAL.test(match[1].replace(/var\([^)]*\)/g, ''))) found.push(`${index + 1}: ${line.trim()}`);
        }
    });
    return found;
};

const PANEL_SOURCES = [
    'components/organisms/TaskDetailRightSide/style.css',
    'components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue',
    'components/molecules/TaskDetailAction/style.css',
    'components/molecules/Pages/LinkedDocs.vue',
    'components/molecules/Epics/EpicPicker.vue',
    'components/molecules/EstimateHours/EstimateHours.vue',
    'components/molecules/EstimateHours/style.css',
    'components/molecules/EstimateHourTable/EstimateHourTable.vue',
    'components/molecules/EstimateHourTable/style.css',
    'components/molecules/EstimatedTimeInput/EstimatedTimeInput.vue',
    'plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue',
    'plugins/customFieldView/component/atom/customFieldTaskView/dropdownComponentListing.vue',
];

describe('the task panel paints from tokens', () => {
    test.each(PANEL_SOURCES)('%s has no hard-coded colour', (rel) => {
        expect(hardCodedColours(withoutScript(read(rel)))).toEqual([]);
    });

    test.each(PANEL_SOURCES.filter((rel) => rel.endsWith('.vue')))('%s has no white utility block', (rel) => {
        expect(template(rel)).not.toMatch(/\bbg-white\b/);
    });

    test('custom field rows take label, value and border colours from tokens', () => {
        const css = read('plugins/customFieldView/component/atom/customFieldTaskView/customFieldListing/style.css');
        const panelRules = css.split('}').filter((rule) => /\.formkit__content-wrapper(?!-project-detail)/.test(rule.split('{')[0]));
        expect(panelRules.length).toBeGreaterThan(3);
        expect(hardCodedColours(panelRules.join('}\n'))).toEqual([]);
        expect(ruleBody(css, '.formkit__content-wrapper label.formkit-label')).toMatch(/color:\s*var\(--ink-2\)/);
        expect(ruleBody(css, '.formkit__content-wrapper')).toMatch(/border-bottom:\s*1px solid var\(--hairline\)/);
    });

    test('the date placeholder in a custom field row is not a fixed grey', () => {
        const css = styles('plugins/customFieldView/component/atom/customFieldTaskView/dateComponentListing.vue');
        expect(ruleBody(css, '.formkit__content-wrapper input::placeholder')).toMatch(/color:\s*var\(--ink-2\)/);
    });

    test('the watcher count and the header buttons use theme fills', () => {
        const css = read('components/molecules/TaskDetailAction/style.css');
        const badge = ruleBody(css, '.task-detail-action .watcher-action .watcher-count');
        expect(badge).toMatch(/background-color:\s*var\(--fill\)/);
        expect(badge).toMatch(/color:\s*var\(--ink\)/);
    });
});

describe('a dropdown option chip stays readable on a dark surface', () => {
    const luminance = (rgb) => {
        const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };
    const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const DARK_SURFACE = [29, 29, 34];
    const LIGHT_SURFACE = [247, 246, 243];
    const tinted = (hex, surface) => rgbOf(hex).map((c, i) => c * 0.21 + surface[i] * 0.79);
    // The option colour a new dropdown field starts with, then the picker's other stock colours.
    const OPTION_COLOURS = ['#34495E', '#000000', '#2F3990', '#C1121F', '#FF8600', '#1CB303', '#7B68EE', '#074354', '#FFFFFF'];

    test.each(OPTION_COLOURS)('%s reads at 4.5:1 or better in both themes', (color) => {
        const style = chipColors.optionChipStyle({ color });
        expect(contrast(rgbOf(style['--status-ink-dark']), tinted(color, DARK_SURFACE))).toBeGreaterThanOrEqual(4.5);
        const light = /var\(--status-ink, (#[0-9a-f]{6})\)/.exec(style.color)[1];
        expect(contrast(rgbOf(light), tinted(color, LIGHT_SURFACE))).toBeGreaterThanOrEqual(4.5);
    });

    test('an option without a colour falls back to the plain chip', () => {
        expect(chipColors.optionChipStyle({ label: 'Launch' })).toEqual({});
    });

    test('the task panel dropdown row draws its chip with the helper', () => {
        const vue = read('plugins/customFieldView/component/atom/customFieldTaskView/dropdownComponentListing.vue');
        expect(vue).toMatch(/optionChipStyle\(item\)/);
        expect(vue).toMatch(/'ah-status-ink':\s*!props\.isProjectDetail/);
        expect(vue).not.toMatch(/item\.color \+ '20'/);
    });
});

describe('the Add Task Planning sidebar follows the theme', () => {
    const vue = read('components/molecules/EstimateHours/EstimateHours.vue');
    const css = read('components/molecules/EstimateHours/style.css');

    test('both sidebars carry the class the dark rules hang on', () => {
        expect(vue.match(/className="estimate-sidebar"/g) || []).toHaveLength(2);
    });

    test('the legacy sidebar chrome is repainted from tokens', () => {
        expect(css).toMatch(/\.estimate-sidebar \.sidebar-content[^{]*\{[^}]*background(-color)?:\s*var\(--surface\)/);
        expect(css).toMatch(/\.estimate-sidebar \.sidebar-head[^{]*\{[^}]*border-(bottom-)?color:\s*var\(--hairline\)/);
        expect(css).toMatch(/:root\[data-theme="dark"\] \.estimate-sidebar[^{]*\{[^}]*color-scheme:\s*dark/);
    });

    test('the header actions are shared buttons', () => {
        expect(vue).not.toMatch(/class="(outline-primary|btn-primary|btn-secondary)\b/);
        expect(vue).toMatch(/class="ah-btn ah-btn--primary ah-btn--sm"/);
    });
});

describe('native controls follow the theme', () => {
    const tokens = read('assets/css/tokens.css');
    const block = (selector) => {
        const start = tokens.indexOf(`${selector} {`);
        return start === -1 ? '' : tokens.slice(start, tokens.indexOf('}', start));
    };

    test('each theme root names its colour scheme', () => {
        expect(block(':root')).toMatch(/color-scheme:\s*light;/);
        expect(block(':root[data-theme="dark"]')).toMatch(/color-scheme:\s*dark;/);
    });

    test('surfaces that stay white in dark keep light controls, redesigned ones inside opt back in', () => {
        const light = /:root\[data-theme="dark"\] \.ah-app__view,[^{]*\{[^}]*color-scheme:\s*light/.exec(tokens);
        expect(light).not.toBeNull();
        for (const host of ['#my-sidebar', '#my-modal', '#my-dropdown', '.bg-white', '.pto-card', '.scim-card']) expect(light[0]).toContain(host);
        const dark = /:root\[data-theme="dark"\] \.ah-app__view \.ah-page,[^{]*\{[^}]*color-scheme:\s*dark/.exec(tokens);
        expect(dark).not.toBeNull();
        for (const surface of ['.lt--page', '.pev', '.chg', '.pal-layer']) expect(dark[0]).toContain(surface);
    });

    test('no input re-declares a scheme that follows the operating system instead of the app theme', () => {
        for (const rel of ['components/organisms/QuickCreateTask/QuickCreateTask.vue', 'views/Inbox/Inbox.vue']) {
            expect(styles(rel)).not.toMatch(/color-scheme:\s*light dark/);
        }
    });
});

describe('Home cards', () => {
    test('the calendar connect link cannot be wider than its card', () => {
        const rule = ruleBody(read('components/molecules/Home/style.css'), '.hc-connect');
        expect(rule).toMatch(/width:\s*100%/);
        expect(rule).toMatch(/box-sizing:\s*border-box/);
    });

    test('the Assigned comments title keeps pushing its hide button to the right edge', () => {
        const title = ruleBody(styles('components/molecules/Home/AssignedCommentsCard.vue'), '.hc-assigned__title');
        expect(title).toMatch(/margin:\s*0 auto 0 0/);
    });
});

describe('a doc page', () => {
    const css = styles('components/molecules/Pages/PageDocument.vue');

    test('starts the title, the meta row and the body on one left edge', () => {
        expect(css).toMatch(/--pd-gutter:\s*60px/);
        expect(css).toMatch(/\.pd--page \.pd__head\s*\{[^}]*padding-left:\s*var\(--pd-gutter\)/);
        expect(css).toMatch(/\.pd--page \.pd__body\s*\{[^}]*padding-left:\s*0/);
        expect(css).toMatch(/\.pd--page \.pd__body :deep\(\.ce-block__content\)[^{]*\{[^}]*margin-left:\s*var\(--pd-gutter\)/);
        expect(css).toMatch(/\.pd--page \.pd__preview\s*\{[^}]*padding-left:\s*var\(--pd-gutter\)/);
    });
});

describe('the create project dialog in dark', () => {
    const css = read('components/organisms/CreateProject/style.css');

    test.each(['.ah-cp__form .source-select .source-select__field', '.ah-cp__form .skills-select .skills-select__chips--field'])('%s sits on the surface', (selector) => {
        expect(css).toContain(selector);
        const rule = css.slice(css.indexOf(selector));
        expect(rule.slice(0, rule.indexOf('}'))).toMatch(/background:\s*var\(--surface\)/);
    });

    test('the picked source and skill chips take theme ink', () => {
        expect(ruleBody(css, '.ah-cp__form .source-select .source-select__value')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.ah-cp__form .skills-select .skills-select__chip')).toMatch(/color:\s*var\(--brand\)/);
    });
});

describe('the task panel in both themes', () => {
    const sheets = [
        read('components/organisms/TaskDetailRightSide/style.css'),
        read('components/molecules/EstimateHours/style.css'),
        read('components/organisms/TaskDetailOverlay/style.css'),
    ];
    const tags = [];
    let root;
    const style = (selector) => getComputedStyle(root.querySelector(selector));

    beforeAll(() => {
        for (const css of sheets) {
            const tag = document.createElement('style');
            tag.textContent = css;
            document.head.appendChild(tag);
            tags.push(tag);
        }
        root = document.createElement('div');
        root.innerHTML = `
            <aside class="ah-detail__props">
                <div class="task-detail-right-side"><div>
                    <div class="task-detail-right-side-label"><div class="task-detail-field-name">Created by</div>
                        <div><span class="task-created-by font-size-13">Local PM</span></div></div>
                    <div class="task-detail-right-side-label"><div class="task-detail-field-name">Priority</div>
                        <div class="priority-comp taskdetail-label"><span class="priority-name">High</span></div></div>
                    <div class="task-detail-right-side-label"><div class="task-detail-field-name">Story Points</div>
                        <div class="story-points taskdetail-label"><button class="sp-trigger"><span class="sp-chip">3</span></button></div></div>
                    <div class="task-detail-right-side-label"><div class="task-detail-field-name">Due Date</div>
                        <div class="due-date taskdetail-label"><input class="date_format_cal calendar-comp"></div></div>
                    <div class="task-detail-right-side-label ah-repeat"><div class="task-detail-field-name">Repeat</div>
                        <button class="ah-repeat__summary">Doesn't repeat</button></div>
                    <div class="task-detail-right-side-label"><div class="task-detail-field-name">Estimated</div>
                        <div class="estimated-with-ai"><div class="time-display">00h 00m</div><button class="ai-estimate-btn">Suggest</button></div></div>
                    <div class="task-detail-right-side-label"><div class="task-detail-field-name">Task Planning</div>
                        <div class="taskdetail-label"><span class="task-esitmate-hours">00h 00m</span></div></div>
                    <div class="task-detail-right-side-label"><div class="task-detail-field-name">Remaining</div>
                        <div class="remaining-estimate-text">00h 00m</div></div>
                    <div class="task-detail-right-side-label"><div class="task-detail-field-name">Start Date</div>
                        <span class="task-detail-empty">Empty</span></div>
                </div></div>
                <div class="ah-detail__prop"><span class="ah-detail__prop-label">Sprint</span><button type="button" class="ah-detail__prop-link">List</button></div>
            </aside>
            <div class="ah-detail__pane">
                <span class="linked-docs__title">Linked Docs</span>
                <span class="epic-picker__label">Epics</span>
                <h3 class="custom-field__title">Custom Field</h3>
                <h3 class="checklist-main__title">Checklist</h3>
                <button class="ah-btn ah-btn--ghost ah-btn--sm">+ New page</button>
                <button class="ah-detail__quick-btn">Add subtask</button>
                <span class="checklist-main__suggest">Suggest Checklists</span>
            </div>`;
        document.body.appendChild(root);
    });
    afterAll(() => {
        root.remove();
        tags.forEach((tag) => tag.remove());
    });

    test('every property value is set in the row size', () => {
        const values = ['.task-created-by', '.priority-comp.taskdetail-label', '.story-points', '.calendar-comp', '.ah-repeat__summary', '.time-display', '.task-esitmate-hours', '.remaining-estimate-text', '.task-detail-empty'];
        expect(style('.ah-detail__props').fontSize).toBe('var(--row-font)');
        for (const selector of values) expect(`${selector} ${style(selector).fontSize}`).toBe(`${selector} var(--row-font)`);
    });

    test('values start at the label edge: no pill padding pushes one in or out', () => {
        expect(style('.ah-repeat__summary').marginLeft).toBe('-8px');
        expect(style('.time-display').marginLeft).toBe('-8px');
        expect(style('.task-esitmate-hours').marginLeft).toBe('-8px');
        expect(style('.ai-estimate-btn').marginLeft).toBe('-6px');
        expect(parseFloat(style('.task-created-by').paddingLeft) || 0).toBe(0);
        expect(parseFloat(style('.task-detail-empty').paddingLeft) || 0).toBe(0);
    });

    test('the property values take theme ink, not black', () => {
        const css = sheets[0];
        expect(ruleBody(css, '.taskdetail-label')).toMatch(/color:\s*var\(--ink\)/);
    });

    test('section headings share one size', () => {
        const sizes = ['.linked-docs__title', '.epic-picker__label', '.custom-field__title', '.checklist-main__title'].map((selector) => style(selector).fontSize);
        expect(new Set(sizes).size).toBe(1);
        expect(sizes[0]).toBe('var(--fs-lg, 14px)');
    });

    test('section actions share the ghost button', () => {
        const ghost = style('.ah-btn--ghost');
        const quick = style('.ah-detail__quick-btn');
        expect(ghost.fontSize).toBe(quick.fontSize);
        expect(ghost.height).toBe(quick.height);
        expect(style('.checklist-main__suggest').textDecoration).toMatch(/none/);
    });

    test('Linked Docs, Epics and Custom Field offer their actions as buttons, not underlined links', () => {
        for (const rel of [
            'components/molecules/Pages/LinkedDocs.vue',
            'components/molecules/Epics/EpicPicker.vue',
            'plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue',
        ]) {
            const html = template(rel);
            expect(html).not.toMatch(/text-decoration-underline/);
            expect(html).toMatch(/<button[^>]*class="ah-btn ah-btn--ghost ah-btn--sm/);
        }
    });
});
