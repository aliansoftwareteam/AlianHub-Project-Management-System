import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const echo = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        useCustomComposable: () => ({ ...real.useCustomComposable(), checkPermission: () => true, checkApps: () => true }),
        useGetterFunctions: () => ({ ...real.useGetterFunctions(), getUser: () => null, getTaskStatus: () => ({ name: 'To do' }) }),
    };
});
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));

import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';

const KEPT = '/api/v1/ai/task-values';
const SUMMARY = '/api/v1/ai/task-summary';
const CATEGORY = '/api/v1/ai/task-category';
const ok = (data) => ({ data: { status: true, data } });
const NOW = '2026-10-01T10:00:00.000Z';

/* What the server holds: kept values by task, and a model call for each generation. */
let server;
const serve = () => {
    server = { kept: {}, reads: [], summaryCalls: [], categoryCalls: [] };
    apiRequest.mockImplementation(async (method, url, body) => {
        if (url === KEPT) {
            server.reads.push(body);
            const values = {};
            body.taskIds.forEach((id) => {
                const mine = Object.fromEntries(Object.entries(server.kept[id] || {}).filter(([kind]) => body.kinds.includes(kind)));
                if (Object.keys(mine).length) values[id] = mine;
            });
            return ok({ values });
        }
        if (url === SUMMARY) {
            server.summaryCalls.push(body);
            return ok({ summary: `Summary of ${body.taskId}`, commentCount: 2, summaryCount: 2, updatedAt: NOW, cached: false });
        }
        if (url === CATEGORY) {
            server.categoryCalls.push(body);
            return ok({ configured: true, category: 'Bug', source: 'tag', sourceName: '', updatedAt: NOW, cached: false });
        }
        throw new Error(`unexpected ${method} ${url}`);
    });
};
const keptSummary = (over = {}) => ({ summary: 'Shipping on Friday.', commentCount: 2, summaryCount: 2, updatedAt: NOW, stale: false, madeBy: 'u1', ...over });
const keptArea = (over = {}) => ({ category: 'Bug', source: 'tag', sourceName: '', reason: '', updatedAt: NOW, stale: false, madeBy: 'u1', ...over });

const tasks = (n) => Array.from({ length: n }, (_, i) => ({ _id: `t${i + 1}`, TaskName: `Task ${i + 1}`, TaskKey: `WEB-${i + 1}`, isParentTask: true, statusKey: 1, sprintId: 's1', AssigneeUserId: [], tagsArray: [] }));

const store = createStore({
    getters: {
        'settings/companyPriority': () => [],
        'settings/companyMembers': () => [],
        'settings/teams': () => [],
        'projectData/currentProjectDetails': () => ({}),
        'users/users': () => [],
    },
});
const project = { _id: 'p1', isGlobalPermission: true, tagsArray: [], apps: ['AI'] };
const columns = (ids) => ids.map((id) => ({ id, ai: true, labelKey: `List.col_${id}` }));
const global = (shown = ['summary', 'area']) => ({
    plugins: [store],
    mocks: { $t: echo },
    provide: {
        selectedProject: ref(project),
        showArchived: ref(false),
        tableColumns: ref(columns(shown)),
        $clientWidth: ref(1280),
        $defaultUserAvatar: ref(''),
        $defaultGhostCustomUserImg: ref(''),
        $defaultTaskStatusImg: ref(''),
    },
    stubs: { ShellIcon: true, ProvenanceBadge: true, ConfirmationSidebar: true, TaskTagCell: true, TaskColumnCell: true, ListStatusCircle: true },
});

/* The module state of the two composables is one per page load, so each test loads the page again. */
const load = async () => {
    vi.resetModules();
    const [{ default: TableRow }, { default: AiColumnHead }, summaries, categories] = await Promise.all([
        import('@/views/Projects/TableView/TableRow.vue'),
        import('@/views/Projects/TableView/AiColumnHead.vue'),
        import('@/views/Projects/TableView/useTaskSummaries.js'),
        import('@/views/Projects/TableView/useTaskCategories.js'),
    ]);
    return { TableRow, AiColumnHead, summaries: summaries.useTaskSummaries(), categories: categories.useTaskCategories() };
};

const scrollIntoView = async (TableRow, rows, shown) => {
    const wrappers = rows.map((data) => mount(TableRow, { props: { data }, global: global(shown), attachTo: document.body }));
    await flushPromises();
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    await flushPromises();
    return wrappers;
};
const cell = (wrapper, column) => wrapper.find(`[data-col="${column}"]`);

beforeEach(() => {
    apiRequest.mockReset();
    serve();
    localStorage.clear();
    document.body.innerHTML = '<div id="my-modal"></div>';
    resetAiAvailability();
    applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: true });
    window.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; }
        observe() { this.callback([{ isIntersecting: true }]); }
        unobserve() {}
        disconnect() {}
    };
});
afterEach(() => { vi.useRealTimers(); });

