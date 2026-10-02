import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const perm = vi.hoisted(() => ({ allowed: true }));
const api = vi.hoisted(() => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
const ops = vi.hoisted(() => ({ updateTags: vi.fn(() => Promise.resolve()) }));

vi.mock('@/services', () => api);
vi.mock('@/utils/TaskOperations', () => ({ default: ops }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ makeUniqueId: () => 'u1', checkApps: () => true, checkPermission: () => perm.allowed })
}));

import TagChip from '@/components/atom/TagChip/TagChip.vue';

const source = readFileSync(resolve(__dirname, '../../src/components/atom/TagChip/TagChip.vue'), 'utf8');
const OpenDropDown = { name: 'DropDown', template: '<div class="dd"><slot name="button" /><slot name="options" /></div>' };
const ConfirmStub = {
    name: 'ConfirmationSidebar',
    props: ['modelValue', 'title', 'message', 'acceptButton'],
    emits: ['confirm'],
    template: '<div class="confirm" v-if="modelValue"><b class="c-title">{{ title }}</b><i class="c-msg">{{ message }}</i><button class="c-ok" @click="$emit(\'confirm\')">{{ acceptButton }}</button></div>'
};

const tag = () => ({ uid: 'tg1', tagName: 'Urgent', tagColor: '#2f3990', tagBgColor: '#2f399035' });
const other = { uid: 'tg2', tagName: 'Later', tagColor: '#ff0000', tagBgColor: '#ff000035' };
const ids = { companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't1', tagsArray: ['tg1'] };

const mountChip = (props = {}) => {
    const data = props.data || tag();
    return mount(TagChip, {
        props: { data, ids, tagsArray: [data, other], taskId: 't1', sprintId: 's1', ...props },
        global: { stubs: { DropDown: OpenDropDown, ConfirmationSidebar: ConfirmStub } }
    });
};
const key = (el, keyCode) => el.trigger('keyup', { keyCode });
const menuItem = (wrapper, label) => wrapper.findAll('li[role="menuitem"]').find((li) => li.text() === label);

beforeEach(() => {
    perm.allowed = true;
    api.apiRequest.mockClear();
    ops.updateTags.mockClear();
});

describe('TagChip display', () => {
    it('shows the tag name and uses it as the hover title', () => {
        const name = mountChip().get('.tagname');
        expect(name.text()).toBe('Urgent');
        expect(name.attributes('title')).toBe('Urgent');
    });

    it('draws a border in the tag colour only when asked to', () => {
        expect(mountChip({ isBorder: true }).get('.tagListContent').element.style.borderColor).not.toBe('');
        expect(mountChip({ isBorder: false }).get('.tagListContent').element.style.border).toMatch(/^0/);
    });

    it('keeps the menu, remove cross and delete dialog away from a read-only chip', () => {
        const wrapper = mountChip({ readonly: true });
        expect(wrapper.find('.tagname').text()).toBe('Urgent');
        expect(wrapper.find('.dd').exists()).toBe(false);
        expect(wrapper.find('.tagHover__icon-close').exists()).toBe(false);
        expect(wrapper.find('.confirm').exists()).toBe(false);
        expect(wrapper.get('.tagListContent').classes()).toContain('remove_hover');
    });

    it('does the same for a person without the tag permission', () => {
        perm.allowed = false;
        const wrapper = mountChip();
        expect(wrapper.find('.tagHover__icon-close').exists()).toBe(false);
        expect(wrapper.find('.dd').exists()).toBe(false);
        expect(wrapper.get('.tagListContent').classes()).toContain('remove_hover');
    });

    it('treats a permission that is not exactly true as no permission', () => {
        perm.allowed = 'partial';
        expect(mountChip().find('.tagHover__icon-close').exists()).toBe(false);
    });
});

describe('TagChip menu labels', () => {
    it('lists rename, change colour and delete by their i18n keys', () => {
        const wrapper = mountChip();
        expect(wrapper.findAll('li[role="menuitem"]').map((li) => li.text())).toEqual(['Projects.rename', 'Tags.change_color', 'Projects.delete']);
        expect(wrapper.get('.tagHover__icon').attributes('alt')).toBe('Tags.tag_actions');
    });
});

