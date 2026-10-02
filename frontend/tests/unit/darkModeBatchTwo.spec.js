import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

vi.mock('@/services', () => ({
    apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
    apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ status: 200, data: {} }))
}));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({
        checkPermission: () => true,
        checkApps: (app, project) => Boolean(project?.apps?.includes(app)),
        makeUniqueId: () => 'uid',
        debounce: (fn) => fn
    }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id }) })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
const formKit = vi.hoisted(() => ({
    stub: (vue) => vue.defineComponent({
        name: 'FormKit',
        inheritAttrs: false,
        props: ['type', 'label'],
        setup: (props, { slots, attrs }) => () => (props.type === 'form'
            ? vue.h('form', slots.default ? slots.default() : [])
            : vue.h('button', { type: 'button', ...attrs }, props.label))
    })
}));
vi.mock('@formkit/vue', async () => ({ FormKit: formKit.stub(await import('vue')) }));
vi.mock('@/plugins/customFieldView/lazyFormKit', async () => {
    const library = { FormKit: formKit.stub(await import('vue')) };
    return { ...library, ensureFormKit: () => Promise.resolve(library), bindFormKitApp: () => {} };
});

import customFieldPlugin from '@/plugins/customFieldView/customFieldPlugin';
import CustomFieldsSidebarComponent from '@/plugins/customFieldView/component/molecules/customFieldSidebar/customFieldsSidebarComponent/customFieldsSidebarComponent.vue';
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const template = (rel) => { const vue = read(rel); return vue.slice(0, vue.indexOf('<script')); };
const withoutScript = (source) => source.replace(/<script[\s\S]*?<\/script>/g, '');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};

const COLOUR_DECLARATION = /(?:^|[;{\s"'`(])(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke)\s*:\s*([^;}]*)/gi;
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:white|black|red|blue|darkblue|aliceblue|lightgr[ae]y)\b/i;
const hardCodedColours = (source) => {
    const found = [];
    source.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(COLOUR_DECLARATION)) {
            if (LITERAL.test(match[1].replace(/var\([^)]*\)/g, ''))) found.push(`${index + 1}: ${line.trim()}`);
        }
    });
    return found;
};
/* At phone widths the base .form-control sets a fixed grey with !important. */
const PHONE_PROOF_INK = /color:\s*var\(--ink\) !important/;
const LEGACY_COLOUR_CLASS = /(?<![\w-])(?:bg-white|bg-light-gray|black|gray81|dark-gray|GunPowder)(?![\w-])/;
const classValues = (source) => [...source.matchAll(/(?<![\w-]):?class="([^"]*)"/g)].map((match) => match[1]);
const legacyClasses = (rel) => classValues(template(rel)).filter((value) => LEGACY_COLOUR_CLASS.test(value));

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n, customFieldPlugin];
config.global.mocks = {};
config.global.provide = { ...config.global.provide, $defaultUserAvatar: 'default-avatar.png' };

const mounted = [];
const keep = (wrapper) => { mounted.push(wrapper); return wrapper; };
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

describe('a token surface inside a host that keeps light controls', () => {
    const tokens = read('assets/css/tokens.css');
    const block = (selector) => {
        const start = tokens.indexOf(`${selector} {`);
        return start === -1 ? '' : tokens.slice(start, tokens.indexOf('}', start));
    };

    test('the theme carries its scheme as a token', () => {
        expect(block(':root')).toMatch(/--scheme:\s*light;/);
        expect(block(':root[data-theme="dark"]')).toMatch(/--scheme:\s*dark;/);
    });

    test.each([
        ['views/Projects/style.css', '.list-view-body--detail'],
        ['components/organisms/ProjectDetailRightSide/style.css', '.projectRightside'],
        ['components/molecules/Sidebar/style.css', '.sb-tokens']
    ])('%s: %s states the scheme of the theme', (rel, selector) => {
        expect(ruleBody(read(rel), selector)).toMatch(/color-scheme:\s*var\(--scheme\)/);
    });

    test('the public link dialog gives its date field the picker icon of the theme', () => {
        const vue = read('components/molecules/PublicShare/PublicShareModal.vue');
        expect(ruleBody(vue.slice(vue.indexOf('<style')), '.pshare__card')).toMatch(/color-scheme:\s*var\(--scheme\)/);
    });
});

