import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import ConfirmationsTemplate from '@/components/atom/ConfirmationsTemplate/ConfirmationsTemplate.vue';

const Sidebar = defineComponent({
    name: 'ConfirmationSidebar',
    props: ['modelValue', 'title', 'message', 'acceptButton'],
    emits: ['confirm', 'update:modelValue'],
    setup(props, { slots, emit }) {
        return () => h('div', { class: 'sb' }, [
            h('h4', props.title), h('p', { class: 'msg' }, props.message),
            slots.body?.(),
            h('button', { class: 'accept', onClick: () => emit('confirm') }, props.acceptButton),
            h('button', { class: 'close', onClick: () => emit('update:modelValue', false) }, 'x'),
        ]);
    },
});
const Picker = (cls) => defineComponent({
    props: ['options', 'convertStatus', 'convertTaskType', 'id'],
    emits: ['select'],
    setup(props, { slots, emit }) {
        return () => h('div', { class: cls, 'data-options': (props.options || []).map((o) => o.key).join(',') }, [
            slots.head?.(), h('button', { class: `${cls}-pick`, onClick: () => emit('select', { key: 'new' }, 'extra') }),
        ]);
    },
});
const stubs = { ConfirmationSidebar: Sidebar, TaskStatus: Picker('ts'), TaskType: Picker('tt'), TaskTypeIcon: { template: '<i class="icon" />' } };

const selectedProjectData = {
    taskStatusData: [{ key: 'old1' }, { key: 'n1' }, { key: 'n2' }],
    taskTypeCounts: [{ key: 'old1' }, { key: 'tn' }],
    projectStatusData: [{ key: 'old1' }, { key: 'p2' }, { key: 'pc', type: 'close' }],
};
const oldStatus = [{ key: 'old1', name: 'Blocked', bgColor: '#eee', textColor: '#111' }];
const mountIt = (props) => mount(ConfirmationsTemplate, { props: { oldStatus, selectedProjectData, ...props }, global: { stubs } });

describe('ConfirmationsTemplate task status mode', () => {
    it('shows i18n column headings, the old status and the placeholder with the error', () => {
        const w = mountIt({ statusType: true, errorMsg: 'pick one' });
        expect(w.find('.old__newstatustitle-wrapper').text()).toBe('general.Old_Statusgeneral.New_Status');
        expect(w.find('.oldstatusName').text()).toBe('Blocked');
        expect(w.find('.ts').text()).toContain('general.Select_Status');
        expect(w.find('.ts .red').text()).toBe('pick one');
    });

    it('offers only statuses that are not being replaced and emits the pick with its kind', async () => {
        const w = mountIt({ statusType: true });
        expect(w.find('.ts').attributes('data-options')).toBe('n1,n2');
        await w.find('.ts-pick').trigger('click');
        expect(w.emitted('changeStatus')[0]).toEqual([{ key: 'new' }, 'extra', 'taskStatus']);
    });

    it('shows the chosen status instead of the placeholder and error', () => {
        const w = mountIt({ statusType: true, errorMsg: 'pick one', oldStatus: [{ ...oldStatus[0], convertStatus: { name: 'Done', bgColor: '#0f0', textColor: '#000' } }] });
        expect(w.find('.ts').text()).toContain('Done');
        expect(w.find('.ts').text()).not.toContain('general.Select_Status');
        expect(w.find('.ts .red').exists()).toBe(false);
    });
});

describe('ConfirmationsTemplate task type mode', () => {
    it('shows task-type headings, placeholder and error', () => {
        const w = mountIt({ taskType: true, errorMsgType: 'type needed' });
        expect(w.find('.old__newstatustitle-wrapper').text()).toBe('general.Old_Task_Typegeneral.New_Task_Type');
        expect(w.find('.task_type-title').text()).toBe('general.Select_Task_Type');
        expect(w.find('.error__msg-text').text()).toBe('type needed');
    });

    it('emits changeTaskType and filters out replaced types', async () => {
        const w = mountIt({ taskType: true });
        expect(w.find('.tt').attributes('data-options')).toBe('tn');
        await w.find('.tt-pick').trigger('click');
        expect(w.emitted('changeTaskType')[0]).toEqual([{ key: 'new' }, 'extra']);
    });

    it('shows the chosen type name', () => {
        const w = mountIt({ taskType: true, oldStatus: [{ key: 'old1', name: 'Bug', convertType: { name: 'Story' } }] });
        expect(w.find('.tt').text()).toContain('Story');
        expect(w.find('.task_type-title').exists()).toBe(false);
    });
});

describe('ConfirmationsTemplate project status mode', () => {
    it('excludes closing statuses and the status being replaced, and emits projectStatus', async () => {
        const w = mountIt({ projectStatusType: true });
        expect(w.find('.ts').attributes('data-options')).toBe('p2');
        await w.find('.ts-pick').trigger('click');
        expect(w.emitted('changeStatus')[0][2]).toBe('projectStatus');
    });

    // the second heading reuses Old_Status where the other modes use New_*
    it.fails('labels the right-hand column as the new status', () => {
        const w = mountIt({ projectStatusType: true });
        expect(w.find('.old__newstatustitle-wrapper').text()).toBe('general.Old_Statusgeneral.New_Status');
    });
});

describe('ConfirmationsTemplate shell', () => {
    it('renders no body when no mode is chosen, still shows the accept button from i18n', () => {
        const w = mountIt({});
        expect(w.find('.old__newstatustitle-wrapper').exists()).toBe(false);
        expect(w.find('.accept').text()).toBe('general.Continue');
    });

    it('Continue emits confirm and closing emits closeModel(false)', async () => {
        const w = mountIt({ statusType: true });
        await w.find('.accept').trigger('click');
        await w.find('.close').trigger('click');
        expect(w.emitted('confirm')).toHaveLength(1);
        expect(w.emitted('closeModel')[0]).toEqual([false]);
    });

    it('names the kind of record in the message', () => {
        expect(mountIt({ projectStatusType: true }).find('.msg').text()).toContain('assigned to a project');
        expect(mountIt({ statusType: true }).find('.msg').text()).toContain('assigned to a task');
    });

    // template reads clientWidth but never injects it, so desktop always gets the phone font size
    it.fails('uses the desktop font size at a 1280px viewport', () => {
        const w = mountIt({ statusType: true });
        expect(w.find('.oldstatusName').classes()).toContain('font-size-13');
    });

    const src = readFileSync(resolve(__dirname, '../../src/components/atom/ConfirmationsTemplate/ConfirmationsTemplate.vue'), 'utf8');

    // title and message are hardcoded English strings
    it.fails('takes the dialog title and message from i18n', () => {
        const w = mountIt({ statusType: true });
        expect(w.find('h4').text()).toMatch(/^[\w]+\.[\w]+$/);
        expect(w.find('.msg').text()).toMatch(/^[\w]+\.[\w]+$/);
    });

    it('has no other bare text in template slots', () => {
        const tpl = src.slice(0, src.indexOf('<script')).replace(/<!--[\s\S]*?-->/g, '').replace(/="[^"]*"/g, '');
        expect(tpl.match(/>[^<>{}]*[A-Za-z]{2,}[^<>{}]*</g) || []).toEqual([]);
    });
});
