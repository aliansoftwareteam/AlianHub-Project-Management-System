import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

const composable = vi.hoisted(() => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/components/atom/TaskTypeSelection/TaskTypeSelection.vue', () => ({
    default: defineComponent({ name: 'TaskTypeSelection', setup: () => () => h('span') })
}));

import TaskDetailTitle from '@/components/molecules/TaskDetailTitle/TaskDetailTitle.vue';

const mounted = [];
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

async function editTitle() {
    const wrapper = mount(TaskDetailTitle, {
        props: { taskName: 'Write the brief', taskType: 1 },
        attachTo: document.body,
        global: { provide: { showArchived: ref(false), selectedProject: ref({ isGlobalPermission: true, taskTypeCounts: [] }) } }
    });
    mounted.push(wrapper);
    await wrapper.find('.title-name__edit').trigger('click');
    await flushPromises();
    const input = wrapper.find('#taskNameEdit');
    expect(document.activeElement).toBe(input.element);
    return { wrapper, input };
}

const titleButton = (wrapper) => wrapper.find('.title-name__edit').element;

describe('task title rename focus (A11Y-O7)', () => {
    it('returns focus to the title button after saving with Enter', async () => {
        const { wrapper, input } = await editTitle();
        await input.setValue('Write the final brief');
        await input.trigger('keypress', { key: 'Enter' });
        await flushPromises();
        expect(wrapper.emitted('update:taskName')).toEqual([['Write the final brief']]);
        expect(document.activeElement).toBe(titleButton(wrapper));
    });

    it('cancels on Escape without saving, returns focus to the title button and keeps the panel open', async () => {
        const { wrapper, input } = await editTitle();
        await input.setValue('Discarded');
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        input.element.dispatchEvent(escape);
        await flushPromises();
        expect(escape.defaultPrevented).toBe(true);
        expect(wrapper.emitted('update:taskName')).toBeUndefined();
        expect(wrapper.find('#taskNameEdit').exists()).toBe(false);
        expect(document.activeElement).toBe(titleButton(wrapper));
    });

    it('leaves focus where the user clicked when the field loses focus', async () => {
        const { wrapper } = await editTitle();
        const elsewhere = document.createElement('button');
        document.body.appendChild(elsewhere);
        elsewhere.focus();
        await flushPromises();
        expect(wrapper.find('#taskNameEdit').exists()).toBe(false);
        expect(document.activeElement).toBe(elsewhere);
    });
});
