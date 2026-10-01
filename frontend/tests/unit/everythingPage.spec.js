/* Task 046 M2, slice E2: the Everything page in List mode. The store is the real one; `@/services`
   answers from the recorded server responses (tests/fixtures/everythingResponses.json). The page
   asks with today's date, the browser's timezone and its own page size, so a request is matched to
   a recording without those; anything never recorded answers "no rows". */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import fixture from '../fixtures/everythingResponses.json';

const { apiRequest, taskClass, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    taskClass: { updateStatus: vi.fn(() => Promise.resolve({ status: true })), updatePriority: vi.fn(() => Promise.resolve({ status: true })) },
    route: { path: '/company-1/everything', name: 'Everything', query: {}, params: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => true }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/utils/TaskOperations', () => ({ default: taskClass }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ getWasabiImageLink: () => Promise.resolve('') }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: id === 'user-1' ? 'Me Myself' : `Person ${String(id).slice(-1)}` }) })
}));
vi.mock('@/composable/commonFunction', () => ({ isBundledPriorityImage: () => true }));
vi.mock('@/components/atom/TaskTypeIcon/TaskTypeIcon.vue', () => ({ default: { name: 'TaskTypeIcon', render: () => null } }));
vi.mock('@/views/Projects/ListView/ListAssigneeCell.vue', () => ({ default: { name: 'ListAssigneeCell', props: ['task'], render: () => null } }));
vi.mock('@/views/Projects/ListView/ListDueCell.vue', async () => {
    const { h } = await import('vue');
    return { default: { name: 'ListDueCell', props: ['task', 'done', 'editable'], render() { return h('span', { class: 'stub-due' }, this.task.DueDate || ''); } } };
});
vi.mock('@/views/Projects/ListView/ListStatusCircle.vue', async () => {
    const { h } = await import('vue');
    return { default: { name: 'ListStatusCircle', props: ['task', 'statuses', 'editable', 'chip'], emits: ['change'], render() { return h('span', { class: 'stub-status' }, this.task.status?.text); } } };
});
vi.mock('@/views/Projects/ListView/ListPriorityCell.vue', async () => {
    const { h } = await import('vue');
    return { default: { name: 'ListPriorityCell', props: ['task', 'editable'], emits: ['change'], render() { return h('span', { class: 'stub-priority' }, this.task.Task_Priority); } } };
});

import everything from '@/store/Everything';
import Everything from '@/views/Everything/Everything.vue';
import { bindRouter, closeTask, overlayState } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

const WEB = '6f0000000000000000000a01';
const OPS = '6f0000000000000000000a02';
const SETTINGS_KEY = 'ah.everything.company-1.user-1';

const canon = (value) => {
    if (Array.isArray(value)) return value.map(canon);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
    return value;
};
const shapeOf = (body) => JSON.stringify(canon({ ...body, timezone: undefined, limit: undefined }));
const recordedAs = (body) => Object.keys(fixture).find((name) => shapeOf(fixture[name].request) === shapeOf(body));
const answer = (method, url, body) => Promise.resolve({ data: (fixture[recordedAs(body)] || fixture.nothing).response });

const sent = () => apiRequest.mock.calls.map(([, , body]) => body);
const sentNames = () => sent().map(recordedAs);

const projectList = Object.values({ ...fixture.projectCounts.response.data.projects }).map((card) => ({ ...card, deletedStatusKey: 0 }));

const newStore = () => createStore({
    modules: {
        everything,
        settings: {
            namespaced: true,
            getters: {
                companyPriority: () => [{ value: 'HIGH', name: 'High' }, { value: 'MEDIUM', name: 'Medium' }, { value: 'LOW', name: 'Low' }],
                companyUsers: () => [{ userId: 'user-1' }, { userId: '6f0000000000000000000002' }, { userId: 'gone', isDelete: true }],
                companyOwnerDetail: () => ({ userId: 'owner-1' }),
                selectedCompany: () => ({ planFeature: { projectProjectApp: true } })
            }
        },
        projectData: { namespaced: true, getters: { allProjects: () => ({ data: projectList }) } }
    }
});

