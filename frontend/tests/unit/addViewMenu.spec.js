import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { reactive } from 'vue';

const route = vi.hoisted(() => ({ current: null }));
const ids = vi.hoisted(() => ({ next: 0 }));
const addView = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({ useRoute: () => route.current, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `u${++ids.next}` }),
}));
vi.mock('@/composable/commonFunction', () => ({ projectComponentsIcons: () => ({ icon: '' }) }));
vi.mock('@/components/molecules/EmbedView/helper.js', () => ({ addView }));
vi.mock('@/services', () => ({
    apiRequest: vi.fn(() => Promise.resolve({ data: [
        { _id: 'v1', name: 'List', keyName: 'ProjectListView', sortIndex: 1 },
        { _id: 'v2', name: 'Forms', keyName: 'FormsView', sortIndex: 2 },
    ] })),
}));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({ getters: { 'settings/companyUsers': [], 'projectData/projects': { data: [] } }, commit: vi.fn() }),
}));

import AddViewMenu from '@/components/molecules/ProjectViews/AddViewMenu.vue';

let wrapper;
const settle = async () => {
    await flushPromises();
    vi.advanceTimersByTime(150);
    await flushPromises();
};
const trigger = () => document.querySelector('#embeddropdown [aria-haspopup="dialog"]');
const panel = () => document.getElementById('dd_embeddropdown');
const search = () => panel()?.querySelector('input[type="search"]');

const mountMenu = async (props = {}) => {
    wrapper = mount(AddViewMenu, {
        props: { projectData: { _id: 'p1', ProjectRequiredComponent: [] }, activeView: 'ProjectListView', ...props },
        attachTo: '#app',
        global: { stubs: { EmbedView: true } },
    });
    await flushPromises();
};
const openWithQuery = async (text = 'form') => {
    trigger().click();
    await settle();
    expect(panel()).not.toBeNull();
    search().value = text;
    search().dispatchEvent(new Event('input'));
    await flushPromises();
};

beforeEach(() => {
    vi.useFakeTimers();
    route.current = reactive({ fullPath: '/c1/project/p1?tab=ProjectListView', query: { tab: 'ProjectListView' } });
    addView.mockReset().mockResolvedValue({ data: {}, statusText: 'ok' });
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('the project "+ Add view" menu', () => {
    it('closes when the route changes, and opens again with an empty search', async () => {
        await mountMenu();
        await openWithQuery();

        route.current.fullPath = '/c1/project/p1?tab=ProjectKanban';
        await settle();
        expect(panel()).toBeNull();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');

        trigger().click();
        await settle();
        expect(search().value).toBe('');
    });

    it('closes when another view becomes active without a route change', async () => {
        await mountMenu();
        await openWithQuery();

        await wrapper.setProps({ activeView: 'ProjectKanban' });
        await settle();
        expect(panel()).toBeNull();
    });

    it('closes on Escape and hands focus back to the Add view button', async () => {
        await mountMenu();
        await openWithQuery();
        search().focus();

        search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();
        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('closes on a press outside, even on a control that stops its click from bubbling', async () => {
        await mountMenu();
        const tab = document.createElement('button');
        tab.addEventListener('click', (event) => event.stopPropagation());
        document.body.appendChild(tab);
        await openWithQuery();

        tab.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        tab.click();
        await settle();
        expect(panel()).toBeNull();
    });

    it('stays open for presses inside its own panel', async () => {
        await mountMenu();
        await openWithQuery();

        search().dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await settle();
        expect(panel()).not.toBeNull();
        expect(search().value).toBe('form');
    });

    it('closes once a view is added', async () => {
        await mountMenu();
        await openWithQuery('');
        const cell = [...panel().querySelectorAll('.view__cell')].find((el) => el.textContent.includes('ViewList.Forms'));

        cell.click();
        await settle();
        expect(addView).toHaveBeenCalledTimes(1);
        expect(panel()).toBeNull();
    });

    it('is what the project page renders for Add view, told which view is active', () => {
        const page = readFileSync(resolve(__dirname, '../../src/views/Projects/Projects.vue'), 'utf8');
        expect(page).toMatch(/<AddViewMenu\b[^>]*:activeView="activeTab"/);
        expect(page).not.toContain("$refs['embeddropdown']");
    });
});
