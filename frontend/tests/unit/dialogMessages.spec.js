import { describe, expect, it, vi } from 'vitest';
import { mount, shallowMount } from '@vue/test-utils';

vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, commit: vi.fn(), dispatch: vi.fn() }), createStore: () => ({}) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }), useCustomComposable: () => ({ makeUniqueId: () => 'u1' }) }));

import AlertBox from '@/components/atom/AlertBox/AlertBox.vue';
import ConfirmationSidebar from '@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue';
import ConfirmationsInTask from '@/components/atom/ConfirmationsInTask/ConfirmationsInTask.vue';
import ToolTip from '@/components/molecules/ToolTip/ToolTip.vue';

const MARKUP = '<img src="x" onerror="alert(1)"><a href="javascript:alert(2)">bad</a><script>alert(3)</script>';
const unsafe = (root) => root.querySelectorAll('script, [onerror], a[href^="javascript"]');
const SidebarStub = { template: '<div><slot name="body" /></div>' };

describe('alert box', () => {
    it('sanitises an html message and keeps its bold text', () => {
        const wrapper = mount(AlertBox, { props: { title: 'T', message: `<strong>Acme</strong>${MARKUP}`, isHtml: true, fields: [] }, attachTo: document.body });
        const message = document.body.querySelector('.alert-box p');
        expect(unsafe(message)).toHaveLength(0);
        expect(message.querySelector('strong').textContent).toBe('Acme');
        wrapper.unmount();
    });
});

describe('confirmation sidebar', () => {
    it('sanitises the message and keeps its bold text', () => {
        const wrapper = shallowMount(ConfirmationSidebar, {
            props: { modelValue: true, message: `<b class='black'>Task</b>${MARKUP}` },
            global: { stubs: { Sidebar: SidebarStub } },
        });
        const message = wrapper.find('.archive-delete-desc');
        expect(unsafe(message.element)).toHaveLength(0);
        expect(message.find('b.black').text()).toBe('Task');
    });
});

describe('convert to subtask confirmation', () => {
    it('shows task names with markup as text', () => {
        const wrapper = mount(ConfirmationsInTask, {
            props: { modelValue: true, subTaskConfirm: true, task: { TaskName: '<i>one</i>' }, selectedTask: { TaskName: MARKUP } },
            global: { stubs: { Sidebar: SidebarStub, TaskStatus: true, TaskType: true, Assignee: true, UserProfile: true, DropDown: true, DropDownOption: true, TaskTypeIcon: true } },
        });
        const message = wrapper.find('.archive-delete-desc');
        expect(unsafe(message.element)).toHaveLength(0);
        expect(message.find('i').exists()).toBe(false);
        const names = message.findAll('b.black').map((b) => b.text());
        expect(names).toEqual(['<i>one</i>’s', MARKUP]);
    });
});

describe('tooltip', () => {
    it('sanitises the text and keeps its bold words', async () => {
        const wrapper = mount(ToolTip, { props: { label: 'L', text: `By enabling <b>Tags</b>${MARKUP}` }, attachTo: document.body });
        await wrapper.find('.tooltip-trigger').trigger('mouseenter');
        await wrapper.vm.$nextTick();
        const text = document.body.querySelector('.tooltip-desc');
        expect(unsafe(text)).toHaveLength(0);
        expect(text.querySelector('b').textContent).toBe('Tags');
        wrapper.unmount();
    });
});
