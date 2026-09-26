import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

const people = { u1: 'Asha Rao', u2: 'Ben Ito', u3: 'Cara Diaz' };
const composable = vi.hoisted(() => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: { u1: 'Asha Rao', u2: 'Ben Ito', u3: 'Cara Diaz' }[id], Employee_profileImageURL: '' }) }),
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/components/atom/UserProfile/UserProfile.vue', () => ({ default: { name: 'UserProfile', render: () => null } }));

import CommentInput from '@/components/atom/CommentInput/CommentInput.vue';

const provide = { $defaultUserAvatar: ref(''), $clientWidth: ref(1280) };
const stubs = { UserProfile: true };

const Composer = defineComponent({
    props: { index: Number },
    setup(props) {
        const text = ref('');
        return () => h('div', { class: `composer-${props.index}` }, [
            h(CommentInput, { modelValue: text.value, 'onUpdate:modelValue': (v) => { text.value = v; }, userIds: Object.keys(people), reply: {} }),
        ]);
    },
});

const typeAt = async (wrapper, root) => {
    const box = wrapper.find(`${root} textarea`);
    box.element.value = '@';
    await box.trigger('input');
    box.element.setSelectionRange(1, 1);
    await box.trigger('keyup', { keyCode: 50, key: '@' });
    await nextTick();
    return box;
};

const mountOne = () => mount(defineComponent({ render: () => h(Composer, { index: 1 }) }), { attachTo: document.body, global: { provide, stubs } });

describe('comment mention suggestions', () => {
    it('are a named listbox of options the textarea points at while open', async () => {
        const wrapper = mountOne();
        const box = wrapper.find('textarea');
        expect(box.attributes('role')).toBe('combobox');
        expect(box.attributes('aria-autocomplete')).toBe('list');
        expect(box.attributes('aria-expanded')).toBe('false');
        expect(box.attributes('aria-activedescendant')).toBeUndefined();

        await typeAt(wrapper, '.composer-1');
        const list = wrapper.find('[role="listbox"]');
        expect(list.exists()).toBe(true);
        expect(list.attributes('aria-label')).toBe('Comments.mention_suggestions');
        const options = list.findAll('[role="option"]');
        expect(options.map((o) => o.text())).toEqual(['Asha Rao', 'Ben Ito', 'Cara Diaz']);
        const ids = options.map((o) => o.attributes('id'));
        ids.forEach((id) => expect(id).toBeTruthy());
        expect(new Set(ids).size).toBe(3);

        expect(box.attributes('aria-expanded')).toBe('true');
        expect(box.attributes('aria-controls')).toBe(list.attributes('id'));
        expect(box.attributes('aria-activedescendant')).toBe(ids[0]);
        expect(options[0].attributes('aria-selected')).toBe('true');
        expect(options[1].attributes('aria-selected')).toBe('false');
        wrapper.unmount();
    });

    it('move the active option with the arrow keys', async () => {
        const wrapper = mountOne();
        const box = await typeAt(wrapper, '.composer-1');
        const ids = wrapper.findAll('[role="option"]').map((o) => o.attributes('id'));
        expect(ids).toHaveLength(3);

        await box.trigger('keydown', { keyCode: 40, key: 'ArrowDown' });
        expect(box.attributes('aria-activedescendant')).toBe(ids[1]);
        expect(wrapper.findAll('[role="option"]')[1].attributes('aria-selected')).toBe('true');

        await box.trigger('keydown', { keyCode: 38, key: 'ArrowUp' });
        expect(box.attributes('aria-activedescendant')).toBe(ids[0]);
        wrapper.unmount();
    });

    it('collapse again when the list closes', async () => {
        const wrapper = mountOne();
        const box = await typeAt(wrapper, '.composer-1');
        expect(box.attributes('aria-expanded')).toBe('true');

        await box.trigger('keyup', { keyCode: 27, key: 'Escape' });
        expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
        expect(box.attributes('aria-expanded')).toBe('false');
        expect(box.attributes('aria-activedescendant')).toBeUndefined();
        expect(box.attributes('aria-controls')).toBeUndefined();
        wrapper.unmount();
    });

    it('get ids of their own in each composer on the page', async () => {
        const wrapper = mount(defineComponent({ render: () => h('div', [h(Composer, { index: 1 }), h(Composer, { index: 2 })]) }), { attachTo: document.body, global: { provide, stubs } });
        const first = await typeAt(wrapper, '.composer-1');
        const second = await typeAt(wrapper, '.composer-2');
        const optionIds = wrapper.findAll('[role="option"]').map((o) => o.attributes('id'));

        expect(first.attributes('aria-controls')).toBeTruthy();
        expect(first.attributes('aria-controls')).not.toBe(second.attributes('aria-controls'));
        expect(first.attributes('aria-activedescendant')).not.toBe(second.attributes('aria-activedescendant'));
        expect(new Set(optionIds).size).toBe(optionIds.length);
        wrapper.unmount();
    });
});
