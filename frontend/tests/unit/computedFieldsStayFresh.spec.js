/* Tenth sweep, defect 2: the browser shows a formula or a rollup as the server stores it, a zero as 0 and nothing as a dash. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

const apiRequest = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: { data: {} } })));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => true, makeUniqueId: () => 'uid', debounce: (fn) => fn }),
    useConvertDate: () => ({ convertDateFormat: (value) => String(value || '') }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id }) })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));
vi.mock('@vuepic/vue-datepicker', () => ({ default: { name: 'VueDatePicker', render: () => null } }));
vi.mock('@formkit/vue', () => ({ FormKit: { name: 'FormKit', render: () => null } }));

import * as env from '@/config/env';
import { computeCustomFieldValue, neverComputed } from '@/plugins/customFieldView/formulaEngine.js';
import ComputedColumn from '@/plugins/customFieldView/component/atom/customFieldViewColumn/computedComponentViewColumn.vue';
import CustomFieldRender from '@/plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue';

const COST = { _id: 'cost', fieldTitle: 'Cost', fieldType: 'number', type: 'task', global: true, isDelete: true };
const TOTAL = { _id: 'total', fieldTitle: 'Total cost', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: 'cost', type: 'task', global: true, isDelete: true };
const AVERAGE = { ...TOTAL, _id: 'average', fieldTitle: 'Average cost', rollupFunction: 'avg' };
const ROWS = { ...TOTAL, _id: 'rows', fieldTitle: 'Subtasks', rollupFunction: 'count', rollupSourceFieldId: '' };
const TENFOLD = { _id: 'tenfold', fieldTitle: 'Tenfold', fieldType: 'formula', formulaExpression: '{subtask_count} * 10', type: 'task', global: true, isDelete: true };
const DEFS = [COST, TOTAL, AVERAGE, ROWS, TENFOLD];

const task = (more = {}) => ({ _id: 't1', ProjectID: 'p1', ParentTaskId: '', TaskTypeKey: 1, deletedStatusKey: 0, subTasks: 0, customField: {}, ...more });
const computedEntry = (fieldValue) => ({ fieldValue, computedAt: '2026-10-02T10:00:00.000Z' });

describe('a rollup on a task with no subtasks', () => {
    it('is what the server stores for it: a sum and a count of 0, and nothing for an average', () => {
        expect(computeCustomFieldValue(TOTAL, task(), [], DEFS)).toBe(0);
        expect(computeCustomFieldValue(ROWS, task(), [], DEFS)).toBe(0);
        expect(computeCustomFieldValue(AVERAGE, task(), [], DEFS)).toBe('');
    });

    it('keeps the stored number while its subtasks are not loaded', () => {
        const parent = task({ subTasks: 2, customField: { total: computedEntry(12) } });
        expect(computeCustomFieldValue(TOTAL, parent, [], DEFS)).toBe(12);
    });
});

describe('a computed cell', () => {
    const cell = (def, row) => mount(ComputedColumn, { props: { def, task: row, allTasks: [], defs: DEFS } }).text();

    it('shows a stored zero as 0', () => {
        expect(cell(TENFOLD, task({ customField: { tenfold: computedEntry(0) } }))).toBe('0');
    });

    it('shows a dash for a value that could not be worked out', () => {
        expect(cell(TENFOLD, task({ customField: { tenfold: computedEntry('') } }))).toBe('—');
        expect(cell(AVERAGE, task())).toBe('—');
    });
});

describe('a task the server has not worked out yet', () => {
    it('is one that holds no entry for a formula or a rollup it shows', () => {
        expect(neverComputed(task(), DEFS)).toBe(true);
        expect(neverComputed(task({ customField: { total: computedEntry(0), average: computedEntry(''), rows: computedEntry(0), tenfold: computedEntry(0) } }), DEFS)).toBe(false);
        expect(neverComputed(task(), [COST])).toBe(false);
    });

    describe('opened in the task panel', () => {
        const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
        const store = (fields) => createStore({ getters: { 'settings/finalCustomFields': () => fields, 'projectData/tasks': () => ({}), 'projectData/alltasks': () => [] } });
        const open = (row, fields = DEFS) => mount(CustomFieldRender, {
            props: { task: row, editPermission: true },
            global: { plugins: [i18n, store(fields)], provide: { $clientWidth: ref(1280), $defaultUserAvatar: '' }, stubs: { ToolTip: true, AiFieldMark: true, ModuleFieldListing: true, Skelaton: true } }
        });
        const asked = () => apiRequest.mock.calls.filter(([, url]) => url === env.CUSTOM_FIELD_COMPUTE).map(([, , body]) => body.taskIds);

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
            apiRequest.mockClear();
        });
        afterEach(() => vi.useRealTimers());

        it('asks the server for its numbers once', async () => {
            const wrapper = open(task());
            await vi.advanceTimersByTimeAsync(3000);
            expect(asked()).toEqual([['t1']]);
            await wrapper.setProps({ task: task({ TaskName: 'renamed' }) });
            await vi.advanceTimersByTimeAsync(3000);
            expect(asked()).toEqual([['t1']]);
            wrapper.unmount();
        });

        it('asks nothing for a task that holds its numbers', async () => {
            const wrapper = open(task({ customField: { total: computedEntry(0), average: computedEntry(''), rows: computedEntry(0), tenfold: computedEntry(0) } }));
            await vi.advanceTimersByTimeAsync(3000);
            expect(asked()).toEqual([]);
            wrapper.unmount();
        });
    });
});
