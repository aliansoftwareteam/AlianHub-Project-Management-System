import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, reactive, ref } from 'vue';
import { readFileSync } from 'fs';
import path from 'path';

const composable = vi.hoisted(() => {
    let next = 0;
    return {
        useCustomComposable: () => ({
            makeUniqueId: () => `u${++next}`,
            debounce: (fn) => fn,
            checkPermission: () => true,
            checkApps: () => true,
        }),
        useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `Name ${id}` }) }),
    };
});
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateTags: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/customFieldInputComponent/customFieldInputComponent.vue', () => ({
    default: { name: 'CustomFieldInputComponent', render: () => null },
}));
vi.mock('@formkit/vue', async () => {
    const { defineComponent: define, h } = await import('vue');
    return {
        FormKit: define({
            name: 'FormKit',
            setup: (_, { slots }) => () => h('div', { class: 'formkit-stub' }, slots.prefix ? slots.prefix() : []),
        }),
    };
});
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({
        getters: {
            'settings/allCurrencyArray': [
                { name: 'Indian Rupee', code: 'INR', isDelete: true },
                { name: 'US Dollar', code: 'USD', isDelete: true },
            ],
            'settings/projectSkills': [{ slug: 'vue', name: 'Vue' }, { slug: 'node', name: 'Node' }],
        },
        commit: vi.fn(),
        dispatch: vi.fn(),
    }),
}));

import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import Toggle from '@/components/atom/Toggle/Toggle.vue';
import MoneyComponent from '@/plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/moneyComponent.vue';
import PhoneViewColumn from '@/plugins/customFieldView/component/atom/customFieldViewColumn/phoneComponentViewColumn.vue';
import SkillsSelect from '@/components/molecules/SkillsSelect/SkillsSelect.vue';
import DropDownListComponent from '@/components/templates/Dashboard/DropDownListComponent.vue';
import CreateTagPopup from '@/components/molecules/TagList/CreateTagPopup.vue';

let width = 1280;
Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => width });
Object.defineProperty(document.body, 'clientWidth', { configurable: true, get: () => width });

const sourceOf = (file) => readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');

// The DropDown element around `marker` in a component's own template, so a call site too heavy to mount is still tested as written.
function dropDownMarkup(file, marker) {
    const text = sourceOf(file);
    const start = text.lastIndexOf('<DropDown ', text.indexOf(marker));
    const tags = /<DropDown[\s>]|<\/DropDown>/g;
    tags.lastIndex = start;
    let depth = 0;
    for (let match = tags.exec(text); match; match = tags.exec(text)) {
        depth += match[0].startsWith('</') ? -1 : 1;
        if (depth === 0) return text.slice(start, match.index + match[0].length);
    }
    throw new Error(`no DropDown around ${marker} in ${file}`);
}

const InputTextStub = { name: 'InputText', props: ['modelValue'], template: '<input type="text" class="input-text-stub">' };
const Blank = { template: '<span></span>' };

let wrapper;
const mountSite = async (component, props, global = {}) => {
    wrapper = mount(component, { props, attachTo: '#app', global });
    await flushPromises();
    return wrapper;
};
const mountMarkup = async (markup, scope, components = {}) => {
    wrapper = mount(defineComponent({
        components: { DropDown, DropDownOption, Toggle, InputText: InputTextStub, ...components },
        setup: () => scope,
        template: `<div>${markup}</div>`,
    }), { attachTo: '#app' });
    await flushPromises();
    return wrapper;
};

const triggers = () => [...document.querySelectorAll('#app [aria-haspopup]')];
const openList = async (trigger) => {
    trigger.click();
    await flushPromises();
    return document.getElementById(trigger.getAttribute('aria-controls'));
};
const press = async (el, key) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await flushPromises();
};
const optionNamed = (list, text) => [...list.querySelectorAll('[role="option"]')].find((el) => el.textContent.includes(text));

const expectAboveList = (list, selector) => {
    const fields = [...document.querySelectorAll(`#my-dropdown ${selector}`)];
    expect(fields.length).toBeGreaterThan(0);
    fields.forEach((field) => {
        expect(field.closest('.drop-down-search')).not.toBeNull();
        expect(list.contains(field)).toBe(false);
    });
};