let wrapper;
let store;
const open = async () => {
    store = newStore();
    wrapper = mount(Everything, { global: { plugins: [store] }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};
const rows = () => wrapper.findAllComponents({ name: 'EverythingRow' });
const rowOf = (name) => rows().find((row) => row.find('.evr__name').text() === name);
const rowNames = () => rows().map((row) => row.find('.evr__name').text());
const test = (name) => wrapper.find(`[data-test="${name}"]`);
const pick = async (chip, label) => {
    await test(`evr-filter-${chip}`).trigger('click');
    await wrapper.findAll('[data-test="evr-option"]').find((option) => option.text() === label).trigger('click');
    await flushPromises();
};

beforeEach(() => {
    localStorage.clear();
    apiRequest.mockReset();
    apiRequest.mockImplementation(answer);
    taskClass.updateStatus.mockClear();
    taskClass.updatePriority.mockClear();
    router.replace.mockClear();
    route.query = {};
    bindRouter(router, route);
});

afterEach(() => {
    closeTask({ keepRoute: true });
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('the list', () => {
    it('shows a skeleton, then rows from more than one project, each with its project', async () => {
        store = newStore();
        wrapper = mount(Everything, { global: { plugins: [store] }, attachTo: document.body });
        expect(test('evr-loading').exists()).toBe(true);
        await flushPromises();

        expect(test('evr-loading').exists()).toBe(false);
        expect(sentNames()).toEqual(['all']);
        expect(sent()[0]).toMatchObject({ limit: 50, timezone: expect.any(String) });
        expect(rowNames()).toEqual(['Rotate the keys', 'Renew the domain']);
        expect(test('evr-total').exists()).toBe(true);
        expect(store.getters['everything/total']).toBe(5);

        await test('evr-more').trigger('click');
        await flushPromises();
        expect(rowNames()).toEqual(['Rotate the keys', 'Renew the domain', 'Fix the footer', 'Draw the home page']);
        expect(rowOf('Rotate the keys').find('.evr__key').text()).toBe('OPS-5');
        expect(rowOf('Fix the footer').find('.evr__key').text()).toBe('WEB-3');
        expect(rowOf('Fix the footer').find('.evr__project').attributes('title')).toBe('Website');
        expect(rowOf('Draw the home page').find('.evr__subs').text()).toBe('2');
        expect(wrapper.findAll('[data-test="evr-group-head"]')).toHaveLength(0);
    });

    it('opens a row in the task panel with that row\'s own project, sprint and folder', async () => {
        await open();
        await rowOf('Rotate the keys').find('.evr__name').trigger('click');
        expect(overlayState.open).toBe(true);
        expect(overlayState.current).toEqual({ companyId: 'company-1', projectId: OPS, sprintId: '6f0000000000000000000b01', folderId: '6f0000000000000000000d01', taskId: '6f0000000000000000000f05' });
        expect(router.replace.mock.calls.at(-1)[0]).toEqual({ query: { task: '6f0000000000000000000f05' } });

        await test('evr-more').trigger('click');
        await flushPromises();
        await rowOf('Fix the footer').trigger('click');
        expect(overlayState.current).toMatchObject({ projectId: WEB, folderId: '', taskId: '6f0000000000000000000f03' });
    });

    it('lets the panel walk the rows in the order the page shows them', async () => {
        await open();
        await rowOf('Rotate the keys').find('.evr__name').trigger('click');
        expect(overlayState.nav).toMatchObject({ index: 0, total: 2 });
        expect(overlayState.nav.next).toMatchObject({ taskId: '6f0000000000000000000f04', projectId: OPS });
    });

    it('says when nothing matches and offers to clear the filters', async () => {
        await open();
        vi.useFakeTimers();
        await test('evr-search').setValue('nothing is called this');
        expect(apiRequest).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(300);
        vi.useRealTimers();
        await flushPromises();

        expect(sentNames().at(-1)).toBe('nothing');
        expect(sent().at(-1).filter.search).toBe('nothing is called this');
        expect(test('evr-empty').exists()).toBe(true);
        expect(rows()).toHaveLength(0);

        await test('evr-empty').find('button').trigger('click');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('all');
        expect(test('evr-search').element.value).toBe('');
        expect(rowNames()).toHaveLength(2);
    });

    it('shows an error with a way to try again', async () => {
        apiRequest.mockImplementationOnce(() => Promise.reject(new Error('network')));
        await open();
        expect(test('evr-error').exists()).toBe(true);
        expect(rows()).toHaveLength(0);

        await test('evr-retry').trigger('click');
        await flushPromises();
        expect(test('evr-error').exists()).toBe(false);
        expect(rowNames()).toHaveLength(2);
    });
});

describe('the controls', () => {
    it('start with done work hidden, subtasks off and closed projects out', async () => {
        await open();
        expect(test('evr-hide-done').element.checked).toBe(true);
        expect(test('evr-subtasks').element.checked).toBe(false);
        expect(test('evr-closed').element.checked).toBe(false);
        expect(sent()[0]).toMatchObject({ filter: { statusType: ['default_active', 'active'] }, includeSubtasks: false, includeClosedProjects: false, sort: { by: 'updatedAt', dir: 'desc' } });
        expect(sent()[0]).not.toHaveProperty('cursor');
    });

    it('send each toggle, the sort and the filters as data', async () => {
        await open();
        await test('evr-hide-done').setValue(false);
        await flushPromises();
        expect(sentNames().at(-1)).toBe('withDone');

        await test('evr-subtasks').setValue(true);
        await test('evr-closed').setValue(true);
        await test('evr-sort').setValue('DueDate:asc');
        await flushPromises();
        expect(sent().at(-1)).toMatchObject({ includeSubtasks: true, includeClosedProjects: true, sort: { by: 'DueDate', dir: 'asc' } });

        await pick('status', 'Doing');
        await pick('priority', 'High');
        await pick('type', 'Bug');
        await pick('project', 'Website');
        await pick('assignee', 'Person 2');
        expect(sent().at(-1).filter).toEqual({ status: ['Doing'], assignee: ['6f0000000000000000000002'], priority: ['HIGH'], taskType: ['bug'], projectIds: [WEB] });
        expect(sent().every((body) => Object.keys(body).every((key) => ['filter', 'group', 'sort', 'cursor', 'limit', 'includeSubtasks', 'includeClosedProjects', 'timezone'].includes(key)))).toBe(true);
    });

    it('offers the people with a seat, and "Me" as a shortcut', async () => {
        await open();
        await test('evr-filter-assignee').trigger('click');
        expect(wrapper.findAll('[data-test="evr-option"]').map((option) => option.text())).toEqual(['Everything.unassigned', 'Me Myself', 'Person 2']);
        await test('evr-filter-assignee').trigger('click');

        await test('evr-me').trigger('click');
        await flushPromises();
        expect(sent().at(-1).filter.assignee).toEqual(['user-1']);
        expect(test('evr-me').attributes('aria-pressed')).toBe('true');

        await test('evr-me').trigger('click');
        await flushPromises();
        expect(sent().at(-1).filter).not.toHaveProperty('assignee');
    });

    it('filters by one due-date bucket, sent as dates', async () => {
        await open();
        await pick('due', 'List.due_group_overdue');
        expect(Object.keys(sent().at(-1).filter.dueDate)).toEqual(['to']);
        await pick('due', 'List.due_group_none');
        expect(sent().at(-1).filter.dueDate).toEqual({ none: true });
    });

    it('waits for the typing to stop before it searches', async () => {
        await open();
        vi.useFakeTimers();
        const search = test('evr-search');
        await search.setValue('f');
        await search.setValue('fo');
        await search.setValue('footer');
        vi.advanceTimersByTime(299);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(sent().at(-1).filter.search).toBe('footer');
    });
});

describe('groups', () => {
    it('shows each group with its count and reads a group\'s rows by sending the group as a filter', async () => {
        await open();
        await test('evr-group').setValue('status');
        await flushPromises();

        expect(sentNames().at(-1)).toBe('statusCounts');
        const heads = wrapper.findAll('[data-test="evr-group-head"]');
        expect(heads.map((head) => head.find('.evr__group-name').text())).toEqual(['Doing', 'To Do']);
        expect(heads.map((head) => head.find('.evr__group-count').text())).toEqual(['3', '2']);
        expect(rows()).toHaveLength(0);

        const [doing, toDo] = wrapper.findAllComponents({ name: 'EverythingGroup' });
        await doing.find('[data-test="evr-more"]').trigger('click');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('statusDoing');
        expect(sent().at(-1).filter.status).toEqual(['Doing']);
        expect(sent().at(-1)).not.toHaveProperty('cursor');
        expect(doing.findAllComponents({ name: 'EverythingRow' })).toHaveLength(2);
        expect(toDo.findAllComponents({ name: 'EverythingRow' })).toHaveLength(0);

        await doing.find('[data-test="evr-more"]').trigger('click');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('statusDoingNext');
        expect(sent().at(-1).cursor).toBe(fixture.statusDoing.response.data.nextCursor);
        expect(doing.findAllComponents({ name: 'EverythingRow' })).toHaveLength(3);
        expect(doing.find('[data-test="evr-more"]').exists()).toBe(false);
    });

    it('names a project group by its project and a person group by the person', async () => {
        await open();
        await test('evr-group').setValue('project');
        await flushPromises();
        expect(wrapper.findAll('.evr__group-name').map((name) => name.text()).sort()).toEqual(['Operations', 'Website']);

        await test('evr-group').setValue('assignee');
        await flushPromises();
        expect(wrapper.findAll('.evr__group-name').map((name) => name.text()).at(-1)).toBe('Everything.unassigned');
        expect(test('evr-total').exists()).toBe(false);
    });

    it('folds a group away and back', async () => {
        await open();
        await test('evr-group').setValue('status');
        await flushPromises();
        const head = wrapper.find('[data-test="evr-group-head"]');
        expect(head.attributes('aria-expanded')).toBe('true');
        await head.trigger('click');
        expect(head.attributes('aria-expanded')).toBe('false');
    });
});

describe('inline edits', () => {
    const statusCell = (name) => rowOf(name).findComponent({ name: 'ListStatusCircle' });
    const priorityCell = (name) => rowOf(name).findComponent({ name: 'ListPriorityCell' });
    const twoProjects = async () => {
        await open();
        await test('evr-more').trigger('click');
        await flushPromises();
    };

    it('offers each row the statuses of its own project', async () => {
        await twoProjects();
        expect(statusCell('Rotate the keys').props('statuses').map((status) => status.name)).toEqual(['To Do', 'Doing', 'Waiting on a supplier', 'Done']);
        expect(statusCell('Fix the footer').props('statuses').map((status) => status.name)).toEqual(['To Do', 'Doing', 'Done']);
        expect(statusCell('Rotate the keys').props()).toMatchObject({ editable: true, chip: true });
    });

    it('writes a status through the task update call, with the row\'s project, and then reads page one again', async () => {
        await twoProjects();
        const waiting = statusCell('Rotate the keys').props('statuses').find((status) => status.name === 'Waiting on a supplier');
        apiRequest.mockClear();

        statusCell('Rotate the keys').vm.$emit('change', waiting);
        await flushPromises();

        expect(taskClass.updateStatus).toHaveBeenCalledTimes(1);
        const call = taskClass.updateStatus.mock.calls[0][0];
        expect(call.newStatus).toEqual({ status: { text: 'Waiting on a supplier', key: 4, type: 'active', value: undefined }, statusType: 'active', statusKey: 4 });
        expect(call.projectData).toEqual({ _id: OPS, CompanyId: 'company-1', ProjectName: 'Operations', ProjectCode: 'OPS' });
        expect(call.task).toMatchObject({ _id: '6f0000000000000000000f05', ProjectID: OPS, statusKey: 2 });
        expect(call.prevStatus).toMatchObject({ statusName: 'Doing', updatedTaskName: 'Waiting on a supplier', taskId: '6f0000000000000000000f05' });
        expect(call.userData).toEqual({ id: 'user-1', Employee_Name: 'Me Myself', companyOwnerId: 'owner-1' });
        expect(sentNames()).toEqual(['all']);
    });

    it('shows the new status at once and puts the old one back when the write fails', async () => {
        await twoProjects();
        let fail;
        taskClass.updateStatus.mockImplementationOnce(() => new Promise((resolve, reject) => { fail = reject; }));
        const cell = statusCell('Rotate the keys');
        cell.vm.$emit('change', cell.props('statuses')[0]);
        await flushPromises();
        expect(statusCell('Rotate the keys').text()).toBe('To Do');

        apiRequest.mockClear();
        fail({ status: false });
        await flushPromises();
        expect(statusCell('Rotate the keys').text()).toBe('Doing');
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('shows priority only where the project has the Priority app, and writes it for that project', async () => {
        await twoProjects();
        expect(priorityCell('Rotate the keys').exists()).toBe(false);
        expect(priorityCell('Fix the footer').props('editable')).toBe(true);

        priorityCell('Fix the footer').vm.$emit('change', { value: 'HIGH' });
        await flushPromises();
        const call = taskClass.updatePriority.mock.calls[0][0];
        expect(call.firebaseObj).toEqual({ Task_Priority: 'HIGH' });
        expect(call.projectData).toEqual({ _id: WEB, ProjectName: 'Website', CompanyId: 'company-1' });
        expect(call.taskData._id).toBe('6f0000000000000000000f03');
        expect(call.priorityObj).toMatchObject({ priorityName: 'Medium', newPriorityName: 'High', taskName: 'Fix the footer' });
    });

    it('opens nothing to edit where the role may not edit', async () => {
        await twoProjects();
        const cards = store.getters['everything/projects'];
        store.commit('everything/groupPage', { id: 'all', rows: [], nextCursor: null, projects: { [OPS]: { ...cards[OPS], edit: { status: false, priority: false } } } });
        await flushPromises();
        expect(statusCell('Rotate the keys').props('editable')).toBe(false);

        statusCell('Rotate the keys').vm.$emit('change', statusCell('Rotate the keys').props('statuses')[0]);
        await flushPromises();
        expect(taskClass.updateStatus).not.toHaveBeenCalled();
    });
});

describe('freshness', () => {
    it('reads page one again when the window is focused, without clearing the rows', async () => {
        await open();
        apiRequest.mockClear();
        window.dispatchEvent(new Event('focus'));
        expect(rowNames()).toHaveLength(2);
        expect(test('evr-loading').exists()).toBe(false);
        await flushPromises();
        expect(sentNames()).toEqual(['all']);
        expect(rowNames()).toHaveLength(2);
    });

    it('reads again when the task panel closes, and stops listening once the page is left', async () => {
        await open();
        await rowOf('Rotate the keys').find('.evr__name').trigger('click');
        apiRequest.mockClear();
        closeTask();
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(1);

        wrapper.unmount();
        wrapper = null;
        apiRequest.mockClear();
        window.dispatchEvent(new Event('focus'));
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('remembered settings', () => {
    it('keeps the last filter, group and sort for the person in this browser, and not the search', async () => {
        await open();
        await test('evr-group').setValue('status');
        await test('evr-hide-done').setValue(false);
        await flushPromises();
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
        expect(saved).toMatchObject({ group: 'status', hideDone: false, search: '' });

        wrapper.unmount();
        await open();
        expect(test('evr-group').element.value).toBe('status');
        expect(test('evr-hide-done').element.checked).toBe(false);
        expect(sent().at(-1)).toMatchObject({ group: 'status' });
    });

    it('starts from the defaults when what was saved cannot be read', async () => {
        localStorage.setItem(SETTINGS_KEY, '{ not json');
        await open();
        expect(test('evr-group').element.value).toBe('none');
        expect(sentNames()).toEqual(['all']);

        wrapper.unmount();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ group: 'customField', findQuery: [{ $match: {} }], hideDone: 'no' }));
        await open();
        expect(sentNames().at(-1)).toBe('all');
    });
});
