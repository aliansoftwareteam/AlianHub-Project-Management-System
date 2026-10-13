import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';
import { contrastOn } from '../wcagContrast';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'uid', debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id }) })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);

import customFieldPlugin from '@/plugins/customFieldView/customFieldPlugin';
import CustomFieldDrawer from '@/plugins/customFieldView/component/molecules/customFieldSidebar/customField.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const template = (rel) => { const vue = read(rel); return vue.slice(0, vue.indexOf('<script')); };
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (css) => [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
const ruleBody = (css, selector) => rules(css).filter((rule) => rule.selector.split(',').some((part) => part.trim() === selector)).map((rule) => rule.body).join('');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(css|vue)$/.test(entry.name) ? [full] : [];
});

const COLOUR_DECLARATION = /(?:^|[;{\s"'`(])(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke)\s*:\s*([^;}]*)/gi;
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:white|black|red|blue|darkblue|cornflowerblue|aliceblue|lightgr[ae]y)\b/i;
const hardCodedColours = (source) => {
    const found = [];
    source.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(COLOUR_DECLARATION)) {
            if (LITERAL.test(match[1].replace(/var\([^)]*\)/g, ''))) found.push(`${index + 1}: ${line.trim()}`);
        }
    });
    return found;
};
const tags = (rel, name) => template(rel).split(`<${name}`).slice(1).filter((rest) => /^[\s>]/.test(rest)).map((rest) => rest.split(/\/>|<template/)[0]);
const classValues = (source) => [...source.matchAll(/(?<![\w-]):?class="([^"]*)"/g)].map((match) => match[1]);

const tokens = read('assets/css/tokens.css');
const block = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    return start === -1 ? '' : tokens.slice(start, tokens.indexOf('}', start));
};
const declared = (body) => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)].map((match) => [match[1], match[2].trim()]));
const light = declared(block(':root'));
const dark = { ...light, ...declared(block(':root[data-theme="dark"]')) };
const contrastLight = { ...light, ...declared(block(':root.ah-high-contrast')) };
const contrastDark = { ...dark, ...declared(block(':root.ah-high-contrast')), ...declared(block(':root.ah-high-contrast[data-theme="dark"]')) };
const THEMES = { light, dark, 'high contrast light': contrastLight, 'high contrast dark': contrastDark };
const valueOf = (value, theme) => {
    const ref = /^var\((--[a-z0-9-]+)(?:,\s*(.+))?\)$/.exec(value.trim());
    return ref ? valueOf(theme[ref[1]] ?? ref[2], theme) : value.trim();
};