beforeEach(() => {
    width = 1280;
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
});

describe('search fields sit above the list, outside its role element', () => {
    it('in the custom field currency picker', async () => {
        await mountSite(MoneyComponent, { tabIndex: 2, customFieldObject: { fieldMoneyName: 'US Dollar' } });
        const list = await openList(triggers().find((el) => el.textContent.includes('US Dollar')));
        expect(list.getAttribute('role')).toBe('listbox');
        expectAboveList(list, 'input.customfield__form-control');
    });

    it('in the phone column country picker', async () => {
        await mountSite(PhoneViewColumn, {
            customFieldId: 'c1',
            detail: {
                _id: 'c1',
                fieldPattern: '+1 ###',
                fieldCountryCode: '+1',
                fieldCountrySelect: ['yes'],
                fieldCountryObject: { code: 'US', dialCode: '+1', maskWithDialCode: '+1 ###' },
            },
        });
        await new Promise((resolve) => setTimeout(resolve));
        await flushPromises();
        const list = await openList(triggers()[0]);
        expectAboveList(list, 'input.customfield__form-control');
    });

    it.each([
        'plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/phoneComponent.vue',
        'plugins/customFieldView/component/atom/customFieldTaskView/phoneComponentListing.vue',
        'plugins/customFieldView/component/atom/customFieldViewColumn/phoneComponentViewColumn.vue',
        'plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/moneyComponent.vue',
    ])('in every country and currency picker of %s', (file) => {
        const text = sourceOf(file);
        const searchBlocks = text.match(/<template #search>[\s\S]*?<\/template>/g) || [];
        const inBlocks = searchBlocks.join('').match(/customfield__form-control/g) || [];
        const all = text.match(/customfield__form-control/g) || [];
        expect(all.length).toBeGreaterThan(0);
        expect(inBlocks.length).toBe(all.length);
    });

    it('in the skills picker, which takes several skills', async () => {
        await mountSite(SkillsSelect, { modelValue: ['node'] });
        const list = await openList(triggers()[0]);
        expect(list.getAttribute('aria-multiselectable')).toBe('true');
        expectAboveList(list, '.skills-select__search');
    });

    it('in the dashboard card picker, with its Select all link', async () => {
        await mountSite(DropDownListComponent, {
            id: 'status_field', isMultiSelect: true, selectedItems: ['s1'], field: { label: 'status' },
            items: [{ _id: 's1', name: 'To do' }, { _id: 's2', name: 'Done' }],
        }, { stubs: { InputText: InputTextStub, UserProfile: true, WasabiImage: true, ToolTip: true } });
        const list = await openList(triggers()[0]);
        expectAboveList(list, '.input-text-stub');
        expectAboveList(list, '.no-result');
    });

    it('in the settings custom field projects picker, with its Select all link', async () => {
        const item = reactive({ isDelete: true, global: false, projectId: ['p1'] });
        const projects = [{ _id: 'p1', ProjectName: 'Alpha' }, { _id: 'p2', ProjectName: 'Beta' }];
        await mountMarkup(dropDownMarkup('plugins/customFieldView/component/atom/settingCustomField/customFieldList.vue', 'searchProject'), {
            item, index: 0, finalCustomFieldDataTest: [item], projectList: projects, projectListSearch: projects,
            searchProject: ref(''), selectArrowMobile: '', handelSubmit: vi.fn(), handleOutsideClick: vi.fn(),
            handleChecked: vi.fn(), searchFunction: vi.fn(), selectSingleCheckbox: vi.fn(),
        }, { CheckboxComponent: Blank });
        const list = await openList(triggers()[0]);
        expect(list.getAttribute('aria-multiselectable')).toBe('true');
        expectAboveList(list, '.input-text-stub');
        expectAboveList(list, '.blue.cursor-pointer');
    });
});

describe('pickers that take several values announce it', () => {
    it('the dashboard card picker in multi mode, and not in single mode', async () => {
        const items = [{ _id: 's1', name: 'To do' }, { _id: 's2', name: 'Done' }];
        const stubs = { InputText: InputTextStub, UserProfile: true, WasabiImage: true, ToolTip: true };
        await mountSite(DropDownListComponent, { id: 'multi', isMultiSelect: true, selectedItems: ['s1'], field: { label: 'status' }, items }, { stubs });
        expect((await openList(triggers()[0])).getAttribute('aria-multiselectable')).toBe('true');
        wrapper.unmount();
        document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
        await mountSite(DropDownListComponent, { id: 'single', selectedItem: items[0], field: { label: 'status' }, items }, { stubs });
        expect((await openList(triggers()[0])).hasAttribute('aria-multiselectable')).toBe(false);
    });

    it('the time log people filter', async () => {
        const userData = Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, Employee_Name: `User ${i}`, isChecked: i === 5 }));
        await mountMarkup(dropDownMarkup('components/atom/TimesheetView/LogDetailView/LogDetailViewHeaderComponent.vue', 'timeloguser_'), {
            userData, usersFilterIDsArray: ['u5'], usersFilter: vi.fn(), makeUniqueId: () => 'x', clientWidth: 1280,
        }, { UserProfile: Blank });
        const list = await openList(triggers()[0]);
        expect(list.getAttribute('aria-multiselectable')).toBe('true');
        expect(optionNamed(list, 'User 5').getAttribute('aria-selected')).toBe('true');
    });

    it('the audio files people filter', async () => {
        const userList = reactive(Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, _id: `u${i}`, Employee_Name: `User ${i}`, isSelected: false })));
        await mountMarkup(dropDownMarkup('components/molecules/TaskAudioFiles/TaskAudioFiles.vue', "'Assignee_'"), {
            userList, user: userList[3], toggleUsers: ref(false), getDataWithUserFilter: vi.fn(),
            getUser: (id) => ({ Employee_Name: id }),
        }, { UserProfile: Blank });
        const list = await openList(triggers()[0]);
        expect(list.getAttribute('aria-multiselectable')).toBe('true');
    });
});

