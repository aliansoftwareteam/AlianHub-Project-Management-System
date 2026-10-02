import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const { apiRequest, state } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    state: { ids: 0, release: null, observers: [] },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `u${++state.ids}` }),
}));
vi.mock('@/composable/commonFunction', () => ({ projectComponentsIcons: () => ({ icon: 'icon.svg', activeIcon: 'active.svg' }) }));
vi.mock('@/components/molecules/EmbedView/helper', () => ({ addView: vi.fn() }));
vi.mock('@/components/molecules/EmbedView/helper.js', () => ({ addView: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => ({ fullPath: '/p1', params: {}, query: {} }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({ getters: { 'settings/companyUsers': [{ userId: 'user-1', ProjectRequiredComponent: [] }], 'projectData/projects': { data: [] } }, commit: vi.fn() }),
}));

import AddViewMenu from '@/components/molecules/ProjectViews/AddViewMenu.vue';

const CATALOGUE = [
    { _id: 'cat-list', name: 'List', keyName: 'ProjectListView', sortIndex: 1 },
    { _id: 'cat-board', name: 'Board', keyName: 'ProjectKanban', sortIndex: 2 },
];
const WINDOW = { width: 1024, height: 768 };
const MARGIN = 8;
const PANEL = { width: 482, height: 500 };
const EMPTY_PANEL = { width: 2, height: 20 };

class FakeResizeObserver {
    constructor(callback) {
        this.callback = callback;
        this.targets = new Set();
        state.observers.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
}

const resizeAll = () => state.observers.forEach((observer) => {
    if (observer.targets.size) observer.callback([...observer.targets].map((target) => ({ target })));
});

let wrapper;
let triggerRect;

const px = (value) => parseFloat(value) || 0;
const rectOf = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} });

function measure(element) {
    if (element.id === 'embeddropdown') return triggerRect;
    if (element.id === 'dd_embeddropdown') {
        const size = element.querySelector('.view__list-dropdown') ? PANEL : EMPTY_PANEL;
        return rectOf(px(element.style.left), px(element.style.top), size.width, size.height);
    }
    return rectOf(0, 0, 0, 0);
}

const panel = () => document.getElementById('dd_embeddropdown');
const panelRight = () => px(panel().style.left) + PANEL.width;

async function openMenu() {
    wrapper = mount(AddViewMenu, {
        props: { projectData: { _id: 'p1', ProjectRequiredComponent: [] } },
        attachTo: '#app',
        global: { provide: { $userId: ref('user-1'), $companyId: ref('c1') } },
    });
    document.querySelector('#embeddropdown [aria-haspopup]').click();
    await flushPromises();
    vi.advanceTimersByTime(150);
    state.release({ data: CATALOGUE });
    await flushPromises();
    resizeAll();
}

beforeEach(() => {
    vi.useFakeTimers();
    state.ids = 0;
    state.observers = [];
    apiRequest.mockReset().mockImplementation((method, url) => {
        if (url === '/api/v1/projectTabs') return new Promise((resolve) => { state.release = resolve; });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: WINDOW.width });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: WINDOW.height });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () { return measure(this); });
});

afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('the Add view menu placement', () => {
    it('stays inside the window when its button sits near the right edge and the views load after it opens', async () => {
        triggerRect = rectOf(866, 76, 90, 28);
        await openMenu();

        expect(panel().querySelector('.view__list-dropdown')).not.toBeNull();
        expect(panelRight()).toBeLessThanOrEqual(WINDOW.width - MARGIN);
        expect(px(panel().style.left)).toBeGreaterThanOrEqual(MARGIN);
    });

    it('opens beside its button when there is room', async () => {
        triggerRect = rectOf(200, 76, 90, 28);
        await openMenu();

        expect(panel().querySelector('.view__list-dropdown')).not.toBeNull();
        expect(px(panel().style.left)).toBe(200);
        expect(px(panel().style.top)).toBe(104);
    });
});
