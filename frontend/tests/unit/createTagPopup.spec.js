import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const perm = vi.hoisted(() => ({ tagsApp: true, allowed: true }));
const api = vi.hoisted(() => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
const ops = vi.hoisted(() => ({ updateTags: vi.fn(() => Promise.resolve()), onUpdate: null }));
const ids = vi.hoisted(() => ({ next: 0 }));

vi.mock('@/services', () => api);
vi.mock('@/utils/TaskOperations', () => ({ default: ops }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        makeUniqueId: () => `id${++ids.next}`,
        checkApps: () => perm.tagsApp,
        checkPermission: () => perm.allowed
    })
}));

import CreateTagPopup from '@/components/molecules/TagList/CreateTagPopup.vue';

const source = readFileSync(resolve(__dirname, '../../src/components/molecules/TagList/CreateTagPopup.vue'), 'utf8');
const OpenDropDown = {
    name: 'DropDown',
    emits: ['isVisible'],
    template: '<div class="dd" @click="$emit(\'isVisible\', true)"><slot name="button" /><slot name="head" /><slot name="options" /></div>'
};
const ConfirmStub = {
    name: 'ConfirmationSidebar',
    props: ['modelValue', 'title', 'message', 'acceptButton'],
    emits: ['confirm', 'update:modelValue'],
    template: '<div class="confirm" v-if="modelValue"><b class="c-title">{{ title }}</b><i class="c-msg">{{ message }}</i><button class="c-ok" @click="$emit(\'confirm\')">{{ acceptButton }}</button></div>'
};

const tagOf = (uid, tagName, tagColor = '#2f3990') => ({ uid, tagName, tagColor, tagBgColor: `${tagColor}35` });
const makeProject = (tags) => reactive({ _id: 'p1', isGlobalPermission: true, tagsArray: tags });
const makeTask = (tagsArray = []) => reactive({ _id: 't1', sprintId: 's1', TaskName: 'Write notes', tagsArray });

const mountPopup = (props = {}) => mount(CreateTagPopup, {
    props: { task: makeTask(), project: makeProject([tagOf('a', 'Alpha'), tagOf('b', 'Beta'), tagOf('g', 'Gamma')]), ...props },
    global: { stubs: { DropDown: OpenDropDown, ConfirmationSidebar: ConfirmStub } }
});
const optionNames = (wrapper) => wrapper.findAll('.taglist-options .tag_name').map((n) => n.text());
const chipNames = (wrapper) => wrapper.findAll('.chipDiv-wrapper .tagname').map((n) => n.text());
const searchBox = (wrapper) => wrapper.get('.tagInputwrapper input');
const type = async (input, text, keyCode) => {
    await input.setValue(text);
    await input.trigger('keyup', { keyCode: keyCode || 65 });
};
const rowOf = (wrapper, name) => wrapper.findAll('.taglist_option--item').find((r) => r.text().includes(name));
const openActions = async (wrapper, name) => {
    const row = rowOf(wrapper, name);
    await row.get('[data-option-action]').trigger('click');
    return row;
};
const menuItem = (row, label) => row.findAll('li[role="menuitem"]').find((li) => li.text() === label);

beforeEach(() => {
    perm.tagsApp = true;
    perm.allowed = true;
    api.apiRequest.mockClear();
    ops.updateTags.mockReset();
    ops.updateTags.mockImplementation(() => Promise.resolve());
});

describe('CreateTagPopup labels', () => {
    it('names the add button and the search field from i18n keys', () => {
        const wrapper = mountPopup();
        expect(wrapper.get('button.taglist__add-btn').attributes('aria-label')).toBe('Tags.add_tag');
        expect(searchBox(wrapper).attributes('placeholder')).toBe('Tags.search_or_create_new');
    });

    it('gives each tag a actions button labelled from i18n', () => {
        const wrapper = mountPopup();
        const buttons = wrapper.findAll('[data-option-action]');
        expect(buttons).toHaveLength(3);
        expect(buttons.every((b) => b.attributes('aria-label') === 'Tags.tag_actions')).toBe(true);
    });

    it('has no text, title or placeholder in its template that bypasses i18n', () => {
        const template = source.slice(0, source.indexOf('<script'));
        const bareText = [...template.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1].trim()).filter(Boolean);
        expect(bareText).toEqual([]);
        const attrs = [...template.matchAll(/\s(?:title|placeholder|alt|aria-label)="([^"]+)"/g)].map((m) => m[1]);
        expect(attrs).toEqual([]);
    });
});