describe('a chip reads on every surface of every theme', () => {
    const chips = rules(tokens)
        .filter((rule) => /^\.ah-chip(--[a-z]+)?$/.test(rule.selector) && /background:/.test(rule.body) && /(^|[;\s])color:/.test(rule.body))
        .map((rule) => [rule.selector, /background:\s*([^;]+);/.exec(rule.body)[1], /(?:^|[;\s])color:\s*([^;]+);/.exec(rule.body)[1]]);

    test('every coloured variant is found in the tokens', () => {
        expect(chips.map(([selector]) => selector)).toEqual(expect.arrayContaining(['.ah-chip', '.ah-chip--ok', '.ah-chip--warn', '.ah-chip--danger', '.ah-chip--brand', '.ah-chip--agent', '.ah-chip--automation', '.ah-chip--dark']));
    });

    test.each(Object.keys(THEMES))('in %s every variant is 4.5:1 or better', (name) => {
        const theme = THEMES[name];
        const under = [];
        for (const [selector, background, color] of chips) {
            for (const surface of ['--surface', '--surface-2', '--canvas']) {
                const ratio = contrastOn(valueOf(color, theme), valueOf(background, theme), valueOf(theme[surface], theme));
                if (ratio < 4.5) under.push(`${selector} on ${surface}: ${ratio.toFixed(2)}`);
            }
        }
        expect(under).toEqual([]);
    });

    test('the agent chip has an ink of its own in each theme', () => {
        expect(ruleBody(tokens, '.ah-chip--agent')).toMatch(/color:\s*var\(--agent-ink\)/);
        for (const selector of [':root', ':root[data-theme="dark"]', ':root.ah-high-contrast', ':root.ah-high-contrast[data-theme="dark"]']) {
            expect(declared(block(selector))['--agent-ink']).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });

    test('no text is painted with the agent fill colour', () => {
        const offenders = walk(SRC).flatMap((file) => rules(fs.readFileSync(file, 'utf8'))
            .filter((rule) => /(^|[;\s])color:\s*var\(--agent\)/.test(rule.body))
            .map((rule) => `${path.relative(SRC, file)} ${rule.selector.split('\n').pop().trim()}`));
        expect(offenders).toEqual([]);
    });

    test('a themed sidebar row no longer repaints the chip itself', () => {
        expect(read('components/molecules/SidebarItems/style.css')).not.toMatch(/ah-chip--agent/);
    });
});

describe('the remaining white menus follow the theme', () => {
    test('the month picker of an hourly milestone has no fixed colour', () => {
        expect(hardCodedColours(withoutComments(read('components/atom/MonthlyCalendarMilestone/MonthlyCalendar.css')))).toEqual([]);
        const popup = ruleBody(read('components/atom/MonthlyCalendarMilestone/MonthlyCalendar.css'), '.calendar_wrapper');
        expect(popup).toMatch(/background:\s*var\(--surface\)/);
        expect(popup).toMatch(/color:\s*var\(--ink\)/);
        expect(popup).toMatch(/color-scheme:\s*var\(--scheme\)/);
    });

    test('the attach-from menu has no fixed colour', () => {
        const menu = rules(read('components/atom/Attachments/styleAttachment.css')).filter((rule) => rule.selector.includes('attach-sourcemenu'));
        expect(menu.length).toBeGreaterThan(5);
        expect(hardCodedColours(menu.map((rule) => `${rule.selector} { ${rule.body} }`).join('\n'))).toEqual([]);
        const panel = ruleBody(read('components/atom/Attachments/styleAttachment.css'), '.attach-sourcemenu');
        expect(panel).toMatch(/background:\s*var\(--surface\)/);
        expect(panel).toMatch(/color-scheme:\s*var\(--scheme\)/);
    });

    const THEMED_MENUS = [
        'components/atom/FixMilestoneTd/FixMilestoneTd.vue',
        'components/atom/HourlyMilestoneTd/HourlyMilestoneTd.vue',
        'plugins/customFieldView/component/atom/customFieldTaskView/phoneComponentListing.vue',
        'plugins/customFieldView/component/atom/customFieldViewColumn/phoneComponentViewColumn.vue',
        ...['checkboxCustomFields', 'dateComponent', 'emailComponent', 'formulaComponent', 'moneyComponent', 'numberComponent', 'phoneComponent', 'rollupComponent', 'textComponents', 'textareaComponent', 'dropdownCustomField/dropdownCustomField']
            .map((name) => `plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/${name}.vue`)
    ];
    test.each(THEMED_MENUS)('%s opens every menu themed', (rel) => {
        const menus = tags(rel, 'DropDown');
        expect(menus.length).toBeGreaterThan(0);
        expect(menus.filter((tag) => !/\sthemed(\s|$)/.test(tag))).toEqual([]);
    });

    test('the lines inside the milestone menus are theme hairlines', () => {
        expect(hardCodedColours(withoutComments(read('components/atom/FixMilestoneTr/FixMilestoneTr.css')))).toEqual([]);
        for (const rel of ['components/atom/FixMilestoneTd/FixMilestoneTd.vue', 'components/atom/HourlyMilestoneTd/HourlyMilestoneTd.vue']) {
            expect(classValues(template(rel)).filter((value) => /border-bottom-black/.test(value))).toEqual([]);
        }
    });

    test('the search field of a themed menu is a theme field', () => {
        const field = ruleBody(read('plugins/customFieldView/component/molecules/customFieldTaskView/style.css'), '.dd-tokens .customfield__form-control');
        expect(field).toMatch(/background:\s*var\(--surface\)/);
        expect(field).toMatch(/color:\s*var\(--ink\)/);
        expect(field).toMatch(/border-color:\s*var\(--border\)/);
    });
});

describe('the project tabs that show the details column', () => {
    test('Comments and Activity sit on the canvas of the theme too', () => {
        const vue = read('views/Projects/Projects.vue');
        expect(template('views/Projects/Projects.vue')).toMatch(/bodyOnTokens \? 'list-view-body--detail' : 'bg-light-gray'/);
        expect(/const TOKEN_BODY_TABS = \[([^\]]+)\]/.exec(vue)[1].replace(/['\s]/g, '').split(',')).toEqual(['ProjectDetail', 'Comments', 'ActivityLog']);
    });

    test('the activity list paints its names, its text and Load more from tokens', () => {
        const css = read('components/templates/ActivityLog/style.css');
        expect(hardCodedColours(withoutComments(css))).toEqual([]);
        expect(ruleBody(css, '.main-activity .wrapperNameImage span b')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.main-activity .wrapperNameImage span')).toMatch(/color:\s*var\(--ink-2\)/);
        expect(ruleBody(css, '.btn-class')).toMatch(/color:\s*var\(--brand\)/);
    });

    test('the comment feed on the tab paints its bubbles, footer and field from tokens', () => {
        const css = read('views/Projects/Comments/style.css');
        expect(ruleBody(css, '.list-view-body--detail .message_id-sent.bg-white')).toMatch(/background-color:\s*var\(--surface\)/);
        expect(ruleBody(css, '.list-view-body--detail .message_id-sent')).toMatch(/color:\s*var\(--ink\)/);
        const footer = ruleBody(css, '.list-view-body--detail #comment_footer');
        expect(footer).toMatch(/background-color:\s*var\(--surface\)/);
        expect(footer).toMatch(/color-scheme:\s*var\(--scheme\)/);
        expect(ruleBody(css, '.list-view-body--detail .write-message')).toMatch(/color:\s*var\(--ink\)/);
    });

    test('the feed and the activity list take theme ink for their legacy colour classes', () => {
        const css = read('views/Projects/style.css');
        expect(css).toMatch(/\.list-view-body--detail :is\([^)]*\.black[^)]*\)[^{]*\{[^}]*color:\s*var\(--ink\)/);
    });
});

describe('the AI links on a dark surface', () => {
    test.each([
        ['components/molecules/CheckList/style.css', ':root[data-theme="dark"] .checklist-main .checklist-main__suggest'],
        ['components/atom/Description/style.css', ':root[data-theme="dark"] .ai-write-desc-bar .ai-color']
    ])('%s paints the link in the solid brand colour', (rel, selector) => {
        const body = ruleBody(read(rel), selector);
        expect(body).toMatch(/background:\s*none/);
        expect(body).toMatch(/(^|[;\s])color:\s*var\(--brand\)/);
    });
});

describe('the list of field types in the drawer', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    const TEXT_TYPE = { cfType: 'text', cfTitle: 'Text', cfDescrption: 'One line of text', cfIcon: 'CustomFieldText', cfPrimaryColor: '#6473E8' };
    const store = () => createStore({
        getters: {
            'settings/customFields': () => [TEXT_TYPE],
            'settings/selectedCompany': () => ({ planFeature: { customFields: true } }),
            'settings/AllTaskType': () => [],
            'settings/taskType': () => []
        }
    });
    const mounted = [];
    afterEach(() => { while (mounted.length) mounted.pop().unmount(); });
    const drawer = async () => {
        const wrapper = mount(CustomFieldDrawer, {
            props: { componentDetails: {}, pageInd: 0, customFieldObject: {} },
            global: {
                plugins: [i18n, customFieldPlugin, store()],
                mocks: {},
                provide: { ...config.global.provide, selectedProject: ref({ _id: 'p1' }) },
                stubs: { ModuleFieldEditor: true, CustomFieldsComponent: true, CustomFieldsTabComponent: true, ShellIcon: true }
            }
        });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper;
    };

    test('every type is a button a keyboard can reach and press', async () => {
        const wrapper = await drawer();
        const rows = wrapper.findAll('[data-field-type]');
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.map((row) => [row.element.tagName, row.attributes('type')])).toEqual(rows.map(() => ['BUTTON', 'button']));
        expect(rows[0].find('h1, h2, h3, h4, h5, h6, div, p').exists()).toBe(false);
        await rows[0].trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-field-back]').exists()).toBe(true);
    });

    test('a focused type shows a focus ring', () => {
        const css = read('plugins/customFieldView/component/molecules/customFieldSidebar/style.css');
        expect(ruleBody(css, '.custom_field_type:focus-visible .custom_field_wrapper')).toMatch(/box-shadow:\s*var\(--focus\)/);
    });
});

