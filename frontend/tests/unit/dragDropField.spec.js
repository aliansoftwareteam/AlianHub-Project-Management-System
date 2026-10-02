import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('@/composable', () => ({ useCustomComposable: () => ({ makeUniqueId: () => 'key' }) }));

import DragDropField from '@/components/atom/DragDropField/DragDropField.vue';

// Renders the item slot per element and exposes the props the real library would receive.
const Draggable = defineComponent({
    name: 'DraggableStub',
    props: ['modelValue', 'handle', 'group', 'move', 'itemKey', 'tag'],
    emits: ['update:modelValue', 'change'],
    setup(props, { slots }) {
        return () => h('ul', { class: 'dd-stub', 'data-handle': props.handle, 'data-group': props.group }, (props.modelValue || []).map((element, index) => slots.item({ element, index })));
    },
});
const DropDown = defineComponent({
    name: 'DropDown',
    setup: (_, { slots }) => () => h('div', { class: 'dd-menu' }, [slots.button?.({ triggerAttrs: {} }), slots.options?.()]),
});
const DropDownOption = defineComponent({ name: 'DropDownOption', setup: (_, { slots }) => () => h('div', { class: 'dd-option', role: 'menuitem' }, slots.default?.()) });

const mountField = (props = {}) => mount(DragDropField, {
    props: { modelValue: [{ name: 'Todo', key: 'a' }, { name: 'Done', key: 'b', default: true }], group: { name: 'g' }, ...props },
    global: { stubs: { draggable: Draggable, DropDown, DropDownOption, TaskTypeIcon: { template: '<i class="type-icon" />' } } },
});

describe('DragDropField status list', () => {
    it('shows each item name with an i18n drag-to-reorder title and the status handle', () => {
        const w = mountField({ group: { name: 'statuses' } });
        expect(w.findAll('li')).toHaveLength(2);
        expect(w.findAll('li')[0].text()).toContain('Todo');
        expect(w.find('.drag-image-wrapper').attributes('title')).toBe('Projects.form_drag_to_reorder');
        expect(w.find('.dd-stub').attributes('data-handle')).toBe('.drag-image-wrapper');
        expect(w.find('.dd-stub').attributes('data-group')).toBe('statuses');
    });

    it('lists nothing for an empty list', () => {
        expect(mountField({ modelValue: [] }).findAll('li')).toHaveLength(0);
    });

    it('offers remove only on non-default items when deletable, and emits the item', async () => {
        const w = mountField({ isDeletable: true });
        const items = w.findAll('li');
        expect(items[0].find('.dd-option').text()).toBe('Templates.remove');
        expect(items[1].find('.dd-option').exists()).toBe(false);
        await items[0].find('.dd-option').trigger('click');
        expect(w.emitted('input:deleteFieldValue')[0][0]).toMatchObject({ name: 'Todo' });
    });

    it('the three-dot trigger is a real button labelled from i18n', () => {
        const w = mountField();
        const btn = w.find('button.dot-btn');
        expect(btn.attributes('type')).toBe('button');
        expect(btn.find('img').attributes('alt')).toBe('Templates.item_actions');
    });

    it('colour picker is rendered but disabled, and only for items with a text colour', () => {
        const w = mountField({ modelValue: [{ name: 'A', textColor: '#ff0000' }, { name: 'B' }] });
        expect(w.findAll('input[type="color"]')).toHaveLength(1);
        expect(w.find('input[type="color"]').attributes('disabled')).toBeDefined();
    });

    it('clicking the type icon asks to upload an image for that item', async () => {
        const w = mountField();
        await w.find('.type-icon').trigger('click');
        expect(w.emitted('click:uploadImage')).toHaveLength(1);
        expect(w.emitted('click:ImageItem')[0][0]).toMatchObject({ name: 'Todo' });
    });

    it('hides the type icon while recolouring', () => {
        expect(mountField({ isChangeColor: true }).find('.type-icon').exists()).toBe(false);
    });
});

describe('DragDropField task types', () => {
    it('uses the grip handle and only shows the menu when more than one type exists', () => {
        const w = mountField({ from: 'task_type', isDeletable: true });
        expect(w.find('.drag-handle').attributes('title')).toBe('Projects.form_drag_to_reorder');
        expect(w.find('.dd-stub').attributes('data-handle')).toBe('.drag-handle');
        expect(w.findAll('.dd-option')).toHaveLength(1);
        const single = mountField({ from: 'task_type', isDeletable: true, modelValue: [{ name: 'Bug' }] });
        expect(single.find('.dd-option').exists()).toBe(false);
    });
});

describe('DragDropField inline editing', () => {
    const editable = () => [{ name: 'Draft', isEditable: true }];

    it('shows an input instead of the label', () => {
        const w = mountField({ modelValue: editable(), categoryTytpe: 'status' });
        expect(w.find('input.edit-input').element.value).toBe('Draft');
        expect(w.find('.drag-image-wrapper').exists()).toBe(false);
    });

    it('Enter commits with the category and re-enables the button; typing resets the error', async () => {
        const w = mountField({ modelValue: editable(), categoryTytpe: 'status' });
        const input = w.find('input.edit-input');
        await input.trigger('input');
        expect(w.emitted('resetTaskTypeErr')).toHaveLength(1);
        await input.trigger('keypress', { key: 'Enter' });
        expect(w.emitted('enter:updateFieldValue')[0][1]).toBe('status');
        expect(w.emitted('disbaleButton')[0]).toEqual([false]);
    });

    it('the tick saves and the cross cancels editing', async () => {
        const w = mountField({ modelValue: editable(), categoryTytpe: 'status' });
        const [save, cancel] = w.findAll('img.cursor-pointer');
        await save.trigger('click');
        expect(w.emitted('click:updateFieldValue')).toHaveLength(1);
        await cancel.trigger('click');
        expect(w.emitted('resetTaskTypeErr')).toHaveLength(1);
        expect(w.find('input.edit-input').exists()).toBe(false);
    });

    it('stops editing when a new status or template starts', async () => {
        const data = editable();
        const w = mountField({ modelValue: data });
        await w.setProps({ addTaskType: true });
        expect(data[0].isEditable).toBe(false);
    });
});

describe('DragDropField required props', () => {
    // template reads group.name but group has no default, so omitting it throws on render
    it.fails('renders when the optional group prop is omitted', () => {
        const w = mount(DragDropField, { props: { modelValue: [{ name: 'Todo' }] }, global: { stubs: { draggable: Draggable, DropDown, DropDownOption } } });
        expect(w.findAll('li')).toHaveLength(1);
    });
});

describe('DragDropField i18n', () => {
    const src = readFileSync(resolve(__dirname, '../../src/components/atom/DragDropField/DragDropField.vue'), 'utf8');
    const tpl = src.slice(0, src.indexOf('<script'));

    it('has no bare title, placeholder or aria-label', () => {
        expect(tpl.match(/\s(?::)?(?:title|placeholder|aria-label)="[^"$]+"/g) || []).toEqual([]);
    });

    // alt="drag" on the grip image is shown to screen readers and is not translated
    it.fails('has no bare alt text', () => {
        expect(tpl.match(/\salt="[^"]+"/g) || []).toEqual([]);
    });
});