describe('CreateTagPopup lists', () => {
    it('lists unassigned tags by name and the task tags as chips', () => {
        const wrapper = mountPopup({ task: makeTask(['b']) });
        expect(optionNames(wrapper)).toEqual(['Alpha', 'Gamma']);
        expect(chipNames(wrapper)).toEqual(['Beta']);
    });

    it('sorts the options by name regardless of the order they arrive in', () => {
        const wrapper = mountPopup({ project: makeProject([tagOf('g', 'gamma'), tagOf('a', 'Alpha'), tagOf('b', 'beta')]) });
        expect(optionNames(wrapper)).toEqual(['Alpha', 'beta', 'gamma']);
    });

    it('says there are no tags when the project has none', () => {
        const wrapper = mountPopup({ project: makeProject([]) });
        expect(wrapper.get('.tag-instruct-text').text()).toBe('Tags.no_tags_found');
        expect(optionNames(wrapper)).toEqual([]);
    });

    it('does not claim there are no tags when every tag is already on the task', () => {
        const wrapper = mountPopup({ project: makeProject([tagOf('a', 'Alpha')]), task: makeTask(['a']) });
        expect(wrapper.find('.tag-instruct-text').exists()).toBe(false);
        expect(chipNames(wrapper)).toEqual(['Alpha']);
    });

    it('copes with a project that has no tag list at all', () => {
        const wrapper = mountPopup({ project: reactive({ _id: 'p1', isGlobalPermission: true }) });
        expect(wrapper.get('.tag-instruct-text').text()).toBe('Tags.no_tags_found');
    });

    it('reports the chips and ids to its parent', () => {
        const wrapper = mountPopup({ task: makeTask(['b']) });
        expect(wrapper.emitted('send:tagChipArray')[0][0].map((t) => t.tagName)).toEqual(['Beta']);
        expect(wrapper.emitted('send:ids')[0][0]).toMatchObject({ companyId: 'company-1', projectId: 'p1', sprintId: 's1', taskId: 't1' });
    });
});