describe('names are shown as stored', () => {
    test.each([
        'components/molecules/SidebarItems/SidebarItems.vue',
        'components/organisms/TaskInSidebar/TaskInSidebar.vue',
        'components/atom/FixMilestoneTd/FixMilestoneTd.vue',
        'components/atom/HourlyMilestoneTd/HourlyMilestoneTd.vue',
        'components/molecules/TemplateSelectForm/TemplateSelectForm.vue',
        'components/templates/CreateProject/TemplateDetail.vue',
        'components/molecules/EmbedView/EmbedView.vue',
        'components/molecules/EstimateHours/EstimateHours.vue',
        'components/molecules/TaskFilter/TaskFilter.vue',
        'components/molecules/TaskFilter/FieldsActions.vue',
        'components/organisms/SprinstList/SprintsList.vue',
        'plugins/tasklistDashboard/components/organisms/SprintListing/SprintListing.vue',
        'plugins/dashboard/component/DisplayComponent.vue'
    ])('%s does not capitalise a name', (rel) => {
        expect(classValues(template(rel)).filter((value) => /text-capitalize/.test(value))).toEqual([]);
    });

    test('the project form capitalises neither the name nor the key', () => {
        const inputs = tags('components/templates/CreateProject/ProjectForm.vue', 'InputText');
        expect(inputs.length).toBeGreaterThan(1);
        expect(inputs.filter((tag) => /text-capitalize/.test(tag))).toEqual([]);
    });

    test('the field list in Settings capitalises the type word only', () => {
        const kept = classValues(template('plugins/customFieldView/component/atom/settingCustomField/customFieldList.vue')).filter((value) => /text-capitalize/.test(value));
        expect(kept.every((value) => /field__type|field__title__type/.test(value))).toBe(true);
        expect(kept).toHaveLength(2);
    });

    test.each([
        ['components/organisms/SprinstList/style.css', '.spr__name'],
        ['components/organisms/Item/style.css', '.project-sb-ptitle'],
        ['components/organisms/TeamCategoryBreakdownCard/TeamCategoryBreakdownCard.vue', '.tcb-type-name'],
        ['components/molecules/DropDownOption/style.css', '.project-mobile-desc']
    ])('%s: %s keeps the case of the name', (rel, selector) => {
        const css = read(rel);
        const bodies = rules(css.slice(Math.max(0, css.indexOf('<style')))).filter((rule) => rule.selector.split(',').some((part) => part.trim().endsWith(selector)));
        expect(bodies.length).toBeGreaterThan(0);
        expect(bodies.map((rule) => rule.body).join('')).not.toMatch(/text-transform/);
    });
});