describe('TagChip rename', () => {
    const startRename = async (wrapper) => {
        await menuItem(wrapper, 'Projects.rename').trigger('click');
        return wrapper.get('input.form-control');
    };

    it('swaps the chip for a field with the i18n placeholder', async () => {
        const wrapper = mountChip();
        const input = await startRename(wrapper);
        expect(input.attributes('placeholder')).toBe('PlaceHolder.Rename_Tag');
        expect(wrapper.find('.tagListContent').exists()).toBe(false);
    });

    it('renames on Enter and shows the new name on the chip', async () => {
        const wrapper = mountChip();
        const input = await startRename(wrapper);
        await input.setValue('Blocker');
        await key(input, 13);
        expect(wrapper.find('input.form-control').exists()).toBe(false);
        expect(wrapper.get('.tagname').text()).toBe('Blocker');
    });

    it('refuses a name another tag already has and says so with an i18n key', async () => {
        const wrapper = mountChip();
        const input = await startRename(wrapper);
        await input.setValue('later');
        await key(input, 13);
        expect(wrapper.get('.error').text()).toBe('Tags.This_tag_has_already_been_added');
        expect(wrapper.find('input.form-control').exists()).toBe(true);
    });

    it('refuses an empty name', async () => {
        const wrapper = mountChip();
        const input = await startRename(wrapper);
        await input.setValue('');
        await key(input, 13);
        expect(wrapper.get('.error').text()).toBe('Tags.Tag_name_required');
    });

    it('just closes the field when the name is unchanged', async () => {
        const wrapper = mountChip();
        const input = await startRename(wrapper);
        await input.setValue('urgent');
        await key(input, 13);
        expect(wrapper.find('input.form-control').exists()).toBe(false);
        expect(wrapper.get('.tagname').text()).toBe('Urgent');
        expect(wrapper.find('.error').exists()).toBe(false);
    });

    it('leaves the field on blur without renaming', async () => {
        const wrapper = mountChip();
        const input = await startRename(wrapper);
        await input.setValue('Other');
        await input.trigger('blur');
        expect(wrapper.find('input.form-control').exists()).toBe(false);
        expect(wrapper.get('.tagname').text()).toBe('Urgent');
    });

    // Escape is the usual way out of an inline field; here only blur leaves it.
    it.fails('leaves the rename field on Escape', async () => {
        const wrapper = mountChip();
        const input = await startRename(wrapper);
        await input.trigger('keyup', { key: 'Escape', keyCode: 27 });
        expect(wrapper.find('input.form-control').exists()).toBe(false);
    });
});

describe('TagChip colour change', () => {
    const startColour = async (wrapper) => {
        await menuItem(wrapper, 'Tags.change_color').trigger('click');
        return wrapper.get('input[type="color"]');
    };

    it('offers a colour input next to the chip', async () => {
        const wrapper = mountChip();
        const input = await startColour(wrapper);
        expect(input.exists()).toBe(true);
        expect(wrapper.get('.tagname').text()).toBe('Urgent');
    });

    it('applies the picked colour on save and closes the picker', async () => {
        const wrapper = mountChip();
        const input = await startColour(wrapper);
        await input.setValue('#00ff00');
        await wrapper.get('.save_img').trigger('click');
        expect(wrapper.find('input[type="color"]').exists()).toBe(false);
        expect(wrapper.get('.tagListContent').element.style.background).toContain('0, 255, 0');
    });

    it('keeps the old colour on cancel', async () => {
        const wrapper = mountChip();
        const input = await startColour(wrapper);
        await input.setValue('#00ff00');
        await wrapper.findAll('.color-edit_img')[1].trigger('click');
        expect(wrapper.find('input[type="color"]').exists()).toBe(false);
        expect(wrapper.get('.tagListContent').element.style.background).not.toContain('0, 255, 0');
    });
});

describe('TagChip delete', () => {
    it('asks first, using i18n keys, and then removes the tag from the project list', async () => {
        const data = tag();
        const list = [data, other];
        const wrapper = mountChip({ data, tagsArray: list });
        expect(wrapper.find('.confirm').exists()).toBe(false);
        await menuItem(wrapper, 'Projects.delete').trigger('click');
        expect(wrapper.get('.c-title').text()).toBe('Tags.delete_tag');
        expect(wrapper.get('.c-msg').text()).toBe('Tags.delete_tag_desc');
        expect(wrapper.get('.c-ok').text()).toBe('Projects.delete');
        await wrapper.get('.c-ok').trigger('click');
        await flushPromises();
        expect(wrapper.find('.confirm').exists()).toBe(false);
        expect(list.map((t) => t.uid)).toEqual(['tg2']);
    });
});

describe('TagChip remove from task', () => {
    // The cross is a bare <img> with a click handler and empty alt: no keyboard access, no name.
    it.fails('makes the remove cross a named, keyboard-reachable control', () => {
        const cross = mountChip().get('.tagHover__icon-close');
        const control = cross.element.closest('button') || cross.element;
        expect(control.tagName === 'BUTTON' || control.getAttribute('tabindex') === '0').toBe(true);
        expect(cross.attributes('alt') || cross.attributes('aria-label')).toBeTruthy();
    });
});

describe('TagChip template text', () => {
    it('has no visible text, title or placeholder that bypasses i18n', () => {
        const template = source.slice(0, source.indexOf('<script'));
        const bareText = [...template.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1].trim()).filter(Boolean);
        expect(bareText).toEqual([]);
        const attrs = [...template.matchAll(/\s(?:title|placeholder|alt|aria-label)="([^"]+)"/g)].map((m) => m[1]);
        expect(attrs).toEqual([]);
    });
});
