import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { stub } = vi.hoisted(() => ({ stub: (name) => ({ default: { name, render: () => null } }) }));

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => false, debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: () => ({}) })
}));
vi.mock('@/composable/commonFunction', () => ({ taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => true }) }));
vi.mock('@/composable/Validation', () => ({ useValidation: () => ({ checkErrors: vi.fn(), checkAllFields: vi.fn(() => Promise.resolve(true)) }) }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/components/molecules/DueDateCompo/DueDateCompo.vue', () => stub('DueDateCompo'));
vi.mock('@/components/molecules/Assignee/Assignee.vue', () => stub('Assignee'));
vi.mock('@/components/molecules/PriorityCompo/PriorityComp.vue', () => stub('PriorityComp'));
vi.mock('@/components/atom/TaskType/TaskType.vue', () => stub('TaskType'));
vi.mock('@/components/atom/InputText/InputText.vue', () => ({
    default: { name: 'InputText', render: () => h('input', { class: 'create__task-inputtext', type: 'text' }) }
}));
vi.mock('@/components/molecules/SidebarItems/SidebarItems.vue', () => stub('SidebarItems'));

import { pushEscapeLayer, closeTopEscapeLayer, hasEscapeLayer, escapeLayerMark, useEscapeLayer } from '@/composable/useEscapeLayer';
import { handlePanelEscape } from '@/components/organisms/TaskDetailOverlay/panelEscape';
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import CreateTask from '@/components/atom/CreateTask/CreateTask.vue';

const escape = (target) => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    return event;
};

let panel;
let close;
let mark;

beforeEach(() => {
    document.body.innerHTML = '<div id="my-sidebar"></div>';
    panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.tabIndex = -1;
    panel.innerHTML = '<button class="trigger">Assignee</button><textarea id="message-box"></textarea>';
    document.body.appendChild(panel);
    close = vi.fn();
    mark = escapeLayerMark();
});

afterEach(() => {
    while (hasEscapeLayer()) closeTopEscapeLayer();
});

describe('escape layers', () => {
    it('closes the most recently opened layer first', () => {
        const calls = [];
        pushEscapeLayer(() => calls.push('picker'));
        pushEscapeLayer(() => calls.push('date'));
        expect(closeTopEscapeLayer()).toBe(true);
        expect(closeTopEscapeLayer()).toBe(true);
        expect(closeTopEscapeLayer()).toBe(false);
        expect(calls).toEqual(['date', 'picker']);
    });

    it('drops a layer that closed on its own', () => {
        const done = vi.fn();
        const remove = pushEscapeLayer(done);
        remove();
        expect(hasEscapeLayer()).toBe(false);
        expect(closeTopEscapeLayer()).toBe(false);
        expect(done).not.toHaveBeenCalled();
    });

    it('leaves a layer opened before the mark alone', () => {
        const older = vi.fn();
        pushEscapeLayer(older);
        const later = escapeLayerMark();
        expect(closeTopEscapeLayer({ after: later })).toBe(false);
        expect(older).not.toHaveBeenCalled();
    });

    it('registers while its source is true and unregisters on unmount', async () => {
        const open = ref(false);
        const closeFn = vi.fn(() => { open.value = false; });
        const Host = defineComponent({ setup() { useEscapeLayer(open, closeFn); return () => null; } });
        const wrapper = mount(Host);
        expect(hasEscapeLayer()).toBe(false);
        open.value = true;
        await nextTick();
        expect(hasEscapeLayer()).toBe(true);
        open.value = false;
        await nextTick();
        expect(hasEscapeLayer()).toBe(false);
        open.value = true;
        await nextTick();
        wrapper.unmount();
        expect(hasEscapeLayer()).toBe(false);
    });
});

describe('Esc in the task panel closes the innermost open thing', () => {
    it('closes an open picker and keeps the panel open, even with focus left on the panel', async () => {
        const wrapper = mount(Sidebar, { props: { visible: true, title: 'Assignee', options: [] }, attachTo: document.body });
        await nextTick();
        const step = handlePanelEscape(escape(panel.querySelector('.trigger')), { panel, close, mark });
        expect(step).toBe('layer');
        expect(wrapper.emitted('update:visible')).toEqual([[false]]);
        expect(close).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('closes an open date picker only', () => {
        const closeMenu = vi.fn();
        pushEscapeLayer(closeMenu);
        expect(handlePanelEscape(escape(panel.querySelector('.trigger')), { panel, close, mark })).toBe('layer');
        expect(closeMenu).toHaveBeenCalledTimes(1);
        expect(close).not.toHaveBeenCalled();
    });

    it('leaves Esc typed inside a picker to the picker', () => {
        const layer = document.createElement('div');
        layer.className = 'dp__menu';
        document.body.appendChild(layer);
        expect(handlePanelEscape(escape(layer), { panel, close, mark })).toBe('ignore');
        expect(close).not.toHaveBeenCalled();
    });

    it('closes the subtask add row only', async () => {
        const store = createStore({ getters: { 'settings/companyOwnerDetail': () => ({}), 'settings/companyUsers': () => [] } });
        const listener = vi.fn((event) => handlePanelEscape(event, { panel, close, mark }));
        document.addEventListener('keydown', listener);
        const row = mount(CreateTask, {
            props: { sprint: { id: 'sprint-1' }, taskId: 'task-1', projectProp: { _id: 'proj-1', taskStatusData: [], taskTypeCounts: [] }, considerWidth: false },
            global: { plugins: [store], provide: { selectedProject: ref({}) } },
            attachTo: panel
        });
        const input = row.find('input.create__task-inputtext');
        await input.trigger('keydown', { key: 'Escape' });
        document.removeEventListener('keydown', listener);
        expect(row.emitted('cancel')).toHaveLength(1);
        expect(listener).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        row.unmount();
    });

    it('leaves a comment editor with its text and moves focus to the panel', () => {
        const editor = panel.querySelector('#message-box');
        editor.value = 'half a thought';
        editor.focus();
        expect(handlePanelEscape(escape(editor), { panel, close, mark })).toBe('blur');
        expect(editor.value).toBe('half a thought');
        expect(document.activeElement).toBe(panel);
        expect(close).not.toHaveBeenCalled();
    });

    it('closes the panel when nothing inside it is open', () => {
        expect(handlePanelEscape(escape(panel), { panel, close, mark })).toBe('close');
        expect(close).toHaveBeenCalledTimes(1);
        expect(handlePanelEscape(escape(document.body), { panel, close, mark })).toBe('close');
        expect(close).toHaveBeenCalledTimes(2);
    });

    it('ignores Esc inside a modal or a key another handler already took', () => {
        const modal = document.createElement('div');
        modal.className = 'modal';
        const inside = document.createElement('button');
        modal.appendChild(inside);
        document.body.appendChild(modal);
        expect(handlePanelEscape(escape(inside), { panel, close, mark })).toBe('ignore');
        const taken = escape(panel);
        taken.preventDefault();
        expect(handlePanelEscape(taken, { panel, close, mark })).toBe('ignore');
        expect(close).not.toHaveBeenCalled();
    });
});
