/* The bulk bar fits the width it is given: what does not fit goes behind More, built from the
   same action definitions, so every action stays reachable and none is cut off. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { nextTick, ref } from 'vue';
import { readFileSync } from 'fs';
import path from 'path';
import taskSelection from '@/store/TaskSelection';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable/aiAvailability', () => ({ canUseAi: () => true }));
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({ useTaskSummaries: () => ({ generateMany: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => false }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `User ${id}` }) })
}));
vi.mock('@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue', () => ({
    __esModule: true,
    default: { name: 'ConvertToSubTaskSidebar', template: '<div class="placement-stub"></div>' }
}));

import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';
import { fitInline } from '@/views/Projects/ListView/bulkBarFit.js';

const SRC = path.resolve(__dirname, '../../src');
const css = (file) => readFileSync(path.join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const ALL = ['status', 'priority', 'assignee', 'due', 'sprint', 'tags', 'convert', 'ai', 'archive', 'delete'];
const project = {
    _id: 'p1', ProjectCode: 'P1', ProjectName: 'QA Sandbox', isGlobalPermission: true,
    taskStatusData: [{ key: 1, name: 'To do', type: 'default_active' }],
    apps: [{ key: 'Priority' }],
    sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } },
    tagsArray: [{ uid: 'tag1', tagName: 'Bug' }],
    AssigneeUserId: ['u1']
};
const task = { _id: 't1', isParentTask: true, statusKey: 1, sprintId: 's1', AssigneeUserId: [], tagsArray: [] };

/* The widths the bar measured in the running app at 12.5px, in the order it shows them. */
const WIDTH = { count: 56, clear: 28, more: 50, status: 43, priority: 46, assignee: 58, due: 58, sprint: 40, tags: 35, convert: 52, ai: 72, archive: 40, delete: 35 };
const GAP = 14;

let barWidth = 0;
let observers = [];

function fakeLayout() {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function offsetWidth() {
        if (this.hasAttribute('data-bulk-action')) return WIDTH[this.getAttribute('data-bulk-action')];
        if (this.hasAttribute('data-bulk-more')) return WIDTH.more;
        if (this.classList.contains('lv2-bulk__count')) return WIDTH.count;
        if (this.classList.contains('lv2-bulk__clear')) return WIDTH.clear;
        return 0;
    });
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth() {
        return this.classList.contains('lv2-bulk') ? barWidth : 0;
    });
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
        const style = computed(el, pseudo);
        if (!el.classList?.contains('lv2-bulk')) return style;
        return new Proxy(style, { get: (target, key) => (key === 'columnGap' ? `${GAP}px` : key === 'paddingLeft' || key === 'paddingRight' ? '0px' : target[key]) });
    });
    window.ResizeObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() {}
        unobserve() {}
        disconnect() { observers = observers.filter((observer) => observer !== this); }
    };
}

async function resizeTo(width) {
    barWidth = width;
    observers.forEach((observer) => observer.callback([]));
    await flushPromises();
    await nextTick();
}

async function mountBar({ width, viewport = width }) {
    barWidth = width;
    const store = createStore({
        modules: {
            taskSelection: { ...taskSelection, state: () => ({ selectedTaskIds: ['t1'], lastAnchorId: null, activeView: 'list', activeProjectId: 'p1' }) },
            projectData: {
                namespaced: true,
                state: () => ({ tasks: { p1: { sprints: ['s1'], s1: { tasks: [task] } } }, searchedTasks: [], allProjects: { data: [project] } }),
                getters: { onlyActiveProjects: (state) => state.allProjects },
                mutations: { mutateSprints: () => {} }
            },
            settings: {
                namespaced: true,
                getters: {
                    companyUsers: () => [{ userId: 'u1', isDelete: false }],
                    companyOwnerDetail: () => ({ userId: 'owner' }),
                    companyPriority: () => [{ name: 'High', value: 'HIGH' }],
                    selectedCompany: () => ({ planFeature: { projectProjectApp: true } }),
                    finalCustomFields: () => [],
                    projectRawRules: () => []
                }
            }
        }
    });
    const wrapper = mount(ListBulkBar, {
        attachTo: document.body,
        props: { project },
        global: { plugins: [store], provide: { $clientWidth: ref(viewport), $userId: ref('u1') }, stubs: { ConfirmationSidebar: true, CalenderCompo: true } }
    });
    await flushPromises();
    await nextTick();
    return wrapper;
}

const inline = (wrapper) => wrapper.findAll('[data-bulk-action]').map((el) => el.attributes('data-bulk-action'));
const moreButton = (wrapper) => wrapper.find('[data-bulk-more] .lv2-bulk__btn');
const moreInUse = (wrapper) => wrapper.find('[data-bulk-more]').attributes('aria-hidden') !== 'true';
const moreItems = (wrapper) => wrapper.findAll('[data-bulk-more] .lv2-bulk__item');
const usedWidth = (wrapper) => [WIDTH.count, WIDTH.clear, ...inline(wrapper).map((key) => WIDTH[key]), ...(moreInUse(wrapper) ? [WIDTH.more] : [])]
    .reduce((total, width, index) => total + width + (index ? GAP : 0), 0);