describe('a picture beside a written name is not read out as well', () => {
    /* One entry per <UserProfile> in the file, in order: true where the name is written beside it. */
    const BESIDE_A_NAME = {
        'components/atom/CommentInput/CommentInput.vue': [true, true],
        'components/atom/ConfirmationsInTask/ConfirmationsInTask.vue': [false, true, false, true, false, true],
        'components/atom/Dashboard/TimeEstimatedWorkloadComp.vue': [true],
        'components/atom/DuplicateCompo/DuplicateCompo.vue': [false, true, false, true],
        'components/atom/HourlyMilestoneTd/HourlyMilestoneTd.vue': [true],
        'components/atom/PreviewTimelogScreenShot/PreviewTimelogScreenShot.vue': [true],
        'components/atom/TimesheetView/LogDetailView/LogDetailViewBodyComponent.vue': [true],
        'components/atom/TimesheetView/LogDetailView/LogDetailViewHeaderComponent.vue': [false, true],
        'components/atom/TimesheetView/LogDetailView/UserLogDetailView/LogDetailView.vue': [true],
        'components/atom/TimesheetView/TrackerTimeSheetView/ScreenShotDisplayComponent.vue': [false],
        'components/atom/TimesheetView/TrackerTimeSheetView/ScreenShotViewHover.vue': [true],
        'components/molecules/ActivityLogContent/ActivityContent.vue': [true],
        'components/molecules/Assignee/Assignee.vue': [false, true],
        'components/molecules/CommentThread/CommentThread.vue': [true],
        'components/molecules/EstimateHourTable/EstimateHourTable.vue': [true],
        'components/molecules/FileAndLinks/FileAndLinks.vue': [false, true],
        'components/molecules/HubAiSidebar/HubAiSidebar.vue': [true],
        'components/molecules/SidebarItems/SidebarItems.vue': [true],
        'components/molecules/TaskAudioFiles/TaskAudioFiles.vue': [false, true],
        'components/molecules/WhoCanSee/WhoCanSeeModal.vue': [true],
        'components/organisms/Comment/Comment.vue': [true, true],
        'components/organisms/EmployeeWorkloadReportCard/EmployeeWorkloadReportCard.vue': [true],
        'components/organisms/Item/Item.vue': [true],
        'components/organisms/OnLeaveCard/OnLeaveCard.vue': [true],
        'components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue': [true],
        'components/organisms/ProjectWatcher/ProjectWatcher.vue': [true],
        'components/organisms/Shell/GlobalRail.vue': [false, true],
        'components/organisms/Shell/MobileTabBar.vue': [true],
        'components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue': [true],
        'components/organisms/TaskInSidebar/TaskInSidebar.vue': [false, true],
        'components/organisms/UsersByCategoryCard/UsersByCategoryCard.vue': [true],
        'components/templates/Dashboard/DropDownListComponent.vue': [false, false, true],
        'plugins/customFieldView/component/atom/settingCustomField/customFieldList.vue': [true],
        'views/Inbox/Inbox.vue': [false],
        'views/Timesheet/ProjectTimesheet/ProjectTimesheet.vue': [true],
        'views/Timesheet/TrackerTimeSheet/TrackerTimesheet.vue': [true]
    };

    test('the table covers every place a picture is drawn', () => {
        const users = walk(SRC).filter((file) => file.endsWith('.vue') && /<UserProfile[\s>]/.test(fs.readFileSync(file, 'utf8').split('<script')[0])).map((file) => path.relative(SRC, file)).sort();
        expect(users).toEqual(Object.keys(BESIDE_A_NAME).sort());
    });

    test.each(Object.entries(BESIDE_A_NAME))('%s', (rel, expected) => {
        expect(tags(rel, 'UserProfile').map((tag) => /\sdecorative(\s|$)/.test(tag))).toEqual(expected);
    });
});

describe('the project detail cards at phone width', () => {
    test('the bordered cards keep the page gutter instead of touching the edge', () => {
        const css = read('views/Projects/ProjectDetail/theme.css');
        const phone = css.slice(css.indexOf('@media (max-width: 767px)'));
        const card = rules(phone).find((rule) => /\.pm\b/.test(rule.selector) && /\.pdt\b/.test(rule.selector) && /\.arc\b/.test(rule.selector));
        expect(card).toBeTruthy();
        expect(card.body).toMatch(/margin-(left|inline):\s*var\(--page-pad-x, 16px\)/);
        expect(card.body).toMatch(/margin-(right|inline):\s*var\(--page-pad-x, 16px\)/);
    });
});