describe('the list view column picker', () => {
    const mountPicker = async () => {
        const headerHideShow = ref([
            { key: 'due', label: 'Due date', show: true },
            { key: 'prio', label: 'Priority', show: false },
        ]);
        const scope = {
            props: { statusIndex: 0 }, addCustomField: '', search: ref(''), handleInput: vi.fn(),
            checkPermission: () => true, checkApps: () => true, isCustomFields: () => true,
            project: {}, projectData: { isGlobalPermission: true }, headerHideShow,
            toggleButton: vi.fn(), isCustomField: ref(false), clientWidth: 1280,
        };
        await mountMarkup(dropDownMarkup('components/organisms/ItemList/ItemList.vue', 'addCustomField'), scope);
        const list = await openList(triggers()[0]);
        return { scope, list, headerHideShow };
    };

    it('keeps its search above the list and takes several columns', async () => {
        const { list } = await mountPicker();
        expectAboveList(list, 'input.customfield__form-control');
        expect(list.getAttribute('aria-multiselectable')).toBe('true');
    });

    it('toggles a column when Enter is pressed on its option', async () => {
        const { scope, list, headerHideShow } = await mountPicker();
        const priority = optionNamed(list, 'Priority');
        expect(priority.getAttribute('aria-selected')).toBe('false');
        await press(priority, 'Enter');
        expect(headerHideShow.value[1].show).toBe(true);
        expect(scope.toggleButton).toHaveBeenCalledWith(true, 'prio', headerHideShow.value[1]);
        expect(optionNamed(list, 'Priority').getAttribute('aria-selected')).toBe('true');
    });

    it('opens the custom field form when Space is pressed on "+ Custom field"', async () => {
        const { scope, list } = await mountPicker();
        await press(optionNamed(list, 'CustomField.custom_field'), ' ');
        expect(scope.isCustomField.value).toBe(true);
    });
});

