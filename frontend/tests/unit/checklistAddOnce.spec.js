/* Task 047, tenth sweep — "+ Add a checklist" stores one checklist per press: it waits for its save,
   and a delete tells the views which rows are left. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import { readFileSync } from 'fs';
import path from 'path';

const { stub, saves, ids } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    saves: [],
    ids: { next: 0 }
}));

vi.mock('@/utils/TaskOperations', () => ({
    default: {
        updateChecklistsv2: vi.fn((args) => new Promise((resolve, reject) => saves.push({ args, resolve, reject })))
    }
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        makeUniqueId: () => `new-${++ids.next}`,
        checkPermission: () => true,
        debouncerWithPromise: () => Promise.resolve()
    }),
    useGetterFunctions: () => ({ getUser: () => ({ id: 'u1', Employee_Name: 'Olivia Owner' }) })
}));
vi.mock('@/composable/aiHelper', () => ({ useAiApiFunction: () => ({ generateAiRequestForFunction: vi.fn() }) }));
vi.mock('@/composable/aiAvailability', () => ({ canUseAi: () => false }));
vi.mock('@/components/molecules/CheckList/SubCheckList.vue', () => stub('SubCheckList'));
vi.mock('@/components/molecules/CheckList/AiCheckList.vue', () => stub('AiCheckList'));
vi.mock('@/components/atom/InputTextarea/InputTextarea.vue', () => stub('InputTextarea'));
vi.mock('@/components/atom/InputText/InputText.vue', () => stub('InputText'));
vi.mock('@/components/atom/Skelaton/AiSkelaton.vue', () => stub('AiSkelaton'));
vi.mock('@/components/atom/Skelaton/Skelaton.vue', () => stub('Skelaton'));
vi.mock('@/components/atom/Modal/Modal.vue', () => ({
    default: { name: 'ConfirmModal', props: ['modelValue'], emits: ['accept', 'close'], render: () => null }
}));

import CheckList from '@/components/molecules/CheckList/CheckList.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const ROW = (id, extra = {}) => ({ id, name: `List ${id}`, AssigneeUserId: [], isChecked: false, isExpand: false, ...extra });

function open(data = []) {
    return mount(CheckList, {
        props: { taskId: 'task-1', sprintId: 'sprint-1', data, task: { _id: 'task-1', TaskName: 'Landing page', checklistArray: data }, permission: true },
        global: {
            plugins: [createStore({ getters: { 'settings/companyOwnerDetail': () => ({ id: 'u1' }) } })],
            mocks: { $t: i18n.global.t },
            provide: {
                $clientWidth: ref(1280), $userId: ref('u1'), $companyId: ref('company-1'),
                selectedProject: ref({ _id: 'proj-1', ProjectName: 'Website', isGlobalPermission: true })
            }
        }
    });
}

const addButton = (wrapper) => wrapper.get('.new-checklist-section');

beforeEach(() => {
    saves.length = 0;
    ids.next = 0;
});

describe('"+ Add a checklist" in a task', () => {
    it('is a button', () => {
        const wrapper = open();
        expect(addButton(wrapper).element.tagName).toBe('BUTTON');
        expect(addButton(wrapper).attributes('type')).toBe('button');
        expect(addButton(wrapper).text()).toContain(en.Checklist.add_checklist);
        wrapper.unmount();
    });

    it('stores one checklist however often it is pressed while the save is on its way', async () => {
        const wrapper = open();
        await addButton(wrapper).trigger('click');
        await addButton(wrapper).trigger('click');
        await addButton(wrapper).trigger('click');
        expect(saves).toHaveLength(1);
        expect(saves[0].args).toMatchObject({ ops: 'taskchecklistcreate', taskId: 'task-1', localUpdateArray: [{ id: 'new-1', name: 'Checklist' }] });
        expect(addButton(wrapper).attributes('aria-busy')).toBe('true');
        expect(addButton(wrapper).attributes('disabled')).toBeDefined();
        wrapper.unmount();
    });

    it('takes the next press once the save has answered', async () => {
        const wrapper = open();
        await addButton(wrapper).trigger('click');
        saves[0].resolve({ status: true });
        await flushPromises();
        expect(addButton(wrapper).attributes('aria-busy')).toBe('false');
        expect(addButton(wrapper).attributes('disabled')).toBeUndefined();
        await addButton(wrapper).trigger('click');
        expect(saves).toHaveLength(2);
        wrapper.unmount();
    });

    it('takes the next press after a save that failed', async () => {
        const wrapper = open();
        await addButton(wrapper).trigger('click');
        saves[0].reject({ status: false });
        await flushPromises();
        expect(addButton(wrapper).attributes('disabled')).toBeUndefined();
        wrapper.unmount();
    });
});

describe('deleting a checklist in a task', () => {
    it('sends the rows that are left, so the views drop the deleted one at once', async () => {
        const wrapper = open([ROW('a'), ROW('a1', { parentId: 'a' }), ROW('b')]);
        await flushPromises();
        await wrapper.get('#list_a .action-section img').trigger('click');
        wrapper.findComponent({ name: 'ConfirmModal' }).vm.$emit('accept', true);
        await flushPromises();
        expect(saves).toHaveLength(1);
        expect(saves[0].args.ops).toBe('checklistremove');
        expect(saves[0].args.data).toEqual(['a', 'a1']);
        expect(saves[0].args.localUpdateArray.map((row) => row.id)).toEqual(['b']);
        wrapper.unmount();
    });

    it('asks with one question mark', () => {
        const source = readFileSync(path.resolve(__dirname, '../../src/components/molecules/CheckList/CheckList.vue'), 'utf8');
        expect(en.Filters.are_you_suredelete.endsWith('?')).toBe(true);
        expect(source).not.toMatch(/are_you_suredelete'\)\s*}}\?/);
    });
});