describe('the project details page paints from tokens', () => {
    test.each([
        'components/organisms/ProjectDetailRightSide/style.css',
        'components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue',
        'views/Projects/ProjectDetail/ProjectDetail.vue',
        'views/Projects/ProjectDetail/theme.css',
        'components/organisms/FixMilestone/FixMilestone.css',
        'plugins/customFieldView/component/molecules/customFieldProjectDetail/customFieldProjectDetail.vue'
    ])('%s has no hard-coded colour', (rel) => {
        expect(hardCodedColours(withoutScript(read(rel)))).toEqual([]);
    });

    test.each([
        'components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue',
        'views/Projects/ProjectDetail/ProjectDetail.vue',
        'plugins/customFieldView/component/molecules/customFieldProjectDetail/customFieldProjectDetail.vue'
    ])('%s has no legacy colour class', (rel) => {
        expect(legacyClasses(rel)).toEqual([]);
    });

    test('the page body is the canvas of the theme, not the fixed light grey', () => {
        expect(template('views/Projects/Projects.vue')).toMatch(/TOKEN_BODY_TABS\.includes\(activeTab\) \? 'list-view-body--detail' : 'bg-light-gray'/);
        expect(read('views/Projects/Projects.vue')).toMatch(/const TOKEN_BODY_TABS = \['ProjectDetail'/);
        const body = ruleBody(read('views/Projects/style.css'), '.list-view-body--detail');
        expect(body).toMatch(/background:\s*var\(--canvas\)/);
        expect(body).toMatch(/color:\s*var\(--ink\)/);
    });

    test('the details column is a surface with theme ink', () => {
        const side = ruleBody(read('components/organisms/ProjectDetailRightSide/style.css'), '.projectRightside');
        expect(side).toMatch(/background:\s*var\(--surface\)/);
        expect(side).toMatch(/color:\s*var\(--ink\)/);
    });

    test('the shared blocks inside the page take theme ink for their legacy colour classes', () => {
        const css = read('views/Projects/style.css');
        expect(css).toMatch(/\.list-view-body--detail :is\([^)]*\.black[^)]*\)[^{]*\{[^}]*color:\s*var\(--ink\)/);
        expect(css).toMatch(/\.list-view-body--detail \.blue[^{]*\{[^}]*color:\s*var\(--brand\)/);
        expect(read('views/Projects/ProjectDetail/ProjectDetail.vue')).toMatch(/<style src="\.\/theme\.css"><\/style>/);
    });

    test('a text field on the page keeps theme ink at phone width', () => {
        expect(ruleBody(read('views/Projects/ProjectDetail/theme.css'), '.project__detail-component .form-control')).toMatch(PHONE_PROOF_INK);
        expect(ruleBody(read('components/organisms/ProjectDetailRightSide/style.css'), '.projectRightside .form-control')).toMatch(PHONE_PROOF_INK);
    });

    test('custom field rows in the details column take label and value colours from tokens', () => {
        expect(hardCodedColours(read('plugins/customFieldView/component/atom/customFieldTaskView/customFieldListing/style.css'))).toEqual([]);
    });
});

describe('the custom field drawer', () => {
    const DRAWER_SOURCES = [
        'plugins/customFieldView/component/molecules/customFieldSidebar/style.css',
        'plugins/customFieldView/component/molecules/customFieldSidebar/theme.css',
        'plugins/customFieldView/component/molecules/customFieldSidebar/customField.vue',
        'plugins/customFieldView/component/molecules/customFieldSidebar/customFieldsSidebarComponent/customFieldsSidebarComponent.vue',
        'plugins/customFieldView/component/molecules/customFieldSidebar/customFieldsComponent/style.css',
        'plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/customFieldInputComponent/style.css',
        'plugins/customFieldView/component/atom/customFieldSidebar/customFieldComponentStructure/customFieldComponentStructure.vue',
        'plugins/customFieldView/component/atom/customFieldSidebar/customFieldsTabComponent/customFieldsTabComponent.vue'
    ];

    test.each(DRAWER_SOURCES)('%s has no hard-coded colour', (rel) => {
        expect(hardCodedColours(withoutScript(read(rel)))).toEqual([]);
    });

    test.each(DRAWER_SOURCES.filter((rel) => rel.endsWith('.vue')))('%s has no legacy colour class', (rel) => {
        expect(legacyClasses(rel)).toEqual([]);
    });

    test('FormKit fields inside it take their ink, placeholder and border from the theme', () => {
        const fields = ruleBody(read('plugins/customFieldView/component/molecules/customFieldSidebar/theme.css'), '.customFieldSidebar .sidebar-content');
        expect(fields).toMatch(/--fk-color-input:\s*var\(--ink\)/);
        expect(fields).toMatch(/--fk-color-placeholder:\s*var\(--ink-2\)/);
        expect(fields).toMatch(/--fk-color-border:\s*var\(--border\)/);
    });

    const type = (key, name) => ({ key, name, value: name.toLowerCase(), taskCount: 0, isDeleted: false, taskImage: '' });
    const PROJECT = { _id: 'p1', ProjectName: 'QA Sandbox', apps: ['CustomFields'], taskTypeCounts: [type(1, 'Task')] };
    const TEXT_TYPE = { cfType: 'text', cfTitle: 'Text', cfDescrption: 'One line of text', cfIcon: 'CustomFieldText', cfIconGrey: 'CustomFieldTextGrey', cfPrimaryColor: '#6473E8', cfBackgroundColor: '#E0E2FF' };
    const STORED = { _id: 'f-due', fieldTitle: 'Due', fieldType: 'text', fieldDescription: 'A stored field', type: 'task', isDelete: true, global: true, projectId: [], fieldTaskTypes: [] };
    const store = () => createStore({
        modules: {
            settings: {
                namespaced: true,
                getters: {
                    taskType: () => [],
                    AllTaskType: () => [],
                    customFields: () => [TEXT_TYPE],
                    finalCustomFields: () => [STORED],
                    selectedCompany: () => ({ _id: 'c1', planFeature: { customFields: true } })
                }
            },
            projectData: {
                namespaced: true,
                getters: { allProjects: () => ({ data: [PROJECT] }), currentProjectDetails: () => PROJECT }
            }
        }
    });
    const SidebarStub = {
        name: 'SidebarStub',
        props: ['visible', 'title', 'themed', 'closeOnBackDrop'],
        template: '<section v-if="visible" role="dialog" :aria-label="title"><header><slot name="head-left" /><slot name="head-right" /></header><slot name="body" /></section>'
    };
    const stubs = { Sidebar: SidebarStub, CustomFieldInputComponent: true, DropDown: true, TaskTypeIcon: true, ShellIcon: true };
    const drawer = async (props = {}) => {
        const wrapper = keep(mount(CustomFieldsSidebarComponent, {
            props: { isCustomField: true, componentDetail: {}, customFieldObject: {}, ...props },
            global: { plugins: [store()], stubs, provide: { selectedProject: ref(PROJECT) } }
        }));
        await flushPromises();
        return wrapper;
    };
    const typeRows = (wrapper) => wrapper.findAll('[data-field-type]');
    const button = (wrapper, label) => wrapper.findAll('button').find((item) => item.text() === label);
    const openType = async (wrapper, cfType) => {
        await wrapper.get(`[data-field-type="${cfType}"]`).trigger('click');
        await flushPromises();
    };

    test('its panel is a themed sidebar, not a fixed white one', async () => {
        const wrapper = await drawer();
        expect(wrapper.getComponent(SidebarStub).props('themed')).toBe('');
        expect(read('plugins/customFieldView/component/molecules/customFieldSidebar/style.css')).not.toMatch(/sidebar-(body|head)/);
    });

    test('the dialog is named after what it does', async () => {
        expect((await drawer()).get('[role="dialog"]').attributes('aria-label')).toBe(en.CustomField.create_custom_field);
        const editing = await drawer({ componentDetail: TEXT_TYPE, customFieldObject: STORED });
        expect(editing.get('[role="dialog"]').attributes('aria-label')).toBe(en.CustomField.edit_custom_field);
    });

    test('its close control is a named button', async () => {
        const wrapper = await drawer();
        const close = wrapper.get('header button');
        expect(close.attributes('aria-label')).toBe(en.Projects.close);
        expect(close.attributes('type')).toBe('button');
        expect(wrapper.find('header img').exists()).toBe(false);
        await close.trigger('click');
        expect(wrapper.emitted('handleClose')).toHaveLength(1);
    });

    test('Escape closes it, a click outside the form does not', async () => {
        const wrapper = await drawer();
        const sidebar = wrapper.getComponent(SidebarStub);
        expect(sidebar.props('closeOnBackDrop')).toBe(false);
        sidebar.vm.$emit('update:visible', false);
        expect(wrapper.emitted('handleClose')).toHaveLength(1);
    });

    test('Cancel in the form of a new field closes the drawer', async () => {
        const wrapper = await drawer();
        await openType(wrapper, 'text');
        await button(wrapper, en.Projects.cancel).trigger('click');
        expect(wrapper.emitted('handleClose')).toHaveLength(1);
    });

    test('Cancel in the editor of a newer field type closes the drawer', async () => {
        const wrapper = await drawer();
        await openType(wrapper, 'rating');
        await wrapper.get('[data-field-cancel]').trigger('click');
        expect(wrapper.emitted('handleClose')).toHaveLength(1);
    });

    test('Back returns to the list of types and keeps the drawer open', async () => {
        const wrapper = await drawer();
        await openType(wrapper, 'text');
        expect(typeRows(wrapper)).toHaveLength(0);
        const back = wrapper.get('[data-field-back]');
        expect(back.text()).toBe(en.CustomField.back);
        await back.trigger('click');
        await flushPromises();
        expect(typeRows(wrapper).length).toBeGreaterThan(1);
        expect(wrapper.emitted('handleClose')).toBeUndefined();
    });

    test('a stored field has no list to go back to, and Cancel closes', async () => {
        const wrapper = await drawer({ componentDetail: TEXT_TYPE, customFieldObject: STORED });
        expect(wrapper.find('[data-field-back]').exists()).toBe(false);
        await button(wrapper, en.Projects.cancel).trigger('click');
        expect(wrapper.emitted('handleClose')).toHaveLength(1);
    });
});

describe('custom fields in the task panel', () => {
    test.each([
        'plugins/customFieldView/component/atom/customFieldTaskView/customFieldListing/style.css',
        'plugins/customFieldView/component/atom/customFieldTaskView/moduleFieldListing.vue',
        'plugins/customFieldView/fieldTypes/PeopleFieldValue.vue',
        'plugins/customFieldView/fieldTypes/UrlFieldValue.vue'
    ])('%s has no hard-coded colour', (rel) => {
        expect(hardCodedColours(withoutScript(read(rel)))).toEqual([]);
    });

    test('the block is a theme surface at phone width, and its title and dividers take tokens', () => {
        const css = read('plugins/customFieldView/component/molecules/customFieldTaskView/style.css');
        const phone = css.slice(css.indexOf('@media (max-width:767px)'));
        expect(ruleBody(phone, '.custom-field__bg')).toMatch(/background-color:\s*var\(--surface\)/);
        expect(ruleBody(css, '.custom-field__title')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.phone_pipeline::after')).toMatch(/background:\s*var\(--hairline\)/);
    });
});

describe('the legacy pickers follow the theme', () => {
    const options = [{ value: 'u1', label: 'Anita Desai' }, { value: 'u2', label: 'Rahul Mehta' }];
    const ItemStub = { props: ['item', 'themed'], template: '<div class="item-stub" :data-themed="String(themed)">{{ item.label }}</div>' };
    const sidebar = async (props) => {
        const wrapper = keep(mount(Sidebar, {
            props: { title: 'People', options, enableSearch: true, multiSelect: true, value: [options[0]], ...props },
            global: { stubs: { SidebarItems: ItemStub, ShellIcon: true } }
        }));
        await flushPromises();
        return wrapper;
    };
    const panel = () => document.querySelector('#my-sidebar [role="dialog"]');
    const classesInside = () => [panel(), ...panel().querySelectorAll('*')].flatMap((element) => [...element.classList]);

    beforeEach(() => { document.body.innerHTML = '<div id="my-sidebar"></div>'; });

    test('a themed sidebar carries the token class and none of the fixed colour classes', async () => {
        await sidebar({ themed: true });
        expect(panel().classList.contains('sb-tokens')).toBe(true);
        expect(classesInside().filter((name) => ['bg-white', 'bg-light-gray', 'black', 'blue'].includes(name))).toEqual([]);
        expect([...panel().querySelectorAll('.item-stub')].map((item) => item.dataset.themed)).toEqual(['true', 'true']);
        expect(panel().querySelector('.sidebar-close').getAttribute('aria-label')).toBe(en.Projects.close);
    });

    test('a sidebar is themed by default', async () => {
        await sidebar({});
        expect(panel().classList.contains('sb-tokens')).toBe(true);
        expect(panel().classList.contains('bg-white')).toBe(false);
    });

    test('a host that opts out keeps its light panel', async () => {
        await sidebar({ themed: false });
        expect(panel().classList.contains('sb-tokens')).toBe(false);
        expect(panel().classList.contains('bg-white')).toBe(true);
        expect([...panel().querySelectorAll('.item-stub')].map((item) => item.dataset.themed)).toEqual(['false', 'false']);
    });

    test('the token class paints the panel, its head, its rows and its search field', () => {
        const css = read('components/molecules/Sidebar/style.css');
        expect(hardCodedColours(css.slice(css.indexOf('.sb-tokens')))).toEqual([]);
        expect(ruleBody(css, '.sb-tokens')).toMatch(/background:\s*var\(--surface\)/);
        expect(ruleBody(css, '.sb-tokens')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.sb-tokens .form-control')).toMatch(PHONE_PROOF_INK);
        const rows = read('components/molecules/SidebarItems/style.css');
        expect(ruleBody(rows, '.sb-item')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(rows, '.sb-item.is-selected')).toMatch(/background:\s*var\(--brand-tint\)/);
        expect(hardCodedColours(rows.slice(rows.indexOf('.sb-item')))).toEqual([]);
    });

    test('a themed row drops the fixed colour classes', () => {
        const vue = template('components/molecules/SidebarItems/SidebarItems.vue');
        expect(vue).toMatch(/themed \? \['sb-item'/);
    });

    test.each([
        ['components/molecules/Assignee/Assignee.vue', "$t('Projects.list_of_user')"],
        ['components/molecules/PriorityCompo/PriorityComp.vue', "$t('Permissions.select_priorities')"],
        ['views/Projects/components/ProjectSidebars.vue', "$t('Projects.list_of_user')"],
        ['components/organisms/CreateChannelSidebar/CreateChannelSidebar.vue', "$t('Channel.create_channel')"]
    ])('%s opens its picker themed', (rel, title) => {
        const tags = template(rel).split('<Sidebar').slice(1).map((rest) => rest.split(/\/>|<template/)[0]);
        const tag = tags.find((item) => item.includes(`:title="${title}"`));
        expect(tag).toMatch(/\sthemed(\s|>)/);
    });

    test('the Create Channel form has no fixed colour', () => {
        const rel = 'components/organisms/CreateChannelSidebar/CreateChannelSidebar.vue';
        expect(hardCodedColours(withoutScript(read(rel)))).toEqual([]);
        expect(legacyClasses(rel)).toEqual([]);
    });

    test('the project toolbar opens its More menu themed', () => {
        const tag = /<DropDown\b[^>]*id="more_features"[^>]*>/.exec(template('views/Projects/components/ProjectFiltersToolbar.vue'))[0];
        expect(tag).toMatch(/\sthemed(\s|>)/);
    });
});

describe('a person\'s picture', () => {
    const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACMAAAAj/1AAAAAElFTkSuQmCC';
    const profile = async (props) => {
        const wrapper = keep(mount(UserProfile, { props: { showDot: false, width: '30px', ...props }, global: { stubs: { SkelatonVue: true } } }));
        await flushPromises();
        return wrapper;
    };

    test.each([
        ['stored as a data URL', PHOTO],
        ['served from a URL', 'https://example.com/anita.png'],
        ['missing', '']
    ])('is named after the person when it is %s', async (_, image) => {
        const wrapper = await profile({ data: { id: 'u1', title: 'Anita Desai', image } });
        expect(wrapper.get('img').attributes('alt')).toBe('Anita Desai');
    });

    test('has an empty alt when the name is written beside it', async () => {
        const wrapper = await profile({ data: { id: 'u1', title: 'Anita Desai', image: PHOTO }, decorative: true });
        expect(wrapper.get('img').attributes('alt')).toBe('');
    });

    test('never takes the tail of its data as a name', async () => {
        const wrapper = await profile({ data: { id: 'u1', image: PHOTO } });
        expect(wrapper.get('img').attributes('alt')).toBe('');
    });

    test('the people picker rows write the name beside the picture', () => {
        const tag = /<UserProfile\b[^>]*>/.exec(template('components/molecules/SidebarItems/SidebarItems.vue'))[0];
        expect(tag).toMatch(/\sdecorative(\s|\/|>)/);
    });
});

describe('names are shown as stored', () => {
    test('a folder or list row in the Convert, Merge and Move pickers does not title-case its name', () => {
        expect(ruleBody(read('components/organisms/SideBarSprintFolderData/style.css'), '.sbf__name')).not.toMatch(/text-transform/);
    });

    test.each([
        'components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue',
        'components/molecules/ConvertToList/ConvertToList.vue',
        'components/atom/DuplicateCompo/DuplicateCompo.vue',
        'components/organisms/SideBarSprintFolderData/SideBarSprintFolderData.vue'
    ])('%s does not capitalise a name', (rel) => {
        expect(classValues(template(rel)).filter((value) => /text-capitalize/.test(value))).toEqual([]);
        expect(read(rel)).not.toMatch(/text-transform:\s*capitalize/);
    });
});
