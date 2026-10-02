/* Task 046 M2, slice E3: the Everything page's Board and Table modes and its saved views. The store
   is the real one and `@/services` answers from the recorded server responses. A read of tasks is
   matched to a recording without today's date, the timezone, the page size and the sort (the
   recordings are all newest first); a saved view's request has none of those and must match a
   recording exactly. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import fixture from '../fixtures/everythingResponses.json';

const { apiRequest, taskClass, toast, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    taskClass: { updateStatus: vi.fn(() => Promise.resolve({ status: true })), updatePriority: vi.fn(() => Promise.resolve({ status: true })) },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    route: { path: '/company-1/everything', name: 'Everything', query: {}, params: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => true }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/utils/TaskOperations', () => ({ default: taskClass }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ getWasabiImageLink: () => Promise.resolve('') }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `Person ${String(id).slice(-1)}` }) })
}));
vi.mock('@/composable/commonFunction', () => ({ isBundledPriorityImage: () => true }));
vi.mock('@/components/atom/TaskTypeIcon/TaskTypeIcon.vue', () => ({ default: { name: 'TaskTypeIcon', render: () => null } }));
vi.mock('@/views/Projects/ListView/ListAssigneeCell.vue', () => ({ default: { name: 'ListAssigneeCell', props: ['task'], render: () => null } }));
vi.mock('@/views/Projects/ListView/ListDueCell.vue', () => ({ default: { name: 'ListDueCell', props: ['task', 'done'], render: () => null } }));
vi.mock('@/views/Projects/ListView/ListStatusCircle.vue', async () => {
    const { h } = await import('vue');
    return { default: { name: 'ListStatusCircle', props: { task: Object, statuses: Array, editable: Boolean, chip: Boolean }, emits: ['change'], render() { return h('span', { class: 'stub-status' }, this.task.status?.text); } } };
});
vi.mock('@/views/Projects/ListView/ListPriorityCell.vue', () => ({ default: { name: 'ListPriorityCell', props: { task: Object, editable: Boolean }, emits: ['change'], render: () => null } }));

import everything from '@/store/Everything';
import Everything from '@/views/Everything/Everything.vue';
import { bindRouter, closeTask, overlayState } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

const TASKS = '/api/v2/tasks/everything';
const WEB = '6f0000000000000000000a01';
const OPS = '6f0000000000000000000a02';
const WORKING_KEY = 'ah.everything.company-1.user-1';
const created = fixture.viewCreated.response.data;

const canon = (value) => {
    if (Array.isArray(value)) return value.map(canon);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
    return value;
};
const text = (value) => JSON.stringify(canon(value));
const shapeOf = (body) => text({ ...body, timezone: undefined, limit: undefined, sort: undefined });
const readAs = (body) => Object.keys(fixture).find((name) => !fixture[name].request.path && shapeOf(fixture[name].request) === shapeOf(body));
const viewAs = (method, url, body) => Object.keys(fixture).find((name) => {
    const { request } = fixture[name];
    return request.path === url && request.method === method && text(request.body) === text(body);
});

const saved = { list: [] };
const answer = (method, url, body) => {
    if (url === TASKS) return Promise.resolve({ data: (fixture[readAs(body)] || fixture.nothing).response });
    if (method === 'get') return Promise.resolve({ data: { status: true, statusText: 'Views fetched successfully.', data: saved.list } });
    const name = viewAs(method, url, body);
    if (!name) return Promise.reject(new Error(`a view request the server never recorded: ${method} ${url} ${JSON.stringify(body)}`));
    const { statusCode, response } = fixture[name];
    return statusCode === 200 ? Promise.resolve({ data: response }) : Promise.reject({ response: { status: statusCode, data: response } });
};

const reads = () => apiRequest.mock.calls.filter(([, url]) => url === TASKS).map(([, , body]) => body);
const readNames = () => reads().map(readAs);
const viewCalls = () => apiRequest.mock.calls.filter(([method, url]) => url !== TASKS && method !== 'get').map(([method, url, body]) => viewAs(method, url, body));

const projectList = Object.values(fixture.withSubtasks.response.data.projects).map((card) => ({ ...card, deletedStatusKey: 0 }));
const newStore = () => createStore({
    modules: {
        everything,
        settings: {
            namespaced: true,
            getters: {
                companyPriority: () => [{ value: 'HIGH', name: 'High' }, { value: 'MEDIUM', name: 'Medium' }],
                companyUsers: () => [{ userId: 'user-1' }],
                companyOwnerDetail: () => ({ userId: 'owner-1' }),
                selectedCompany: () => ({ planFeature: { projectProjectApp: true } })
            }
        },
        projectData: { namespaced: true, getters: { allProjects: () => ({ data: projectList }) } }
    }
});

let wrapper;
let store;
const open = async ({ width = 1280 } = {}) => {
    store = newStore();
    wrapper = mount(Everything, { global: { plugins: [store], provide: { $clientWidth: ref(width) } }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};
const test = (name) => wrapper.find(`[data-test="${name}"]`);
const all = (name) => wrapper.findAll(`[data-test="${name}"]`);
const mode = async (name) => { await test(`evr-mode-${name}`).trigger('click'); await flushPromises(); };
const columns = () => wrapper.findAllComponents({ name: 'EverythingColumn' });
const column = (name) => columns().find((entry) => entry.find('.evr__col-name').text() === name);
const cardNames = (name) => column(name).findAllComponents({ name: 'EverythingCard' }).map((card) => card.find('.evr__name').text());
const card = (name) => wrapper.findAllComponents({ name: 'EverythingCard' }).find((entry) => entry.find('.evr__name').text() === name);
const loadColumn = async (name) => { await column(name).find('[data-test="evr-more"]').trigger('click'); await flushPromises(); };
const drag = async (taskName, columnName) => {
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    await card(taskName).trigger('dragstart', { dataTransfer });
    await column(columnName).trigger('dragover', { dataTransfer });
    await column(columnName).trigger('drop', { dataTransfer });
    await card(taskName)?.trigger('dragend');
    await flushPromises();
};
const board = async () => {
    await open();
    await mode('board');
    await loadColumn('Doing');
};
const workingState = () => JSON.parse(localStorage.getItem(WORKING_KEY));

beforeEach(() => {
    localStorage.clear();
    saved.list = [];
    apiRequest.mockReset();
    apiRequest.mockImplementation(answer);
    taskClass.updateStatus.mockReset();
    taskClass.updateStatus.mockImplementation(() => Promise.resolve({ status: true }));
    Object.values(toast).forEach((spy) => spy.mockClear());
    router.replace.mockClear();
    route.query = {};
    bindRouter(router, route);
});

afterEach(() => {
    closeTask({ keepRoute: true });
    wrapper?.unmount();
});

describe('the mode switch', () => {
    it('offers List, Board and Table, starts on List, and remembers the choice with the other settings', async () => {
        await open();
        expect(['list', 'board', 'table'].map((name) => test(`evr-mode-${name}`).attributes('aria-pressed'))).toEqual(['true', 'false', 'false']);
        expect(wrapper.findComponent({ name: 'EverythingGroup' }).exists()).toBe(true);

        await mode('table');
        expect(test('evr-mode-table').attributes('aria-pressed')).toBe('true');
        expect(wrapper.find('table.evr__table').exists()).toBe(true);
        expect(workingState()).toMatchObject({ mode: 'table' });

        wrapper.unmount();
        await open();
        expect(test('evr-mode-table').attributes('aria-pressed')).toBe('true');
        expect(wrapper.find('table.evr__table').exists()).toBe(true);
    });

    it('never sends the mode to the server', async () => {
        await open();
        await mode('board');
        await mode('table');
        reads().forEach((body) => expect(body).not.toHaveProperty('mode'));
    });
});

describe('the board', () => {
    it('has a column for each status name across projects, the empty ones too, and no group picker', async () => {
        await open();
        await test('evr-group').setValue('project');
        await mode('board');

        expect(readNames().at(-1)).toBe('statusCounts');
        expect(columns().map((entry) => `${entry.find('.evr__col-name').text()} ${entry.find('.evr__group-count').text()}`)).toEqual(['To Do 2', 'Doing 3', 'Waiting on a supplier 0']);
        expect(test('evr-group').exists()).toBe(false);
        expect(column('Waiting on a supplier').find('.evr__col-empty').exists()).toBe(true);
        expect(column('Waiting on a supplier').find('[data-test="evr-more"]').exists()).toBe(false);
    });

    it('pages each column on its own, with the status sent as a filter', async () => {
        await board();
        expect(readNames().at(-1)).toBe('statusDoing');
        expect(reads().at(-1).filter.status).toEqual(['Doing']);
        expect(cardNames('Doing')).toEqual(['Rotate the keys', 'Fix the footer']);
        expect(cardNames('To Do')).toEqual([]);

        await loadColumn('Doing');
        expect(readNames().at(-1)).toBe('statusDoingNext');
        expect(cardNames('Doing')).toEqual(['Rotate the keys', 'Fix the footer', 'Draw the home page']);
    });

    it('shows each card\'s project and opens it with that project', async () => {
        await board();
        expect(card('Rotate the keys').find('.evr__key').text()).toBe('OPS-5');
        expect(card('Fix the footer').find('.evr__project').attributes('title')).toBe('Website');

        await card('Fix the footer').trigger('click');
        expect(overlayState.current).toMatchObject({ projectId: WEB, taskId: '6f0000000000000000000f03', companyId: 'company-1' });
    });

    it('changes the status when a card is dropped on a column its own project has', async () => {
        await board();
        await drag('Rotate the keys', 'Waiting on a supplier');

        expect(taskClass.updateStatus).toHaveBeenCalledTimes(1);
        const call = taskClass.updateStatus.mock.calls[0][0];
        expect(call.newStatus).toMatchObject({ status: { text: 'Waiting on a supplier', key: 4, type: 'active' }, statusKey: 4 });
        expect(call.projectData).toMatchObject({ _id: OPS, ProjectName: 'Operations' });
        expect(call.task._id).toBe('6f0000000000000000000f05');
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('moves the card at once, before the server has answered', async () => {
        await board();
        taskClass.updateStatus.mockImplementationOnce(() => new Promise(() => {}));
        await drag('Rotate the keys', 'Waiting on a supplier');

        expect(cardNames('Waiting on a supplier')).toEqual(['Rotate the keys']);
        expect(cardNames('Doing')).toEqual(['Fix the footer']);
        expect(column('Doing').find('.evr__group-count').text()).toBe('2');
        expect(column('Waiting on a supplier').find('.evr__group-count').text()).toBe('1');
    });

    it('refuses a drop on a status the task\'s project does not have, says why, and leaves the card where it was', async () => {
        await board();
        await drag('Fix the footer', 'Waiting on a supplier');

        expect(taskClass.updateStatus).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error.mock.calls[0][0]).toBe('Everything.drop_no_status');
        expect(cardNames('Doing')).toEqual(['Rotate the keys', 'Fix the footer']);
        expect(cardNames('Waiting on a supplier')).toEqual([]);
    });

    it('marks the columns a dragged card cannot land in while it is being dragged', async () => {
        await board();
        await card('Fix the footer').trigger('dragstart', { dataTransfer: { setData: vi.fn() } });
        expect(column('Waiting on a supplier').classes()).toContain('is-refusing');
        expect(column('To Do').classes()).not.toContain('is-refusing');
        await card('Fix the footer').trigger('dragend');
        expect(column('Waiting on a supplier').classes()).not.toContain('is-refusing');
    });

    it('does nothing when a card is dropped on its own column', async () => {
        await board();
        await drag('Rotate the keys', 'Doing');
        expect(taskClass.updateStatus).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('puts the card back when the server refuses the change', async () => {
        await board();
        taskClass.updateStatus.mockImplementationOnce(() => Promise.reject({ status: false }));
        await drag('Rotate the keys', 'Waiting on a supplier');

        expect(cardNames('Doing')).toContain('Rotate the keys');
        expect(cardNames('Waiting on a supplier')).toEqual([]);
        expect(toast.error).toHaveBeenCalledWith('Toast.Status_not_updated', expect.anything());
    });

    it('lets a card be dragged only where the role may change status', async () => {
        await board();
        expect(card('Rotate the keys').attributes('draggable')).toBe('true');
        const cards = store.getters['everything/projects'];
        store.commit('everything/groupPage', { id: 'status:Doing', rows: [], nextCursor: null, projects: { [OPS]: { ...cards[OPS], edit: { status: false, priority: false } } } });
        await flushPromises();

        expect(card('Rotate the keys').attributes('draggable')).toBe('false');
        expect(card('Fix the footer').attributes('draggable')).toBe('true');
        expect(card('Rotate the keys').findComponent({ name: 'ListStatusCircle' }).props('editable')).toBe(false);
    });

    it('offers each card the statuses of its own project, for a change without dragging', async () => {
        await board();
        const control = card('Rotate the keys').findComponent({ name: 'ListStatusCircle' });
        expect(control.props('statuses').map((status) => status.name)).toEqual(['To Do', 'Doing', 'Waiting on a supplier', 'Done']);
        control.vm.$emit('change', control.props('statuses')[0]);
        await flushPromises();
        expect(taskClass.updateStatus.mock.calls[0][0].newStatus.statusKey).toBe(1);
    });

    it('shows the closed statuses as columns once done work is shown', async () => {
        await open();
        await test('evr-hide-done').setValue(false);
        await mode('board');
        expect(readNames().at(-1)).toBe('boardCounts');
        expect(columns().map((entry) => entry.find('.evr__col-name').text())).toEqual(['To Do', 'Doing', 'Waiting on a supplier', 'Done']);
        await loadColumn('Done');
        expect(readNames().at(-1)).toBe('boardDone');
        expect(cardNames('Done')).toEqual(['Archive last year']);
    });
});

describe('the table', () => {
    const header = (id) => test(`evr-th-${id}`);
    const rowNames = () => wrapper.findAllComponents({ name: 'EverythingTableRow' }).map((row) => row.find('.evr__name').text());

    it('has a column for name, project, status, priority, assignee, due date, type and updated', async () => {
        await open();
        await mode('table');
        expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual([
            'Everything.col_name', 'Everything.filter_project', 'Everything.filter_status', 'Everything.filter_priority',
            'Everything.filter_assignee', 'Everything.filter_due', 'Everything.filter_type', 'Everything.col_updated'
        ]);
        expect(rowNames()).toEqual(['Rotate the keys', 'Renew the domain']);
        expect(wrapper.find('tbody tr.evr__tr .evr__key').text()).toBe('OPS-5');
    });

    it('sorts on the server by due date or last update, and flips the direction on a second click', async () => {
        await open();
        await mode('table');
        expect(wrapper.find('th.evr__th--updated').attributes('aria-sort')).toBe('descending');
        expect(wrapper.find('th.evr__th--due').attributes('aria-sort')).toBeUndefined();

        await header('due').trigger('click');
        await flushPromises();
        expect(reads().at(-1).sort).toEqual({ by: 'DueDate', dir: 'asc' });
        expect(wrapper.find('th.evr__th--due').attributes('aria-sort')).toBe('ascending');

        await header('due').trigger('click');
        await flushPromises();
        expect(reads().at(-1).sort).toEqual({ by: 'DueDate', dir: 'desc' });

        await header('updated').trigger('click');
        await flushPromises();
        expect(reads().at(-1).sort).toEqual({ by: 'updatedAt', dir: 'desc' });
        expect(test('evr-sort').element.value).toBe('updatedAt:desc');
    });

    it.each(['name', 'project', 'status', 'priority', 'assignee', 'type'])('says the %s header cannot sort, and does not pretend to', async (id) => {
        await open();
        await mode('table');
        const before = reads().length;
        expect(header(id).attributes('aria-disabled')).toBe('true');
        expect(header(id).attributes('title')).toBe('Everything.sort_unavailable');
        await header(id).trigger('click');
        await flushPromises();
        expect(reads()).toHaveLength(before);
        expect(wrapper.find(`th.evr__th--${id}`).attributes('aria-sort')).toBeUndefined();
    });

    it('opens a row with its own project and edits status with that project\'s statuses', async () => {
        await open();
        await mode('table');
        const row = wrapper.findComponent({ name: 'EverythingTableRow' });
        expect(row.findComponent({ name: 'ListStatusCircle' }).props()).toMatchObject({ editable: true, chip: true });
        expect(row.findComponent({ name: 'ListStatusCircle' }).props('statuses')).toHaveLength(4);

        await row.trigger('click');
        expect(overlayState.current).toMatchObject({ projectId: OPS, taskId: '6f0000000000000000000f05' });
    });

    it('pages a group by sending the group as a filter, under a group header', async () => {
        await open();
        await test('evr-group').setValue('status');
        await mode('table');
        expect(all('evr-group-head').map((head) => head.find('.evr__group-name').text())).toEqual(['Doing', 'To Do']);

        const [doing] = wrapper.findAllComponents({ name: 'EverythingTableGroup' });
        await doing.find('[data-test="evr-more"]').trigger('click');
        await flushPromises();
        expect(readNames().at(-1)).toBe('statusDoing');
        expect(rowNames()).toEqual(['Rotate the keys', 'Fix the footer']);
    });

    it('is the List\'s row on a phone', async () => {
        await open({ width: 390 });
        await mode('table');
        expect(wrapper.find('table').exists()).toBe(false);
        expect(wrapper.findAllComponents({ name: 'EverythingRow' })).toHaveLength(2);
        expect(test('evr-mode-table').attributes('aria-pressed')).toBe('true');
    });
});

describe('saved views', () => {
    const openViews = async () => { await test('evr-views').trigger('click'); };
    const saveAs = async (name) => {
        await openViews();
        await test('evr-view-new-name').setValue(name);
        await test('evr-view-save').trigger('submit');
        await flushPromises();
    };
    const boardWithDone = async () => {
        await open();
        await test('evr-hide-done').setValue(false);
        await mode('board');
    };

    it('saves the page as it is under a name, shows that name, and keeps it as the view in use', async () => {
        await boardWithDone();
        await saveAs('My board');

        expect(viewCalls()).toEqual(['viewCreated']);
        expect(test('evr-views').text()).toContain('My board');
        expect(test('evr-view-dirty').exists()).toBe(false);
        expect(workingState()).toMatchObject({ viewId: created._id, mode: 'board', hideDone: false });
        expect(toast.success).toHaveBeenCalledWith('Everything.view_saved', expect.anything());
    });

    it('cannot save a view with no name', async () => {
        await open();
        await openViews();
        expect(test('evr-view-save').attributes('disabled')).toBeDefined();
        await test('evr-view-new-name').setValue('   ');
        expect(test('evr-view-save').attributes('disabled')).toBeDefined();
    });

    it('marks a view that was changed and saves the changes back to it', async () => {
        saved.list = [created];
        localStorage.setItem(WORKING_KEY, JSON.stringify({ ...created.settings, viewId: created._id }));
        await open();
        expect(test('evr-views').text()).toContain('My board');
        expect(test('evr-view-dirty').exists()).toBe(false);

        await test('evr-hide-done').setValue(true);
        await mode('table');
        await test('evr-group').setValue('project');
        await flushPromises();
        expect(test('evr-view-dirty').exists()).toBe(true);

        await openViews();
        await test('evr-view-save-changes').trigger('click');
        await flushPromises();
        expect(viewCalls()).toEqual(['viewChanged']);
        expect(test('evr-view-dirty').exists()).toBe(false);
    });

    it('renames a view, sets it as the default and clears the default again', async () => {
        saved.list = [created];
        await open();
        await openViews();
        await test('evr-view-rename').trigger('click');
        await test('evr-view-rename-name').setValue('Board, with done');
        await test('evr-view-rename-save').trigger('submit');
        await flushPromises();
        expect(viewCalls()).toEqual(['viewRenamed']);
        expect(test('evr-view-open').text()).toBe('Board, with done');

        expect(test('evr-view-default').attributes('aria-pressed')).toBe('false');
        await test('evr-view-default').trigger('click');
        await flushPromises();
        expect(viewCalls().at(-1)).toBe('viewDefault');
        expect(test('evr-view-default').attributes('aria-pressed')).toBe('true');
    });

    it('asks before deleting a view, and forgets it once deleted', async () => {
        saved.list = [created];
        localStorage.setItem(WORKING_KEY, JSON.stringify({ ...created.settings, viewId: created._id }));
        await open();
        await openViews();
        await test('evr-view-delete').trigger('click');
        expect(viewCalls()).toEqual([]);
        await test('evr-view-delete-confirm').trigger('click');
        await flushPromises();

        expect(viewCalls()).toEqual(['viewDeleted']);
        expect(all('evr-view')).toHaveLength(0);
        expect(test('evr-views').text()).toContain('Everything.views');
        expect(workingState().viewId).toBe('');
    });

    it('opens a person\'s default view when they left nothing on screen last time', async () => {
        saved.list = [{ ...created, isDefault: true }, { ...created, _id: 'other', name: 'Other', settings: { mode: 'table' } }];
        await open();

        expect(test('evr-views').text()).toContain('My board');
        expect(test('evr-mode-board').attributes('aria-pressed')).toBe('true');
        expect(test('evr-hide-done').element.checked).toBe(false);
        expect(readNames()).toEqual(['boardCounts']);
    });

    it('keeps what was left on screen over the default view', async () => {
        saved.list = [{ ...created, isDefault: true }];
        localStorage.setItem(WORKING_KEY, JSON.stringify({ mode: 'list', group: 'status', viewId: '' }));
        await open();

        expect(test('evr-mode-list').attributes('aria-pressed')).toBe('true');
        expect(readNames()).toEqual(['statusCounts']);
        expect(test('evr-views').text()).toContain('Everything.views');
    });

    it('opens another view from the switcher, and can leave a view without losing the settings', async () => {
        saved.list = [created];
        await open();
        await openViews();
        await test('evr-view-open').trigger('click');
        await flushPromises();
        expect(test('evr-mode-board').attributes('aria-pressed')).toBe('true');
        expect(readNames().at(-1)).toBe('boardCounts');
        expect(workingState().viewId).toBe(created._id);

        await openViews();
        await test('evr-view-none').trigger('click');
        expect(test('evr-views').text()).toContain('Everything.views');
        expect(test('evr-mode-board').attributes('aria-pressed')).toBe('true');
        expect(workingState().viewId).toBe('');
    });

    it('says so when the server refuses a view, and carries on', async () => {
        await open();
        apiRequest.mockImplementationOnce(() => Promise.reject({ response: { status: 400, data: fixture.viewRefused.response } }));
        await saveAs('Not a view');

        expect(toast.error).toHaveBeenCalledWith('Everything.view_failed', expect.anything());
        expect(test('evr-views').text()).toContain('Everything.views');
        expect(wrapper.findAllComponents({ name: 'EverythingRow' })).toHaveLength(2);
    });

    it('still lists tasks when the views cannot be read', async () => {
        apiRequest.mockImplementation((method, url, body) => (url === TASKS ? answer(method, url, body) : Promise.reject(new Error('network'))));
        await open();
        expect(wrapper.findAllComponents({ name: 'EverythingRow' })).toHaveLength(2);
    });
});