describe('rows of a Table with the AI columns shown', () => {
    it('read their kept values in one request as they scroll into view, and call no model', async () => {
        server.kept.t1 = { summary: keptSummary(), category: keptArea() };
        const { TableRow } = await load();
        const rows = await scrollIntoView(TableRow, tasks(12));

        expect(server.reads).toHaveLength(1);
        expect(server.reads[0].taskIds).toHaveLength(12);
        expect([...server.reads[0].kinds].sort()).toEqual(['category', 'summary']);
        expect(server.summaryCalls).toEqual([]);
        expect(server.categoryCalls).toEqual([]);
        expect(cell(rows[0], 'summary').text()).toContain('Shipping on Friday.');
        expect(cell(rows[0], 'area').text()).toContain('Bug');
    });

    it('offer "Generate" where nothing is kept, and that asks for the one row', async () => {
        const { TableRow } = await load();
        const rows = await scrollIntoView(TableRow, tasks(3));
        const button = cell(rows[1], 'summary').find('.tv2__gen');
        expect(button.text()).toContain('List.ai_generate');

        await button.trigger('click');
        await flushPromises();
        expect(server.summaryCalls).toEqual([{ taskId: 't2', force: true }]);
        expect(server.categoryCalls).toEqual([]);
        expect(cell(rows[1], 'summary').text()).toContain('Summary of t2');
        expect(cell(rows[0], 'summary').find('.tv2__gen').exists()).toBe(true);

        await cell(rows[2], 'area').find('.tv2__gen').trigger('click');
        await flushPromises();
        expect(server.categoryCalls).toEqual([{ taskId: 't3', force: true }]);
    });

    it('ask for the kept values of the columns that are shown only', async () => {
        const { TableRow } = await load();
        await scrollIntoView(TableRow, tasks(2), ['area']);
        expect(server.reads.map((read) => read.kinds)).toEqual([['category']]);
    });

    it('show a kept value that is behind its source with the time it is from, and regenerate it only when asked', async () => {
        server.kept.t1 = { summary: keptSummary({ stale: true, commentCount: 5 }), category: keptArea({ stale: true }) };
        const { TableRow } = await load();
        const [row] = await scrollIntoView(TableRow, tasks(1));

        expect(cell(row, 'summary').text()).toContain('Shipping on Friday.');
        expect(cell(row, 'summary').find('[data-test="ai-stale"]').text()).toContain('List.ai_from');
        expect(cell(row, 'area').find('[data-test="ai-stale"]').text()).toContain('List.ai_from');
        expect(server.summaryCalls).toEqual([]);

        await cell(row, 'summary').find('[data-test="ai-regenerate"]').trigger('click');
        await flushPromises();
        expect(server.summaryCalls).toEqual([{ taskId: 't1', force: true }]);
        expect(cell(row, 'summary').find('[data-test="ai-stale"]').exists()).toBe(false);
    });

    it('keep a pinned value as it is, without reading or asking', async () => {
        localStorage.setItem('ah.aifields.pinned', JSON.stringify({ t1: { summary: 'Pinned text', updatedAt: NOW, commentCount: 1 } }));
        const { TableRow } = await load();
        const [row] = await scrollIntoView(TableRow, tasks(1), ['summary']);
        expect(cell(row, 'summary').text()).toContain('Pinned text');
        expect(server.reads).toEqual([]);
    });
});

describe('the header of an AI column', () => {
    const mountHead = async (AiColumnHead, rows, column = 'summary') => {
        const wrapper = mount(AiColumnHead, { props: { column: columns([column])[0], tasks: rows }, global: global() });
        await flushPromises();
        await new Promise((resolve) => { setTimeout(resolve, 60); });
        await flushPromises();
        return wrapper;
    };
    const generate = (wrapper) => wrapper.find('[data-test="ai-column-generate"]');
    const dialog = () => document.querySelector('#my-modal .modal');

    it('offers to generate for the rows shown that have no kept value, with their number', async () => {
        server.kept.t1 = { summary: keptSummary() };
        const { AiColumnHead } = await load();
        const wrapper = await mountHead(AiColumnHead, tasks(4));

        expect(wrapper.text()).toContain('List.col_summary');
        expect(generate(wrapper).text()).toBe('List.ai_generate_rows {"n":3}');
        expect(server.summaryCalls).toEqual([]);

        await generate(wrapper).trigger('click');
        await flushPromises();
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(server.summaryCalls.map((call) => call.taskId).sort()).toEqual(['t2', 't3', 't4']);
        expect(generate(wrapper).exists()).toBe(false);
    });

    it('asks first when more than 25 rows would be generated', async () => {
        const { AiColumnHead } = await load();
        const wrapper = await mountHead(AiColumnHead, tasks(30), 'area');
        expect(generate(wrapper).text()).toBe('List.ai_generate_rows {"n":30}');

        await generate(wrapper).trigger('click');
        await flushPromises();
        expect(dialog().textContent).toContain('List.ai_generate_rows_confirm {"n":30}');
        expect(server.categoryCalls).toEqual([]);

        dialog().querySelector('.outline-secondary').click();
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(server.categoryCalls).toEqual([]);

        await generate(wrapper).trigger('click');
        await flushPromises();
        dialog().querySelector('.btn-primary').click();
        for (let i = 0; i < 12; i += 1) await flushPromises();
        expect(server.categoryCalls).toHaveLength(30);
    });

    it('generates for at most 50 rows at a time, and says so in its label', async () => {
        const { AiColumnHead } = await load();
        const wrapper = await mountHead(AiColumnHead, tasks(80));
        expect(generate(wrapper).text()).toBe('List.ai_generate_rows {"n":50}');
        expect(server.reads.reduce((sum, read) => sum + read.taskIds.length, 0)).toBe(80);
        expect(Math.max(...server.reads.map((read) => read.taskIds.length))).toBeLessThanOrEqual(100);
    });

    it('offers nothing when AI is off, and nothing when every row has a value', async () => {
        server.kept.t1 = { summary: keptSummary() };
        const { AiColumnHead } = await load();
        expect(generate(await mountHead(AiColumnHead, tasks(1))).exists()).toBe(false);

        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        const off = await load();
        expect(generate(await mountHead(off.AiColumnHead, tasks(3))).exists()).toBe(false);
    });
});
