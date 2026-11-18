/* Task 046 A1.4: the List and the Table have a Comfortable and a Compact row density. It is a
   setting of the saved view, and compact is a set of tokens the view root switches on. */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref, computed, defineComponent, h, nextTick } from 'vue';
import { readFileSync } from 'fs';
import path from 'path';

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn })
}));

vi.mock('@/views/Projects/composables/savedViewApi', () => ({
    saveSharedViewSettings: vi.fn(async () => ({ status: true })),
    createSharedView: vi.fn(async () => ({ status: true, data: {} })),
    savePrivateViewSettings: vi.fn(async () => ({ status: true })),
    createPrivateView: vi.fn(async () => ({ status: true }))
}));

import * as api from '@/views/Projects/composables/savedViewApi';
import en from '@/locales/en';
import { useProjectSearch } from '@/views/Projects/composables/useProjectSearch';
import { useSavedViews } from '@/views/Projects/composables/useSavedViews';
import { provideViewSettings, useViewSettings } from '@/views/Projects/composables/viewSettingsContext';
import ViewDensityControl from '@/views/Projects/components/columns/ViewDensityControl.vue';

const SRC = path.resolve(__dirname, '../../src');
const read = (file) => readFileSync(path.join(SRC, file), 'utf8');
const css = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '');

const LIST = 'a'.repeat(24);
const listView = (extra = {}) => ({ _id: LIST, id: LIST, name: 'List', keyName: 'ProjectListView', viewStatus: true, ...extra });

const mountViews = ({ views, privateViews = [] }) => {
    const project = ref({ _id: 'p1', isGlobalPermission: true, ProjectRequiredComponent: views });
    const companyUser = ref({ _id: 'row-1', userId: 'user-1', ProjectRequiredComponent: privateViews });
    const store = createStore({
        getters: { 'projectData/searchedTasks': () => [] },
        mutations: {
            'projectData/mutateSearchTask': () => {},
            'projectData/projectLocalUpdate': () => {},
            'settings/mutateCompanyUsers': () => {}
        },
        actions: { 'projectData/searchTask': () => Promise.resolve() }
    });
    const out = { onSelect: vi.fn() };
    const Child = defineComponent({
        setup() {
            out.context = useViewSettings();
            return () => null;
        }
    });
    const Host = defineComponent({
        setup() {
            const search = useProjectSearch(project, ref(false), { buildFilterQuery: (rows) => ({ rows: rows.length }) });
            out.saved = useSavedViews({
                project,
                activeTab: ref('ProjectListView'),
                views: computed(() => [...(project.value.ProjectRequiredComponent || []), ...(companyUser.value.ProjectRequiredComponent || [])]),
                requestedViewKey: ref(undefined),
                companyUser,
                search,
                canSaveShared: ref(true),
                onSelect: out.onSelect
            });
            provideViewSettings(out.saved);
            return () => h(Child);
        }
    });
    mount(Host, { global: { plugins: [store] } });
    return out;
};

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
});

describe('density is a setting of the saved view', () => {
    test('a view opens comfortable, or in the density it was saved with', async () => {
        const plain = mountViews({ views: [listView()] });
        await flushPromises();
        expect(plain.saved.density.value).toBe('comfortable');
        expect(plain.saved.dirty.value).toBe(false);

        const compact = mountViews({ views: [listView({ settings: { density: 'compact' } })] });
        await flushPromises();
        expect(compact.saved.density.value).toBe('compact');
        expect(compact.saved.dirty.value).toBe(false);
    });

    test('changing it shows as an unsaved change, and reset puts the saved density back', async () => {
        const { saved } = mountViews({ views: [listView()] });
        await flushPromises();
        saved.setDensity('compact');
        await nextTick();
        expect(saved.dirty.value).toBe(true);
        saved.setDensity('roomy');
        expect(saved.density.value).toBe('comfortable');
        saved.setDensity('compact');
        saved.reset();
        await nextTick();
        expect(saved.density.value).toBe('comfortable');
        expect(saved.dirty.value).toBe(false);
    });

    test('save stores it for everyone', async () => {
        const { saved } = mountViews({ views: [listView()] });
        await flushPromises();
        saved.setDensity('compact');
        await nextTick();
        await saved.save();
        expect(api.saveSharedViewSettings).toHaveBeenCalledWith('p1', LIST, expect.objectContaining({ density: 'compact' }));
        expect(saved.dirty.value).toBe(false);
    });

    test('save for me stores it on a private copy', async () => {
        const { saved, onSelect } = mountViews({ views: [listView()] });
        await flushPromises();
        saved.setDensity('compact');
        await nextTick();
        await saved.saveForMe();
        expect(api.saveSharedViewSettings).not.toHaveBeenCalled();
        expect(api.createPrivateView).toHaveBeenCalledWith('row-1', expect.objectContaining({ isPrivate: true, settings: expect.objectContaining({ density: 'compact' }) }));
        expect(onSelect).toHaveBeenCalled();
    });

    test('the views read and set it through the view settings context', async () => {
        const { saved, context } = mountViews({ views: [listView({ settings: { density: 'compact' } })] });
        await flushPromises();
        expect(context.density.value).toBe('compact');
        context.setDensity('comfortable');
        expect(saved.density.value).toBe('comfortable');
    });

    test('a view mounted outside a project page keeps a density of its own', () => {
        let context;
        mount(defineComponent({ setup() { context = useViewSettings(); return () => null; } }));
        expect(context.density.value).toBe('comfortable');
        context.setDensity('compact');
        expect(context.density.value).toBe('compact');
    });
});

