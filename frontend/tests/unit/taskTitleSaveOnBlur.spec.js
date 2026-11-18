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
    return { wrapper, input: wrapper.find('#taskNameEdit') };
}

const blur = async (input) => {
    input.element.blur();
    await flushPromises();
};

describe('task title save on blur', () => {
    it('saves a changed title when the field loses focus', async () => {
        const { wrapper, input } = await editTitle();
        await input.setValue('Write the final brief');
        await blur(input);
        expect(wrapper.emitted('update:taskName')).toEqual([['Write the final brief']]);
        expect(wrapper.find('#taskNameEdit').exists()).toBe(false);
    });

    it('saves once when Enter is followed by the blur the unmount fires', async () => {
        const { wrapper, input } = await editTitle();
        await input.setValue('Write the final brief');
        await input.trigger('keypress', { key: 'Enter' });
        await flushPromises();
        input.element.dispatchEvent(new FocusEvent('blur'));
        await flushPromises();
        expect(wrapper.emitted('update:taskName')).toEqual([['Write the final brief']]);
    });

    it('discards on Escape, including the blur that follows', async () => {
        const { wrapper, input } = await editTitle();
        await input.setValue('Discarded');
        input.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await flushPromises();
        input.element.dispatchEvent(new FocusEvent('blur'));
        await flushPromises();
        expect(wrapper.emitted('update:taskName')).toBeUndefined();
    });

    it.each([['empty', ''], ['whitespace-only', '   ']])('never saves an %s title and keeps the old one', async (_label, value) => {
        const { wrapper, input } = await editTitle();
        await input.setValue(value);
        await blur(input);
        expect(wrapper.emitted('update:taskName')).toBeUndefined();
        expect(wrapper.find('.title-name__edit').text()).toBe('Write the brief');
    });

    it('does not save an empty title on Enter either', async () => {
        const { wrapper, input } = await editTitle();
        await input.setValue('');
        await input.trigger('keypress', { key: 'Enter' });
        await flushPromises();
        expect(wrapper.emitted('update:taskName')).toBeUndefined();
        expect(wrapper.find('#taskNameEdit').exists()).toBe(false);
    });

    it('emits nothing when the title is unchanged', async () => {
        const { wrapper, input } = await editTitle();
        await blur(input);
        expect(wrapper.emitted('update:taskName')).toBeUndefined();
    });
});
