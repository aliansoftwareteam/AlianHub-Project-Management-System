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

describe('buttons rendered as links', () => {
    test('.ah-btn and .ah-tbtn drop the link underline', () => {
        expect(ruleBody(read('assets/css/tokens.css'), '.ah-btn')).toMatch(/text-decoration:\s*none/);
        expect(ruleBody(read('components/molecules/Home/style.css'), '.ah-tbtn')).toMatch(/text-decoration:\s*none/);
    });
});

describe('Planner', () => {
    const css = read('views/Planner/style.css');

    test('the unscheduled tray is never hidden: it lives in the sidebar the toggle opens', () => {
        expect(css).not.toMatch(/\.planner__tray\s*\{\s*display:\s*none/);
    });

    test('the week range buttons drop the browser button chrome', () => {
        const rule = ruleBody(css, '.planner__range button');
        expect(rule).toMatch(/border:\s*0/);
        expect(rule).toMatch(/background:\s*transparent/);
    });
});

describe('Settings → Custom fields', () => {
    const css = read('plugins/customFieldView/component/organisms/FieldBuilder/style.css');

    test('the builder grid out-specifies .ah-page, so the editor sits beside the list', () => {
        expect(ruleBody(css, '.ah-page.fb')).toMatch(/display:\s*grid/);
        expect(css).not.toMatch(/(^|\s)\.fb\s*\{/m);
    });
});

describe('Settings → Templates in dark mode', () => {
    test('the dark tab tint leaves the active tab on the brand colour', () => {
        const css = read('views/Settings/Template/style.css');
        expect(css).toMatch(/:root\[data-theme="dark"\] \.tp__tab:not\(\.is-active\)\s*\{/);
        expect(css).not.toMatch(/:root\[data-theme="dark"\] \.tp__tab\s*\{/);
    });
});

describe('Settings → Time off and SCIM cards', () => {
    const styles = (rel) => { const vue = read(rel); return vue.slice(vue.indexOf('<style')); };

    test('the white cards carry dark ink, so dark mode does not put light text on them', () => {
        expect(ruleBody(styles('views/Settings/TimeOff/TimeOff.vue'), '.pto-card')).toMatch(/color:\s*#17161c/);
        expect(ruleBody(styles('views/Settings/Scim/ScimSettings.vue'), '.scim-card')).toMatch(/color:\s*#17161c/);
    });

    test('hints and empty text drop the 2.6:1 grey', () => {
        expect(read('views/Settings/TimeOff/TimeOff.vue')).not.toMatch(/#9aa0b4/i);
        expect(read('views/Settings/Scim/ScimSettings.vue')).not.toMatch(/#9aa0b4/i);
    });
});

describe('Settings → Time tracking', () => {
    const vue = read('views/Settings/TimeTracking/TimeTracking.vue');
    const css = read('views/Settings/TimeTracking/style.css');

    test('with no published build it says so instead of an empty green download bar', () => {
        expect(vue).toMatch(/v-if="loaded && !dataobj\.length"[^>]*>\{\{ \$t\('TimeTracker\.no_builds'\) \}\}/);
        expect(vue).toMatch(/v-if="dataobj\.length" class="d-flex justify-content-center download-lable-wapper"/);
    });

    test('the headline and lead follow the theme', () => {
        expect(ruleBody(css, '.timetracking-head h1')).toMatch(/color:\s*var\(--brand\)/);
        expect(ruleBody(css, '.timetracking-head p')).toMatch(/color:\s*var\(--ink-2\)/);
    });
});

describe('Settings → General in dark mode', () => {
    const css = read('components/molecules/Setting/style.css');

    test('section headings on the canvas follow the theme', () => {
        expect(ruleBody(css, 'h2.task_priority_wrapper_value')).toMatch(/color:\s*var\(--ink\)/);
    });

    test('the white sections keep dark ink for the text they inherit', () => {
        expect(ruleBody(css, '.mySettingSection')).toMatch(/color:\s*#17161c/);
    });
});

describe('Project and Tracker timesheets', () => {
    const files = ['views/Timesheet/ProjectTimesheet/ProjectTimesheet.vue', 'views/Timesheet/TrackerTimeSheet/TrackerTimesheet.vue'];

    test.each(files)('%s: the title strip holds the view tabs and follows the theme', (rel) => {
        const vue = read(rel);
        const scoped = vue.slice(vue.indexOf('<style scoped>'));
        expect(ruleBody(scoped, '.page-title')).toMatch(/background-color:\s*var\(--surface\)/);
        expect(ruleBody(scoped, '.ts-legacy-tabs')).toMatch(/align-self:\s*stretch/);
        expect(ruleBody(scoped, 'ul.breadcrumb.title_strip')).toMatch(/background-color:\s*transparent/);
    });
});

describe('Docs hub', () => {
    const vue = read('views/Pages/PagesSpace.vue');
    const phone = vue.slice(vue.indexOf('@media (max-width: 767px)'));

    test('the search padding out-specifies .ah-input, so the placeholder clears the icon', () => {
        expect(ruleBody(vue, '.hub__search .hub__search-input')).toMatch(/padding-left:\s*30px/);
    });

    test('on a phone the wiki button keeps only its icon, so New doc stays on screen', () => {
        expect(vue).toMatch(/hub__wiki-btn"[^>]*:aria-label="\$t\('Docs\.new_wiki_page'\)"/);
        expect(ruleBody(phone, '.hub__btn-label')).toMatch(/display:\s*none/);
    });
});
