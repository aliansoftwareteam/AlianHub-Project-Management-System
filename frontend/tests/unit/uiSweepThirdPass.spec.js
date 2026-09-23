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

    test('section headings inherit: theme ink on the canvas, dark ink inside a white card', () => {
        expect(ruleBody(css, 'h2.task_priority_wrapper_value')).toMatch(/color:\s*inherit/);
    });

    test('the white sections and cards keep dark ink for the text they inherit', () => {
        expect(ruleBody(css, '.mySettingSection')).toMatch(/color:\s*#17161c/);
        const card = (rel, sel) => { const vue = read(rel); return ruleBody(vue.slice(vue.indexOf('<style')), sel); };
        expect(card('components/molecules/Setting/SettingScreenshotRetention.vue', '.screenshot-retention-card')).toMatch(/color:\s*#17161c/);
        expect(card('components/molecules/Setting/SettingTimeReminder.vue', '.time-reminder-card')).toMatch(/color:\s*#17161c/);
        expect(card('components/molecules/Setting/SettingAutoCloseProjects.vue', '.acp-card')).toMatch(/color:\s*#17161c/);
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

describe('Integrations hub', () => {
    test('secondary text on the white panel drops the 2.3:1 grey', () => {
        expect(read('views/Integrations/IntegrationsHub.vue')).not.toMatch(/#9aa0b4/i);
    });
});

describe('Doc editor header', () => {
    const vue = read('views/Pages/PageEditorView.vue');

    test('reads "Edited by X · 4m ago", not "on 4m"', async () => {
        const en = (await import('../../src/locales/en.js')).default;
        expect(en.Projects.page_edited_by_ago).toBe('Edited by {who} · {when}');
        expect(en.Projects.page_edited_by).toBeUndefined();
        expect(vue).toMatch(/\$t\('Projects\.page_edited_by_ago'/);
    });

    test('on a phone Present and Share keep only their icons, so Share stays on screen', () => {
        const phone = vue.slice(vue.indexOf('@media (max-width: 767px)'));
        expect(phone).toMatch(/\.pev__btn-label[^{]*\{\s*display:\s*none/);
        expect(vue).toMatch(/pev__icon-btn" :aria-label="\$t\('Docs\.share'\)"/);
    });
});

describe('Automations list on a phone', () => {
    test('the rule sentence keeps a full line instead of one word per line', () => {
        const css = read('views/Automations/style.css');
        const phone = css.slice(css.indexOf('@media (max-width: 767px)'));
        expect(ruleBody(phone, '.au__rule-text')).toMatch(/flex-basis:\s*calc\(100% - 40px\)/);
    });
});

describe('Custom report grouped by status', () => {
    test('names the status types instead of printing default_active', async () => {
        const en = (await import('../../src/locales/en.js')).default;
        expect(en.Reports.status_type_default_active).toBe('To do');
        expect(en.Reports.status_type_active).toBe('In progress');
        expect(en.Reports.status_type_close).toBe('Closed');
        const vue = read('views/CustomReports/CustomReports.vue');
        expect(vue.match(/rows\.value = labelRows\(/g)).toHaveLength(2);
        expect(vue).toMatch(/if \(key === 'status'\) return \{ key, label: `\$\{t\('Reports\.dim_status'\)\}/);
    });
});

describe('Settings → General company phone', () => {
    const vue = read('components/molecules/Setting/SettingCompanyDetails.vue');

    test('a company with no phone, or the wizard\'s "N/A", opens without a validation error', () => {
        expect(vue).toMatch(/\["", "undefined", "null", "N\/A"\]\.includes\(number\)\) \{\s*phoneError\.value = '';/);
    });

    test('the error goes through i18n', async () => {
        const en = (await import('../../src/locales/en.js')).default;
        expect(en.Settings.phone_invalid).toBe('Enter a valid phone number.');
        expect(vue).not.toMatch(/Please enter valid number/);
    });
});

describe('Milestones report headline', () => {
    test('labels the first count', async () => {
        const en = (await import('../../src/locales/en.js')).default;
        expect(en.Reports.milestones_summary).toBe('{total} dated · {risk} at risk · {missed} missed');
        expect(en.Reports.milestones_head).toBeUndefined();
        expect(read('views/Projects/Reports/MilestonesReportPage.vue')).toMatch(/t\('Reports\.milestones_summary'/);
    });
});

describe('My settings → working hours', () => {
    test('start → end sit on one row: the sizes out-specify .ah-input', () => {
        const css = read('views/Settings/MySettings/style.css');
        expect(ruleBody(css, '.ms__wh .ms__time')).toMatch(/width:\s*110px/);
        expect(ruleBody(css, '.ms__wh .ms__cap-input')).toMatch(/width:\s*72px/);
        expect(ruleBody(css, '.ms__wh .ms__wh-tz')).toMatch(/max-width:\s*320px/);
    });
});

describe('Notifications → quiet hours', () => {
    test('the two time fields keep their width: the rule out-specifies .ah-input', () => {
        expect(ruleBody(read('views/Settings/Notifications/style.css'), '.nt__quiet-row .nt__time')).toMatch(/width:\s*96px/);
    });
});

describe('Team on a phone', () => {
    test('the headline counts give way so both toolbar buttons fit', () => {
        const css = read('views/Team/style.css');
        const phone = css.slice(css.indexOf('@media (max-width: 767px)'));
        expect(ruleBody(phone, '.team .parity-count')).toMatch(/display:\s*none/);
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

describe('timesheets and the milestone report without the permission', () => {
    const views = [
        'views/Timesheet/ProjectTimesheet/ProjectTimesheet.vue',
        'views/Timesheet/TrackerTimeSheet/TrackerTimesheet.vue',
        'views/Timesheet/UserTimeSheet/UserTimesheet.vue',
        'views/Timesheet/WorkloadTimesheet/WorkloadTimesheet.vue',
        'views/MilestoneReport/MilestoneReport.vue',
    ];

    test.each(views)('%s says "no access" instead of the 404 card', (rel) => {
        const vue = read(rel);
        expect(vue).toMatch(/<AppState [^>]*kind="denied"/);
        expect(vue).not.toMatch(/import NotFound\b/);
        expect(vue).not.toMatch(/<NotFound\b/);
    });

    test('the denied state names the screen and only offers the way home', async () => {
        const en = (await import('../../src/locales/en.js')).default;
        expect(en.Inbox.state_denied_title).toBe("You don't have access to this screen");
        expect(en.Inbox.state_denied_primary).toBe('Go home');
        expect(en.Inbox.state_denied_secondary).toBeUndefined();
        const state = read('components/molecules/AppState/AppState.vue');
        expect(state).toMatch(/denied: false/);
        expect(state).toMatch(/props\.kind === 'notfound' \|\| props\.kind === 'denied'\) goHome\(\)/);
    });
});

describe('Settings → Projects apps column', () => {
    test('the app list does not share class names with the global search palette', () => {
        const vue = read('components/molecules/ProjectAppsList/ProjectAppsList.vue');
        expect(vue).not.toMatch(/\bpal(__|\b)/);
        expect(read('components/molecules/AdvanceSearch/style.css')).toMatch(/^\.pal \{[^}]*max-height/m);
    });

    test('apps get their own row as a grid, in dark ink on the white card', () => {
        const css = read('components/molecules/ProjectsListingSetting/style.css');
        const last = css.slice(css.lastIndexOf('.project_status_info_area {'));
        expect(ruleBody(last, '.p_erpApp')).toMatch(/flex:\s*1 0 100%/);
        expect(last).toMatch(/\.pls__apps \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(220px, 1fr\)\)/);
        expect(last).toMatch(/\.pls__apps \{ --ink: #17161c;/);
    });
});

describe('upgrade wall', () => {
    const vue = read('components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue');
    const css = vue.slice(vue.indexOf('<style scoped>'));

    test('title and message follow the theme instead of fixed black', () => {
        expect(vue).not.toMatch(/class="[^"]*\bblack\b/);
        expect(ruleBody(css, '.upw__title')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.upw__message')).toMatch(/color:\s*var\(--ink-label\)/);
    });

    test('the button keeps white text on a green dark enough to read', () => {
        expect(vue).not.toMatch(/bg-dark-green-light/);
        expect(ruleBody(css, '.upw__btn')).toMatch(/background:\s*#15803d;\s*color:\s*#fff/);
    });

    test('dark mode darkens the legacy project panel the wall sits in', () => {
        expect(read('assets/css/tokens.css')).toMatch(/:root\[data-theme="dark"\] \.section-right\.bg-white:has\(\.upw\)/);
    });
});

describe('fields that set their own size next to .ah-input', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) return walk(full);
        return /\.(vue|css)$/.test(d.name) ? [full] : [];
    });
    const files = walk(SRC);
    const vues = files.filter((f) => f.endsWith('.vue')).map((f) => ({ f, text: fs.readFileSync(f, 'utf8') }));

    const sizedWith = new Set();
    for (const { text } of vues) {
        for (const m of text.matchAll(/[\s<]class="([^"]*)"/g)) {
            const list = m[1].split(/\s+/);
            if (list.includes('ah-input')) list.filter((c) => c && !c.startsWith('ah-')).forEach((c) => sizedWith.add(c));
        }
    }

    // A scoped block adds a [data-v] attribute and already out-specifies .ah-input; an @import inside one does not.
    const scopedSrc = new Set();
    const unscoped = [];
    for (const { f, text } of vues) {
        for (const m of text.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)) {
            const attrs = m[1];
            const src = /src="([^"]+)"/.exec(attrs);
            if (src && /\bscoped\b/.test(attrs)) scopedSrc.add(path.resolve(path.dirname(f), src[1]));
            else if (!/\bscoped\b/.test(attrs)) unscoped.push({ f, css: m[2] });
        }
    }
    files.filter((f) => f.endsWith('.css') && !scopedSrc.has(f)).forEach((f) => unscoped.push({ f, css: fs.readFileSync(f, 'utf8') }));

    test('no unscoped single-class rule sizes an .ah-input field, which would depend on stylesheet order', () => {
        const offenders = [];
        for (const { f, css } of unscoped) {
            for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                if (!/(^|;)\s*(width|height|padding[\w-]*|font(-size)?|max-width|min-width)\s*:/.test(m[2])) continue;
                for (const selector of m[1].split(',').map((s) => s.trim())) {
                    const single = /^\.([\w-]+)$/.exec(selector);
                    if (single && sizedWith.has(single[1])) offenders.push(`${path.relative(SRC, f)}: ${selector}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the sweep\'s fields keep their sizes with two classes', () => {
        expect(ruleBody(read('views/Settings/SecurityPermissions/style.css'), '.ah-input.sp__search')).toMatch(/max-width:\s*320px/);
        expect(ruleBody(read('views/Settings/Members/style.css'), '.ah-input.mbv__select')).toMatch(/width:\s*auto/);
        expect(ruleBody(read('views/Settings/Teams/style.css'), '.ah-input.tm__name-input')).toMatch(/height:\s*30px/);
        expect(ruleBody(read('views/Billing/style.css'), '.ah-input.billing__pick')).toMatch(/width:\s*240px/);
        expect(ruleBody(read('views/Timesheet/timeV2.css'), '.ah-input.tv-input-mono')).toMatch(/font:/);
    });
});