let wrapper;

beforeEach(() => {
    observers = [];
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ data: [] });
    fakeLayout();
});
afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    delete window.ResizeObserver;
});

describe('how many actions stay in the bar', () => {
    const actions = ALL.map((key) => ({ key, width: WIDTH[key] }));

    it('keeps every action when they all fit', () => {
        expect(fitInline(actions, { available: 900, moreWidth: WIDTH.more, gap: GAP })).toEqual(ALL);
    });

    it('drops the least used first, keeps the bar order, and leaves room for More', () => {
        const kept = fitInline(actions, { available: 500, moreWidth: WIDTH.more, gap: GAP });
        expect(kept).toEqual(['status', 'priority', 'assignee', 'due', 'sprint', 'tags', 'convert']);
        const used = kept.reduce((total, key) => total + WIDTH[key] + GAP, WIDTH.more + GAP);
        expect(used).toBeLessThanOrEqual(500);
    });

    it('never keeps more than the limit it is given', () => {
        expect(fitInline(actions, { available: 900, moreWidth: WIDTH.more, gap: GAP, limit: 3 })).toEqual(['status', 'assignee', 'due']);
    });

    it('keeps nothing in a bar with no room, rather than a cut-off action', () => {
        expect(fitInline(actions, { available: 60, moreWidth: WIDTH.more, gap: GAP })).toEqual([]);
    });
});

describe('the bulk bar on a phone (557px)', () => {
    beforeEach(async () => { wrapper = await mountBar({ width: 525, viewport: 557 }); });

    it('shows the count, the clear button and the three most used actions', () => {
        expect(wrapper.find('.lv2-bulk__count').exists()).toBe(true);
        expect(wrapper.find('.lv2-bulk__clear').exists()).toBe(true);
        expect(inline(wrapper)).toEqual(['status', 'assignee', 'due']);
    });

    it('fits the width: nothing in the bar is cut off', () => {
        expect(usedWidth(wrapper)).toBeLessThanOrEqual(525);
    });

    it('keeps every other action behind More, each once', async () => {
        expect(moreInUse(wrapper)).toBe(true);
        expect(moreButton(wrapper).text()).toContain('List.bulk_more');
        await moreButton(wrapper).trigger('click');
        const behind = moreItems(wrapper).map((item) => item.attributes('data-bulk-item'));
        expect(behind).toEqual(['priority', 'sprint', 'tags', 'convert', 'ai', 'archive', 'delete']);
        expect([...inline(wrapper), ...behind].sort()).toEqual([...ALL].sort());
    });

    it('opens the options of an action picked from More', async () => {
        await moreButton(wrapper).trigger('click');
        await moreItems(wrapper).find((item) => item.attributes('data-bulk-item') === 'sprint').trigger('click');
        const options = moreItems(wrapper).map((item) => item.text());
        expect(options).toEqual(expect.arrayContaining(['Sprint 1', 'List.bulk_move_project']));
        expect(moreButton(wrapper).attributes('aria-expanded')).toBe('true');
    });

    it('asks before deleting when Delete is picked from More', async () => {
        await moreButton(wrapper).trigger('click');
        await moreItems(wrapper).find((item) => item.attributes('data-bulk-item') === 'delete').trigger('click');
        await flushPromises();
        const confirm = wrapper.findComponent({ name: 'ConfirmationSidebar' });
        expect(confirm.exists()).toBe(true);
        expect(confirm.attributes('title')).toBe('Projects.bulk_delete');
    });

    it('does not scroll sideways any more', () => {
        const source = css('views/Projects/ListView/ListBulkBar.vue');
        expect(source).not.toMatch(/overflow-x:\s*auto/);
        expect(source).toMatch(/\.lv2-bulk\s*\{[^}]*white-space:\s*nowrap/);
    });
});

describe('the bulk bar between phone and desktop width', () => {
    it('moves what does not fit behind More instead of wrapping its labels', async () => {
        wrapper = await mountBar({ width: 700, viewport: 1024 });
        expect(inline(wrapper)).toEqual(['status', 'priority', 'assignee', 'due', 'sprint', 'tags', 'convert', 'ai']);
        expect(usedWidth(wrapper)).toBeLessThanOrEqual(700);
        await moreButton(wrapper).trigger('click');
        expect(moreItems(wrapper).map((item) => item.attributes('data-bulk-item'))).toEqual(['archive', 'delete']);
    });

    it('shows every action and no More when there is room', async () => {
        wrapper = await mountBar({ width: 932, viewport: 1280 });
        expect(inline(wrapper)).toEqual(ALL);
        expect(moreInUse(wrapper)).toBe(false);
        expect(moreButton(wrapper).attributes('disabled')).toBeDefined();
    });

    it('follows the bar as it is resized', async () => {
        wrapper = await mountBar({ width: 932, viewport: 1280 });
        await resizeTo(600);
        expect(inline(wrapper).length).toBeLessThan(ALL.length);
        expect(usedWidth(wrapper)).toBeLessThanOrEqual(600);
        await resizeTo(932);
        expect(inline(wrapper)).toEqual(ALL);
    });
});