describe('the sprint watchers picker', () => {
    const mountWatchers = async () => {
        const scope = {
            sprint: { watchers: ['user-1'] }, eyeIcon: '', searchWatcher: ref(''), clientWidth: 1280,
            filteredWatchers: [
                { _id: 'user-1', Employee_Name: 'Me', isWatcher: true, isLoggedUser: true },
                { _id: 'user-2', Employee_Name: 'Sam', isWatcher: true, isLoggedUser: false },
            ],
            getUser: () => ({ Employee_profileImageURL: '' }), updateWatchers: vi.fn(),
        };
        await mountMarkup(dropDownMarkup('components/organisms/SprinstList/SprintsList.vue', 'eyeIcon'), scope, { WasabiIamgeCompp: Blank });
        const list = await openList(triggers()[0]);
        return { scope, list };
    };

    it('announces that several people watch', async () => {
        const { list } = await mountWatchers();
        expect(list.getAttribute('aria-multiselectable')).toBe('true');
    });

    it('offers "stop watching" as a named button', async () => {
        const { scope, list } = await mountWatchers();
        const remove = optionNamed(list, 'Me').querySelector('button');
        expect(remove.getAttribute('type')).toBe('button');
        expect(remove.getAttribute('aria-label')).toBeTruthy();
        remove.click();
        await flushPromises();
        expect(scope.updateWatchers.mock.calls).toEqual([['user-1', 'remove']]);
        expect(optionNamed(list, 'Sam').querySelector('button')).toBeNull();
    });

    it('reaches "stop watching" with ArrowRight from your own option and runs it on Enter', async () => {
        const { scope, list } = await mountWatchers();
        const mine = optionNamed(list, 'Me');
        mine.focus();
        await press(mine, 'ArrowRight');
        expect(document.activeElement).toBe(mine.querySelector('button'));
        await press(document.activeElement, 'Enter');
        expect(scope.updateWatchers.mock.calls).toEqual([['user-1', 'remove']]);
        await press(document.activeElement, 'ArrowLeft');
        expect(document.activeElement).toBe(mine);
    });

    it('stops watching when Delete is pressed on your own option', async () => {
        const { scope, list } = await mountWatchers();
        await press(optionNamed(list, 'Me'), 'Delete');
        await press(optionNamed(list, 'Sam'), 'Delete');
        expect(scope.updateWatchers.mock.calls).toEqual([['user-1', 'remove']]);
    });
});

describe('the per-tag actions in the tag picker', () => {
    const tag = (uid, tagName) => ({ uid, tagName, tagColor: '#2f3990', tagBgColor: '#2f399035' });
    const props = {
        task: { _id: 't1', sprintId: 's1', TaskName: 'Ship it', tagsArray: ['a'] },
        project: { _id: 'p1', isGlobalPermission: true, tagsArray: [tag('a', 'Alpha'), tag('b', 'Beta'), tag('c', 'Gamma')] },
    };
    const stubs = { ConfirmationSidebar: true, InputText: true, SpinnerComp: true, TagChip: true };

    it('open from a focusable dots button on each tag', async () => {
        await mountSite(CreateTagPopup, props, { stubs });
        await openList(document.querySelector('[aria-haspopup="listbox"]'));
        const actions = [...document.querySelectorAll('#my-dropdown [aria-haspopup="menu"]')];
        expect(actions).toHaveLength(2);
        actions.forEach((button) => {
            expect(button.tagName).toBe('BUTTON');
            expect(button.hidden).toBe(false);
            expect(button.getAttribute('aria-label')).toContain('Tags.tag_actions');
            expect(button.querySelector('img')).not.toBeNull();
        });
        expect(new Set(actions.map((button) => button.id)).size).toBe(2);
        const menu = await openList(actions[1]);
        expect(menu.getAttribute('role')).toBe('menu');
        expect(actions[1].getAttribute('aria-expanded')).toBe('true');
    });

    it('reach the dots button with ArrowRight from its tag and open the menu on Enter', async () => {
        await mountSite(CreateTagPopup, props, { stubs });
        await openList(document.querySelector('[aria-haspopup="listbox"]'));
        const beta = [...document.querySelectorAll('#my-dropdown [role="option"]')].find((el) => el.textContent.includes('Beta'));
        const dots = beta.querySelector('[aria-haspopup="menu"]');
        beta.focus();
        await press(beta, 'ArrowRight');
        expect(document.activeElement).toBe(dots);
        await press(dots, 'Enter');
        expect(dots.getAttribute('aria-expanded')).toBe('true');
    });
});
