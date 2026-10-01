/* Task 046 slice A1 — relationship and voting custom fields. The task carries a marker (and a vote count); what a viewer
   may see of the linked tasks and the voters is asked of the server and kept beside the tasks. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

const { apiRequest, openTask, USERS } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    openTask: vi.fn(),
    USERS: {
        'a1a1a1a1a1a1a1a1a1a1a1a1': { Employee_Name: 'Olivia Owner', Employee_profileImageURL: '' },
        'b2b2b2b2b2b2b2b2b2b2b2b2': { Employee_Name: 'Max Member', Employee_profileImageURL: '' }
    }
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'uid', debounce: (run) => run }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: 'Ghost User', ...(USERS[id] || {}) }), getTeam: () => ({}) })
}));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask }));

import { FIELD_TYPES, customFieldPayload, customFieldText } from '@/views/Projects/composables/projectCustomFields';
import {
    comparisonsFor, customFieldGroups, customFilterCondition, customFilterOptions, customGroupMatches, customGroupOptions, customGroupUpdate,
    customSortValue, isSortableField, needsProjectRange, needsValue, tableSortStages, valuePath
} from '@/views/Projects/composables/customFieldQuery';
import { sortChoices } from '@/views/Projects/composables/viewSort';
import { cleanViewSettings } from '@viewSettings';
import { fieldTypeCatalogue, fieldTypeUi, moduleFieldDraft, moduleFieldSettings, moduleFieldSettingsError, taskPropFor } from '@/plugins/customFieldView/fieldTypes';
import { linkedValue, resetFieldLinks } from '@/plugins/customFieldView/fieldTypes/fieldLinks';
import RelationshipFieldValue from '@/plugins/customFieldView/fieldTypes/RelationshipFieldValue.vue';
import RelationshipFieldSettings from '@/plugins/customFieldView/fieldTypes/RelationshipFieldSettings.vue';
import VotingFieldValue from '@/plugins/customFieldView/fieldTypes/VotingFieldValue.vue';
import VotingFieldSettings from '@/plugins/customFieldView/fieldTypes/VotingFieldSettings.vue';
import CustomFieldCell from '@/views/Projects/components/columns/CustomFieldCell.vue';
import CustomFieldFilterValue from '@/components/molecules/TaskFilter/CustomFieldFilterValue.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];
config.global.mocks = {};

const [OLIVIA, MAX] = Object.keys(USERS);
const CLIENT = 'e1'.repeat(12);
const VOTES = 'e2'.repeat(12);
const TASK = 'f1'.repeat(12);
const OTHER = 'f2'.repeat(12);
const CONTRACT = 'f3'.repeat(12);
const INVOICE = 'f4'.repeat(12);
const PROJECT = 'c1'.repeat(12);
const LIST = 'c2'.repeat(12);
const base = { isDelete: true, type: 'task', global: true };
const client = { ...base, _id: CLIENT, fieldType: 'relationship', fieldTitle: 'Client', fieldLinkMax: 10, fieldLinkScope: 'any' };
const votes = { ...base, _id: VOTES, fieldType: 'voting', fieldTitle: 'Upvotes', fieldVotersShown: true };
const task = (count = 3, extra = {}) => ({
    _id: TASK, ProjectID: PROJECT, sprintId: LIST, TaskTypeKey: 1,
    customField: { [CLIENT]: { _id: CLIENT, fieldValue: '', revision: 1 }, ...(count ? { [VOTES]: { _id: VOTES, fieldValue: count, revision: 1 } } : {}) },
    ...extra
});
const linked = (id, key, title) => ({ id, key, title, status: { text: 'To Do', type: 'default_active' }, projectId: PROJECT, sprintId: LIST, folderId: '' });
const RESOLVED = {
    [TASK]: { [CLIENT]: [linked(CONTRACT, 'CRM-1', 'Contract'), linked(INVOICE, 'CRM-2', 'Invoice')], [VOTES]: { count: 3, voted: true, voters: [OLIVIA, MAX] } }
};
const answer = (data) => Promise.resolve({ status: 200, data: { status: true, data } });
const resolves = (data = RESOLVED) => apiRequest.mockImplementation((method, url) => {
    if (url === '/api/v2/custom-fields/links/resolve') return answer(data);
    if (url.endsWith('/vote')) return answer({ count: 2, voted: false });
    return Promise.resolve({ status: 200, data: [] });
});
const t = (key) => key;

const store = createStore({
    getters: {
        'settings/finalCustomFields': () => [client, votes],
        'settings/companyUsers': () => [],
        'settings/teams': () => [],
        'projectData/allProjects': () => [{ _id: PROJECT, ProjectName: 'CRM' }],
        'projectData/onlyActiveProjects': () => [{ _id: PROJECT, ProjectName: 'CRM', sprintsObj: { [LIST]: { id: LIST, name: 'Deals' } } }]
    }
});
const global = { plugins: [store], provide: { $dateFormat: ref('DD/MM/YYYY'), selectedProject: ref({ _id: PROJECT }), $clientWidth: ref(1280), $companyId: ref('co1') }, stubs: { AiFieldMark: true } };

beforeEach(() => {
    apiRequest.mockReset();
    openTask.mockReset();
    resetFieldLinks();
    resolves();
});

describe('the two types are field types', () => {
    it('are listed, drawn by their own component, and handed the task', () => {
        expect(FIELD_TYPES).toEqual(expect.arrayContaining(['relationship', 'voting']));
        expect(fieldTypeUi('relationship')).toMatchObject({ value: RelationshipFieldValue, settings: RelationshipFieldSettings, needsTask: true, noUndo: true });
        expect(fieldTypeUi('voting')).toMatchObject({ value: VotingFieldValue, settings: VotingFieldSettings, needsTask: true });
        expect(taskPropFor('voting', task())).toEqual({ task: task() });
        expect(fieldTypeCatalogue([], t).map((type) => type.cfType)).toEqual(['people', 'url', 'rating', 'progress', 'files', 'relationship', 'voting']);
    });

    it('send a relationship as task ids and never send a vote as a value', () => {
        expect(customFieldPayload(client, [CONTRACT, INVOICE])).toEqual({ fieldValue: [CONTRACT, INVOICE], _id: CLIENT });
        expect(customFieldPayload(client, Array.from({ length: 11 }, (_, at) => `${String(at).padStart(2, '0')}${'ab'.repeat(11)}`))).toEqual({ invalid: true });
        expect(customFieldPayload(votes, [OLIVIA])).toEqual({ invalid: true });
        expect(customFieldPayload(votes, 9)).toEqual({ invalid: true });
    });

    it('read as text from what the task carries', () => {
        expect(customFieldText(votes, task(3))).toBe('3');
        expect(customFieldText(votes, task(0))).toBe('');
        expect(customFieldText(client, task())).toBe('');
    });

    it('open with their defaults and keep settings that fit', () => {
        expect(moduleFieldDraft({ fieldType: 'relationship' })).toMatchObject({ fieldLinkMax: 10, fieldLinkScope: 'any', fieldLinkProjectId: '', fieldLinkSprintId: '' });
        expect(moduleFieldDraft({ fieldType: 'voting' })).toMatchObject({ fieldVotersShown: true });
        expect(moduleFieldSettingsError({ fieldType: 'relationship', fieldLinkMax: 30 })).toBe('FieldTypes.relationship_settings_error');
        expect(moduleFieldSettingsError({ fieldType: 'relationship', fieldLinkScope: 'project' })).toBe('FieldTypes.relationship_settings_error');
        expect(moduleFieldSettings({ fieldType: 'relationship', fieldLinkMax: '4', fieldLinkScope: 'project', fieldLinkProjectId: PROJECT }))
            .toEqual({ fieldLinkMax: 4, fieldLinkScope: 'project', fieldLinkProjectId: PROJECT, fieldLinkSprintId: '' });
        expect(moduleFieldSettings({ fieldType: 'voting', fieldVotersShown: false })).toEqual({ fieldVotersShown: false });
    });
});

describe('what a viewer is given of the linked tasks and the votes', () => {
    it('is asked once for the tasks on screen and read from then on', async () => {
        expect(linkedValue(task(), CLIENT)).toBeNull();
        expect(linkedValue({ ...task(), _id: OTHER }, CLIENT)).toBeNull();
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/custom-fields/links/resolve', { taskIds: [TASK, OTHER] });
        expect(linkedValue(task(), CLIENT).map((link) => link.key)).toEqual(['CRM-1', 'CRM-2']);
        expect(linkedValue(task(), VOTES)).toMatchObject({ voted: true, voters: [OLIVIA, MAX] });
        expect(linkedValue({ ...task(), _id: OTHER }, CLIENT)).toEqual([]);
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('is asked again when the task\'s marker moves', async () => {
        linkedValue(task(), CLIENT);
        await flushPromises();
        const moved = task();
        moved.customField[CLIENT].revision = 2;
        linkedValue(moved, CLIENT);
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        linkedValue(moved, CLIENT);
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);
    });
});

describe('a relationship value', () => {
    const shown = (props = {}) => mount(RelationshipFieldValue, { props: { def: client, value: '', task: task(), label: 'Client', ...props }, global });

    it('shows a chip for each linked task the viewer was given, and opens it', async () => {
        const wrapper = shown();
        await flushPromises();
        const chips = wrapper.findAll('[data-link]');
        expect(chips.map((chip) => chip.text())).toEqual(['CRM-1 Contract', 'CRM-2 Invoice']);
        await chips[1].trigger('click');
        expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: INVOICE, projectId: PROJECT, sprintId: LIST }));
        expect(wrapper.find('[data-link-add]').exists()).toBe(false);
    });

    it('shows the first chip and a count in a cell', async () => {
        const wrapper = shown({ compact: true });
        await flushPromises();
        expect(wrapper.findAll('[data-link]')).toHaveLength(1);
        expect(wrapper.get('.ftrl__more').text()).toBe('+1');
    });

    it('shows nothing for a task with no linked task the viewer may see', async () => {
        resolves({});
        const wrapper = shown();
        await flushPromises();
        expect(wrapper.findAll('[data-link]')).toHaveLength(0);
    });

    it('removes a link by sending the ids that stay', async () => {
        const wrapper = shown({ editable: true });
        await flushPromises();
        await wrapper.get('[data-link-add]').trigger('click');
        await wrapper.findAll('[data-link-remove]')[0].trigger('click');
        expect(wrapper.emitted('change')).toEqual([[[INVOICE]]]);
    });

    it('searches tasks the viewer can open and adds the one picked', async () => {
        const wrapper = shown({ editable: true });
        await flushPromises();
        await wrapper.get('[data-link-add]').trigger('click');
        apiRequest.mockImplementation((method, url) => (url.endsWith('/find')
            ? Promise.resolve({ status: 200, data: [{ _id: OTHER, TaskKey: 'CRM-9', TaskName: 'Renewal' }, { _id: CONTRACT, TaskKey: 'CRM-1', TaskName: 'Contract' }, { _id: TASK, TaskKey: 'CRM-3', TaskName: 'Itself' }] })
            : answer(RESOLVED)));
        await wrapper.get('[data-link-search]').setValue('ren');
        await flushPromises();
        const [, , body] = apiRequest.mock.calls.find((call) => call[1].endsWith('/find'));
        expect(JSON.stringify(body.findQuery)).not.toContain('ProjectID');
        const results = wrapper.findAll('[data-link-result]');
        expect(results.map((result) => result.text())).toEqual(['CRM-9 Renewal']);
        await results[0].trigger('click');
        expect(wrapper.emitted('change')).toEqual([[[CONTRACT, INVOICE, OTHER]]]);
    });

    it('searches inside the project or the list the field is limited to', async () => {
        const limited = { ...client, fieldLinkScope: 'list', fieldLinkProjectId: PROJECT, fieldLinkSprintId: LIST };
        const wrapper = shown({ editable: true, def: limited });
        await flushPromises();
        await wrapper.get('[data-link-add]').trigger('click');
        await wrapper.get('[data-link-search]').setValue('ren');
        await flushPromises();
        const [, , body] = apiRequest.mock.calls.find((call) => call[1].endsWith('/find'));
        expect(body.findQuery[0].$match).toMatchObject({ ProjectID: { objId: { $in: [PROJECT] } }, sprintId: { objId: { $in: [LIST] } } });
    });

    it('stops offering more once the field is full', async () => {
        const wrapper = shown({ editable: true, def: { ...client, fieldLinkMax: 2 } });
        await flushPromises();
        await wrapper.get('[data-link-add]').trigger('click');
        expect(wrapper.find('[data-link-search]').exists()).toBe(false);
        expect(wrapper.text()).toContain('2');
    });
});

describe('a voting value', () => {
    const shown = (props = {}) => mount(VotingFieldValue, { props: { def: votes, value: 3, task: task(), label: 'Upvotes', ...props }, global });

    it('shows the count and whether the viewer voted', async () => {
        const wrapper = shown({ compact: true });
        await flushPromises();
        const button = wrapper.get('[data-vote]');
        expect(button.text()).toBe('3');
        expect(button.attributes('aria-pressed')).toBe('true');
        expect(wrapper.findAll('[data-voter]')).toHaveLength(0);
    });

    it('lets a person who cannot edit fields vote, as its own write', async () => {
        const wrapper = shown({ editable: false });
        await flushPromises();
        await wrapper.get('[data-vote]').trigger('click');
        expect(apiRequest).toHaveBeenCalledWith('post', `/api/v2/custom-fields/${VOTES}/vote`, { taskId: TASK, vote: false });
        await flushPromises();
        expect(wrapper.get('[data-vote]').attributes('aria-pressed')).toBe('false');
        expect(wrapper.get('[data-vote]').text()).toBe('2');
        expect(wrapper.emitted('change')).toBeUndefined();
    });

    it('names the voters in the task panel when the field shows them', async () => {
        const wrapper = shown();
        await flushPromises();
        expect(wrapper.findAll('[data-voter]').map((voter) => voter.attributes('title'))).toEqual(['Olivia Owner', 'Max Member']);
    });

    it('names nobody when the server sent no voters', async () => {
        resolves({ [TASK]: { [VOTES]: { count: 3, voted: false } } });
        const wrapper = shown({ def: { ...votes, fieldVotersShown: false } });
        await flushPromises();
        expect(wrapper.findAll('[data-voter]')).toHaveLength(0);
        expect(wrapper.get('[data-vote]').attributes('aria-pressed')).toBe('false');
    });

    it('reads zero for a task nobody voted on', async () => {
        resolves({});
        const wrapper = shown({ value: '', task: task(0) });
        await flushPromises();
        expect(wrapper.get('[data-vote]').text()).toBe('0');
    });
});

describe('a List or Table cell', () => {
    it('draws both types, and a vote is cast from a cell nobody may edit', async () => {
        const cell = (def, editable) => mount(CustomFieldCell, { props: { def, task: task(), editable }, global });
        const relation = cell(client, false);
        const vote = cell(votes, false);
        await flushPromises();
        expect(relation.findAll('[data-link]')).toHaveLength(1);
        expect(vote.get('[data-vote]').attributes('disabled')).toBeUndefined();
    });
});

describe('the settings forms', () => {
    it('set how many tasks a relationship holds and where they come from', async () => {
        const wrapper = mount(RelationshipFieldSettings, { props: { modelValue: moduleFieldDraft({ fieldType: 'relationship' }) }, global });
        await wrapper.get('[data-link-max]').setValue('4');
        expect(wrapper.emitted('update:modelValue').at(-1)[0]).toMatchObject({ fieldLinkMax: '4' });
        await wrapper.get('[data-link-scope]').setValue('project');
        expect(wrapper.emitted('update:modelValue').at(-1)[0]).toMatchObject({ fieldLinkScope: 'project' });
        expect(wrapper.find('[data-link-project]').exists()).toBe(false);
        await wrapper.setProps({ modelValue: { ...moduleFieldDraft({ fieldType: 'relationship' }), fieldLinkScope: 'list', fieldLinkProjectId: PROJECT } });
        expect(wrapper.get('[data-link-project]').element.value).toBe(PROJECT);
        await wrapper.get('[data-link-list]').setValue(LIST);
        expect(wrapper.emitted('update:modelValue').at(-1)[0]).toMatchObject({ fieldLinkSprintId: LIST });
    });

    it('set whether a voting field shows who voted', async () => {
        const wrapper = mount(VotingFieldSettings, { props: { modelValue: moduleFieldDraft({ fieldType: 'voting' }) }, global });
        expect(wrapper.get('[data-voters-shown]').element.checked).toBe(true);
        await wrapper.get('[data-voters-shown]').setValue(false);
        expect(wrapper.emitted('update:modelValue')[0][0]).toMatchObject({ fieldVotersShown: false });
    });
});

describe('filtering', () => {
    const row = (def, comparison, values = [true]) => ({ name: { value: `customField.${def._id}`, type: 'custom', fieldType: def.fieldType, filterOn: valuePath(def._id) }, comparison: { value: comparison }, values, condition: '&&' });
    const mine = (is, extra = {}) => ({ _id: { fieldLinks: { field: CLIENT, is, ...extra } } });

    it('offers both types with their own comparisons', () => {
        expect(customFilterOptions([client, votes]).map((option) => option.fieldType)).toEqual(['relationship', 'voting']);
        expect(comparisonsFor('relationship').map((comparison) => comparison.value)).toEqual([':has', ':set', ':empty']);
        expect(comparisonsFor('voting').map((comparison) => comparison.value)).toEqual([':mine', ':=', ':>', ':<']);
        expect(needsValue(':mine')).toBe(false);
        expect(needsValue(':has')).toBe(true);
    });

    it('asks the server which tasks have a linked task this viewer can see', () => {
        expect(customFilterCondition(row(client, ':set'))).toEqual(mine('set'));
        expect(customFilterCondition(row(client, ':empty'))).toEqual(mine('empty'));
        expect(customFilterCondition(row(client, ':has', [CONTRACT]))).toEqual(mine('has', { task: CONTRACT }));
        expect(customFilterCondition(row(client, ':has', ['CRM-1']))).toBeNull();
        expect(customFilterCondition(row(client, ':has', []))).toBeNull();
    });

    it('keeps a task of another type out of a relationship filter, and in its "is empty"', () => {
        const typed = [{ ...client, fieldTaskTypes: [2] }];
        expect(customFilterCondition(row(client, ':set'), typed)).toEqual({ ...mine('set'), TaskTypeKey: { $in: [2] } });
        expect(customFilterCondition(row(client, ':empty'), typed)).toEqual({ $or: [mine('empty'), { TaskTypeKey: { $nin: [2] } }] });
    });

    it('filters votes by "I voted" and by count, reading no votes as zero', () => {
        expect(customFilterCondition(row(votes, ':mine'))).toEqual({ _id: { fieldLinks: { field: VOTES, is: 'mine' } } });
        const count = { $ifNull: [{ $convert: { input: `$${valuePath(VOTES)}`, to: 'double', onError: null, onNull: null } }, 0] };
        expect(customFilterCondition(row(votes, ':>', [3]))).toEqual({ $expr: { $gt: [count, 3] } });
        expect(customFilterCondition(row(votes, ':<', [3]))).toEqual({ $expr: { $lt: [count, 3] } });
        expect(customFilterCondition(row(votes, ':=', [0]))).toEqual({ $expr: { $eq: [count, 0] } });
        expect(customFilterCondition(row(votes, ':>', ['many']))).toBeNull();
    });

    it('keeps the rows in a saved view', () => {
        const kept = cleanViewSettings({ filters: [row(client, ':has', [CONTRACT]), row(client, ':set'), row(votes, ':mine'), row(votes, ':<', [5])] }).filters;
        expect(kept.map((filter) => filter.comparison.value)).toEqual([':has', ':set', ':mine', ':<']);
    });

    it('takes the task to look for from a search, and a count as a number', async () => {
        const pick = mount(CustomFieldFilterValue, { props: { field: client, comparison: ':has', modelValue: [] }, global });
        apiRequest.mockImplementation(() => Promise.resolve({ status: 200, data: [{ _id: CONTRACT, TaskKey: 'CRM-1', TaskName: 'Contract' }] }));
        await pick.get('[data-link-search]').setValue('con');
        await flushPromises();
        await pick.get('[data-link-result]').trigger('click');
        expect(pick.emitted('update:modelValue').at(-1)).toEqual([[CONTRACT]]);
        expect(mount(CustomFieldFilterValue, { props: { field: client, comparison: ':set', modelValue: [true] }, global }).find('input').exists()).toBe(false);
        expect(mount(CustomFieldFilterValue, { props: { field: votes, comparison: ':mine', modelValue: [true] }, global }).find('input').exists()).toBe(false);
        expect(mount(CustomFieldFilterValue, { props: { field: votes, comparison: ':>', modelValue: [] }, global }).get('input').attributes('type')).toBe('number');
    });
});

describe('sorting', () => {
    it('orders by vote count and never by a relationship', () => {
        expect(isSortableField(client)).toBe(false);
        expect(isSortableField(votes)).toBe(true);
        expect(sortChoices([client, votes]).filter((choice) => choice.label).map((choice) => choice.label)).toEqual(['Upvotes']);
        expect(customSortValue(votes, task(4))).toBe(4);
        expect(customSortValue(votes, task(0))).toBeNull();
        expect(customSortValue(client, task())).toBeNull();
        expect(tableSortStages(`${valuePath(VOTES)}:-1`, [votes])[1]).toEqual({ $sort: { cfSortValue: -1, _id: 1 } });
    });
});

describe('grouping', () => {
    it('offers both types', () => {
        expect(customGroupOptions([client, votes]).map((option) => option.fieldType)).toEqual(['relationship', 'voting']);
    });

    it('groups a relationship by whether this viewer sees a linked task', async () => {
        const groups = customFieldGroups(client, { t });
        expect(groups.map((group) => [group.name, group.searchValue, group.dropDisabled])).toEqual([['ViewGroups.has_value', 'set', true], ['ViewGroups.no_value', '', true]]);
        expect(groups[0].conditions).toEqual([{ _id: { fieldLinks: { field: CLIENT, is: 'set' } } }]);
        expect(groups[1].conditions).toEqual([{ _id: { fieldLinks: { field: CLIENT, is: 'empty' } } }]);
        expect(groups.map((group) => customGroupUpdate(group))).toEqual([null, null]);

        linkedValue(task(), CLIENT);
        await flushPromises();
        const bare = { ...task(), _id: OTHER };
        linkedValue(bare, CLIENT);
        await flushPromises();
        expect(groups.map((group) => customGroupMatches(task(), group))).toEqual([true, false]);
        expect(groups.map((group) => customGroupMatches(bare, group))).toEqual([false, true]);
    });

    it('leaves a task of another type in "no value"', () => {
        const groups = customFieldGroups({ ...client, fieldTaskTypes: [2] }, { t });
        expect(groups[0].conditions).toEqual([{ _id: { fieldLinks: { field: CLIENT, is: 'set' } }, TaskTypeKey: { $in: [2] } }]);
        expect(groups[1].conditions).toEqual([{ $nor: [{ _id: { fieldLinks: { field: CLIENT, is: 'set' } }, TaskTypeKey: { $in: [2] } }] }]);
    });

    it('groups votes into count bands cut from the project\'s range, like a number field', () => {
        expect(needsProjectRange(votes)).toBe(true);
        expect(needsProjectRange(client)).toBe(false);
        const groups = customFieldGroups(votes, { t, range: [1, 12] });
        expect(groups.map((group) => group.searchValue)).toEqual(['..4', '4..7', '7..10', '10..', '']);
        expect(groups.every((group) => group.dropDisabled)).toBe(true);
        expect(groups.map((group) => customGroupMatches(task(5), group))).toEqual([false, true, false, false, false]);
        expect(groups.map((group) => customGroupMatches(task(0), group))).toEqual([false, false, false, false, true]);
    });
});
