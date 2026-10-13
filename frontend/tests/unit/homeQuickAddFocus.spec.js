import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import MyWorkCard from '@/components/molecules/Home/MyWorkCard.vue';

const workStub = () => ({
    loading: ref(false),
    loaded: ref(true),
    groups: ref({ today: [], overdue: [], next: [], unscheduled: [] }),
    sortBy: ref('priority'),
    done: ref([]),
    doneLoaded: ref(true),
    delegated: ref([]),
    projectOf: () => null,
    setSort: () => {}
});

describe('Home quick add', () => {
    it('keeps the add field on screen and focused after a task is saved', async () => {
        const work = workStub();
        const wrapper = mount(MyWorkCard, { attachTo: document.body, props: { work }, global: { stubs: { TaskRow: true, 'i18n-t': true } } });
        const input = () => wrapper.find('.hc-add input');
        input().element.focus();
        await input().setValue('Call the printer');
        await wrapper.find('.hc-add').trigger('submit');
        expect(wrapper.emitted('add')[0]).toEqual(['Call the printer']);

        await wrapper.setProps({ adding: true });
        expect(document.activeElement).toBe(input().element);
        work.groups.value = { ...work.groups.value, today: [{ _id: 't1', TaskName: 'Call the printer' }] };
        await wrapper.setProps({ adding: false });
        await nextTick();

        expect(input().exists()).toBe(true);
        expect(input().element.value).toBe('');
        expect(document.activeElement).toBe(input().element);
        wrapper.unmount();
    });
});
