import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';

const { updateAssignee } = vi.hoisted(() => ({ updateAssignee: vi.fn() }));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateAssignee } }));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: `User ${id}` }) })
}));

import { useTaskMutations } from '@/components/organisms/Task/composables/useTaskMutations';
import * as assigneeOptions from '@/utils/assigneeOptions';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const removePerson = (...args) => assigneeOptions.removePerson(...args);

function rowWith(assignees) {
    const task = ref({ _id: 't1', AssigneeUserId: [...assignees] });
    const searched = vi.fn();
    const store = createStore({
        getters: { 'settings/companyOwnerDetail': () => ({ userId: 'owner' }) },
        mutations: { 'projectData/mutateSearchTask': searched }
    });
    let mutations;
    const Row = defineComponent({
        setup() {
            mutations = useTaskMutations({ projectData: ref({ _id: 'p1', CompanyId: 'c1' }), task, props: { data: task.value } });
            return () => h('div');
        }
    });
    mount(Row, { global: { plugins: [store, i18n], provide: { $userId: ref('me'), $companyId: ref('c1') } } });
    return { task, searched, remove: (id) => mutations.changeAssignee('remove', { id }) };
}

beforeEach(() => {
    updateAssignee.mockReset();
    updateAssignee.mockResolvedValue({});
});

describe('taking a person off a list of people', () => {
    it('removes that person and nobody else', () => {
        expect(removePerson(['u1', 'u2', 'u3'], 'u2')).toEqual(['u1', 'u3']);
    });

    it('leaves the list alone when the person is no longer on it', () => {
        const people = ['u1', 'u2', 'u3'];
        expect(removePerson(people, 'gone')).toBe(people);
        expect(people).toEqual(['u1', 'u2', 'u3']);
    });

    it('changes the list it was given, which the rows hold by reference', () => {
        const people = ['u1', 'u2'];
        removePerson(people, 'u1');
        expect(people).toEqual(['u2']);
    });
});

describe('removing an assignee from a task row', () => {
    it('takes off the person who was removed', async () => {
        const row = rowWith(['u1', 'u2', 'u3']);
        row.remove('u2');
        await flushPromises();
        expect(row.task.value.AssigneeUserId).toEqual(['u1', 'u3']);
        expect(row.searched).toHaveBeenCalledTimes(1);
    });

    it('keeps everyone else when a live update already took that person off', async () => {
        const row = rowWith(['u1', 'u2', 'u3']);
        row.remove('u2');
        row.task.value.AssigneeUserId = ['u1', 'u3'];
        await flushPromises();
        expect(row.task.value.AssigneeUserId).toEqual(['u1', 'u3']);
    });
});

describe('every row that removes a person', () => {
    const UNGUARDED = /findIndex\([^\n]*\)\s*;?\s*\n\s*[\w.]*\.splice\(index\s*,\s*1\)/;

    it.each([
        'components/organisms/Task/composables/useTaskMutations.js',
        'plugins/tasklistDashboard/components/organisms/Task/Task.vue',
        'components/molecules/CheckList/CheckList.vue'
    ])('%s never splices an index it did not find', (file) => {
        const source = read(file);
        expect(source).not.toMatch(UNGUARDED);
        expect(source).toContain('removePerson(');
    });
});