describe('the density control', () => {
    const mountControl = (modelValue = 'comfortable') => mount(ViewDensityControl, {
        props: { modelValue },
        attachTo: document.body,
        global: { stubs: { ShellIcon: true } }
    });

    test('is a named button that opens the two choices, the current one checked', async () => {
        const wrapper = mountControl('compact');
        const trigger = wrapper.find('button');
        expect(trigger.attributes('aria-label')).toBe('ViewDensity.title');
        expect(trigger.attributes('aria-expanded')).toBe('false');
        await trigger.trigger('click');
        const radios = wrapper.findAll('input[type="radio"]');
        expect(radios.map((radio) => radio.attributes('value'))).toEqual(['comfortable', 'compact']);
        expect(radios.map((radio) => radio.element.checked)).toEqual([false, true]);
        expect(wrapper.text()).toContain('ViewDensity.comfortable');
        expect(wrapper.text()).toContain('ViewDensity.compact');
        wrapper.unmount();
    });

    test('picking one tells the view, and Escape closes it back onto the button', async () => {
        const wrapper = mountControl();
        await wrapper.find('button').trigger('click');
        await wrapper.findAll('input[type="radio"]')[1].setValue(true);
        expect(wrapper.emitted('update:modelValue')).toEqual([['compact']]);
        await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
        await nextTick();
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
        expect(document.activeElement).toBe(wrapper.find('button').element);
        wrapper.unmount();
    });

    test('has English copy', () => {
        expect(en.ViewDensity).toMatchObject({ title: expect.any(String), comfortable: 'Comfortable', compact: 'Compact' });
    });
});

describe('compact is a set of tokens, not a second stylesheet', () => {
    const tokens = css('assets/css/tokens.css');
    const root = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('}', tokens.indexOf(':root {')));
    const compactAt = tokens.indexOf('[data-density="compact"]');
    const compact = tokens.slice(compactAt, tokens.indexOf('}', compactAt));
    const TOKENS = ['--row-h', '--cell-pad-y', '--row-font', '--avatar-size', '--chip-h'];
    const px = (block, name) => Number(new RegExp(`${name}:\\s*([\\d.]+)px`).exec(block)?.[1]);

    test('the shared tokens file defines the comfortable sizes', () => {
        for (const name of TOKENS) expect(px(root, name), name).toBeGreaterThan(0);
    });

    test('data-density="compact" makes each of them smaller', () => {
        expect(compactAt).toBeGreaterThan(-1);
        for (const name of TOKENS) expect(px(compact, name), name).toBeLessThan(px(root, name));
    });

    test('a compact row still holds a 24px target', () => {
        expect(px(root, '--hit-min')).toBe(24);
        expect(compact).not.toContain('--hit-min');
        expect(px(compact, '--row-h')).toBeGreaterThanOrEqual(24);
    });

    test('phone widths keep the comfortable size', () => {
        const before = tokens.slice(0, compactAt);
        const media = before.slice(before.lastIndexOf('@media'));
        expect(media).toMatch(/^@media \(min-width: 768px\)\s*\{\s*$/);
    });

    test('the List and the Table size their rows from the tokens and never branch on the density', () => {
        const list = css('views/Projects/ListView/style.css');
        const table = css('views/Projects/TableView/style.css');
        for (const sheet of [list, table]) {
            expect(sheet).not.toContain('data-density');
            for (const name of ['--row-h', '--cell-pad-y', '--row-font']) expect(sheet, name).toContain(`var(${name})`);
        }
    });

    test('avatars and chips take their size from the tokens', () => {
        const rule = (selector) => new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(tokens)?.[1] || '';
        expect(rule('.ah-avatar')).toContain('var(--avatar-size)');
        expect(rule('.ah-chip')).toContain('var(--chip-h)');
    });

    test('both views put the density on their root and show the control beside the column chooser', () => {
        for (const file of ['views/Projects/ListView/ListView.vue', 'views/Projects/TableView/TableView.vue']) {
            const source = read(file);
            expect(source, file).toMatch(/:data-density="density"/);
            expect(source, file).toMatch(/<ViewColumnChooser[\s\S]*?\/>\s*<ViewDensityControl/);
        }
    });
});