describe('CreateTagPopup gating', () => {
    it('hides the add button and the row actions without the tag permission', () => {
        perm.allowed = false;
        const wrapper = mountPopup();
        expect(wrapper.get('button.taglist__add-btn').attributes('style')).toContain('display: none');
        expect(wrapper.find('[data-option-action]').exists()).toBe(false);
        expect(optionNames(wrapper)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('treats a permission that is not exactly true as no permission', () => {
        perm.allowed = 'partial';
        expect(mountPopup().get('button.taglist__add-btn').attributes('style')).toContain('display: none');
    });

    it('hides the tags area and blocks pointer use when the tags app is off', () => {
        perm.tagsApp = false;
        const wrapper = mountPopup();
        expect(wrapper.find('.chipDiv-wrapper').exists()).toBe(false);
        expect(wrapper.get('button.taglist__add-btn').attributes('style')).toContain('display: none');
        expect(wrapper.classes()).toContain('pointer-none');
    });

    it('stops offering new tags in a task list row that already has three', () => {
        const wrapper = mountPopup({ isTaskList: true, task: makeTask(['a', 'b', 'g']) });
        expect(wrapper.get('button.taglist__add-btn').attributes('style')).toContain('display: none');
        expect(wrapper.classes()).toContain('pointer-none');
    });

    it('still offers the button in a task list row with fewer than three', () => {
        const wrapper = mountPopup({ isTaskList: true, task: makeTask(['a']) });
        expect(wrapper.get('button.taglist__add-btn').attributes('style') || '').not.toContain('display: none');
        expect(wrapper.classes()).not.toContain('pointer-none');
    });
});

describe('CreateTagPopup search and create', () => {
    it('narrows the options as the person types and shows the hint', async () => {
        const wrapper = mountPopup();
        await type(searchBox(wrapper), 'ga');
        expect(optionNames(wrapper)).toEqual(['Gamma']);
        expect(wrapper.get('.tag-instruct-text').text()).toBe('Tags.note_msg');
    });

    it('shows nothing but the hint when no tag matches', async () => {
        const wrapper = mountPopup();
        await type(searchBox(wrapper), 'zzz');
        expect(optionNames(wrapper)).toEqual([]);
        expect(wrapper.get('.tag-instruct-text').text()).toBe('Tags.note_msg');
    });

    it('creates a tag on Enter, lists it and clears the field', async () => {
        const wrapper = mountPopup();
        await type(searchBox(wrapper), '  Fresh ');
        await searchBox(wrapper).trigger('keyup', { keyCode: 13 });
        await flushPromises();
        expect(optionNames(wrapper)).toContain('Fresh');
        expect(searchBox(wrapper).element.value).toBe('');
        expect(wrapper.find('.tagInputwrapper h5').exists()).toBe(false);
    });

    it('puts the new tag on the task as well', async () => {
        const task = makeTask();
        ops.updateTags.mockImplementation(({ tagId }) => { task.tagsArray.push(tagId); return Promise.resolve(); });
        const wrapper = mountPopup({ task });
        await type(searchBox(wrapper), 'Fresh');
        await searchBox(wrapper).trigger('keyup', { keyCode: 13 });
        await flushPromises();
        expect(chipNames(wrapper)).toEqual(['Fresh']);
        expect(optionNames(wrapper)).not.toContain('Fresh');
    });

    it('rejects a name that already exists, whatever its case', async () => {
        const wrapper = mountPopup();
        await type(searchBox(wrapper), 'ALPHA');
        await searchBox(wrapper).trigger('keyup', { keyCode: 13 });
        expect(wrapper.get('.tagInputwrapper h5').text()).toBe('Tags.This_tag_has_already_been_added');
        expect(optionNames(wrapper)).toEqual(['Alpha']);
    });

    it('rejects a name that is only spaces', async () => {
        const wrapper = mountPopup();
        await type(searchBox(wrapper), '   ');
        await searchBox(wrapper).trigger('keyup', { keyCode: 13 });
        expect(wrapper.get('.tagInputwrapper h5').text()).toBe('Tags.Tag_name_required');
    });

    it('clears the error as soon as typing continues', async () => {
        const wrapper = mountPopup();
        await type(searchBox(wrapper), 'alpha');
        await searchBox(wrapper).trigger('keyup', { keyCode: 13 });
        await type(searchBox(wrapper), 'alphab');
        expect(wrapper.find('.tagInputwrapper h5').exists()).toBe(false);
    });

    it('resets the search and any error when the menu closes', async () => {
        const wrapper = mountPopup();
        await type(searchBox(wrapper), 'alpha');
        await searchBox(wrapper).trigger('keyup', { keyCode: 13 });
        await wrapper.findComponent({ name: 'DropDown' }).vm.$emit('isVisible', false);
        expect(searchBox(wrapper).element.value).toBe('');
        expect(wrapper.find('.tagInputwrapper h5').exists()).toBe(false);
        expect(wrapper.emitted('send:dropvisible').pop()).toEqual([false]);
    });
});

describe('CreateTagPopup choosing a tag', () => {
    it('moves a clicked option into the chips', async () => {
        const task = makeTask();
        ops.updateTags.mockImplementation(({ tagId }) => { task.tagsArray.push(tagId); return Promise.resolve(); });
        const wrapper = mountPopup({ task });
        await wrapper.findAll('[role="option"]')[1].trigger('click');
        await flushPromises();
        expect(chipNames(wrapper)).toEqual(['Beta']);
        expect(optionNames(wrapper)).toEqual(['Alpha', 'Gamma']);
    });
});

describe('CreateTagPopup row actions', () => {
    it('offers rename, change colour and delete by their i18n keys', async () => {
        const wrapper = mountPopup();
        const row = await openActions(wrapper, 'Alpha');
        expect(row.findAll('li[role="menuitem"]').map((li) => li.text())).toEqual(['Projects.rename', 'Tags.change_color', 'Projects.delete']);
    });

    it('renames a tag in place from the rename field', async () => {
        const wrapper = mountPopup();
        const row = await openActions(wrapper, 'Beta');
        await menuItem(row, 'Projects.rename').trigger('click');
        const input = wrapper.get('.edit__status-key input');
        expect(input.attributes('placeholder')).toBe('Projects.Rename Tag');
        await input.trigger('focus');
        await input.setValue('Bravo');
        await input.trigger('keyup', { keyCode: 13 });
        await flushPromises();
        expect(wrapper.find('.edit__status-key input').exists()).toBe(false);
        expect(optionNames(wrapper)).toEqual(['Alpha', 'Bravo', 'Gamma']);
    });

    it('refuses to rename onto an existing name', async () => {
        const wrapper = mountPopup();
        const row = await openActions(wrapper, 'Beta');
        await menuItem(row, 'Projects.rename').trigger('click');
        const input = wrapper.get('.edit__status-key input');
        await input.trigger('focus');
        await input.setValue('gamma');
        await input.trigger('keyup', { keyCode: 13 });
        expect(wrapper.get('h5.red').text()).toBe('Tags.This_tag_has_already_been_added');
    });

    it('closes the rename field when the name is unchanged', async () => {
        const wrapper = mountPopup();
        const row = await openActions(wrapper, 'Beta');
        await menuItem(row, 'Projects.rename').trigger('click');
        const input = wrapper.get('.edit__status-key input');
        await input.trigger('focus');
        await input.setValue('beta');
        await input.trigger('keyup', { keyCode: 13 });
        expect(wrapper.find('.edit__status-key input').exists()).toBe(false);
        expect(optionNames(wrapper)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    // Rename uses the row index of the filtered list to write into the unfiltered one.
    it.fails('renames the tag that was picked, not the one at the same position, while a search is active', async () => {
        const wrapper = mountPopup();
        await type(searchBox(wrapper), 'gam');
        const row = await openActions(wrapper, 'Gamma');
        await menuItem(row, 'Projects.rename').trigger('click');
        const input = wrapper.get('.edit__status-key input');
        await input.trigger('focus');
        await input.setValue('Omega');
        await input.trigger('keyup', { keyCode: 13 });
        await type(searchBox(wrapper), '');
        expect(optionNames(wrapper)).toEqual(['Alpha', 'Beta', 'Omega']);
    });

    it('changes the colour of an option on save', async () => {
        const wrapper = mountPopup();
        const before = rowOf(wrapper, 'Alpha').get('.tag_name').attributes('style');
        const row = await openActions(wrapper, 'Alpha');
        await menuItem(row, 'Tags.change_color').trigger('click');
        expect(wrapper.get('.changeColorTextTagName').text()).toBe('Alpha');
        await wrapper.get('input[type="color"]').setValue('#ff0000');
        await wrapper.get('.saveTagColorImage').trigger('click');
        expect(wrapper.find('input[type="color"]').exists()).toBe(false);
        expect(rowOf(wrapper, 'Alpha').get('.tag_name').attributes('style')).not.toBe(before);
    });

    it('keeps the colour on cancel', async () => {
        const wrapper = mountPopup();
        const before = rowOf(wrapper, 'Alpha').get('.tag_name').attributes('style');
        const row = await openActions(wrapper, 'Alpha');
        await menuItem(row, 'Tags.change_color').trigger('click');
        await wrapper.get('input[type="color"]').setValue('#ff0000');
        await wrapper.get('.deleteTagImage').trigger('click');
        expect(rowOf(wrapper, 'Alpha').get('.tag_name').attributes('style')).toBe(before);
    });

    // Save and cancel are click-only images with no alt text, unreachable by keyboard and unnamed.
    it.fails('makes the colour save and cancel controls named buttons', async () => {
        const wrapper = mountPopup();
        const row = await openActions(wrapper, 'Alpha');
        await menuItem(row, 'Tags.change_color').trigger('click');
        const controls = [wrapper.get('.saveTagColorImage'), wrapper.get('.deleteTagImage')];
        expect(controls.every((c) => c.element.closest('button') && (c.attributes('alt') || c.element.closest('button').getAttribute('aria-label')))).toBe(true);
    });

    it('asks before deleting, then drops the tag from the list', async () => {
        const project = makeProject([tagOf('a', 'Alpha'), tagOf('b', 'Beta')]);
        const wrapper = mountPopup({ project });
        const row = await openActions(wrapper, 'Alpha');
        await menuItem(row, 'Projects.delete').trigger('click');
        expect(wrapper.get('.c-title').text()).toBe('Tags.delete_tag');
        expect(wrapper.get('.c-msg').text()).toBe('Tags.delete_tag_desc');
        await wrapper.get('.c-ok').trigger('click');
        await flushPromises();
        expect(wrapper.find('.confirm').exists()).toBe(false);
        expect(project.tagsArray.map((t) => t.uid)).toEqual(['b']);
        expect(optionNames(wrapper)).toEqual(['Beta']);
    });
});
