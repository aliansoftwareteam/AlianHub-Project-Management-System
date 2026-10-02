/* Task 047, tenth sweep — the list search sends what was typed as text to find, and says so when the
   search could not be run instead of showing empty groups. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn })
}));

import { useProjectSearch } from '@/views/Projects/composables/useProjectSearch';
import { SEARCH_TEXT_MAX, typedSearchText } from '@/utils/searchText';
import en from '@/locales/en.js';

const searchTask = vi.fn(() => Promise.resolve([]));

function open() {
    let search;
    const store = createStore({
        modules: {
            projectData: { namespaced: true, actions: { searchTask: (_context, payload) => searchTask(payload) }, mutations: { mutateSearchTask: () => {} } }
        }
    });
    const Host = defineComponent({
        setup() {
            search = useProjectSearch(ref({ _id: 'proj-1', isGlobalPermission: true }), ref(false));
            return () => h('div');
        }
    });
    const wrapper = mount(Host, { global: { plugins: [store], provide: { $userId: ref('u1') } } });
    return { wrapper, search };
}

const textConditions = () => searchTask.mock.calls.at(-1)[0].query[0].$match.$and.at(-1).$or;

beforeEach(() => {
    searchTask.mockReset();
    searchTask.mockImplementation(() => Promise.resolve([]));
});

describe('the text a list search sends', () => {
    it.each([
        ['[QA 047] parent'],
        ['[QA'],
        ['(again?)'],
        ['a.b*c'],
        ['a\\.b'],
        ['plain words']
    ])('"%s" is sent as it was typed: the server reads it as text', async (typed) => {
        const { wrapper, search } = open();
        search.taskSearch.value = typed;
        await flushPromises();
        expect(textConditions()).toEqual([{ TaskName: { $regex: typed, $options: 'i' } }]);
        wrapper.unmount();
    });

    it('is the same text in every field that is searched', async () => {
        const { wrapper, search } = open();
        search.taskKeySearch.value = true;
        search.taskDescriptionSearch.value = true;
        search.taskSearch.value = 'QA-1 (draft)';
        await flushPromises();
        const text = { $regex: 'QA-1 (draft)', $options: 'i' };
        expect(textConditions()).toEqual([{ TaskName: text }, { TaskKey: text }, { rawDescription: text }]);
        wrapper.unmount();
    });

    it('is cut at the length the server takes', () => {
        expect(typedSearchText('a'.repeat(SEARCH_TEXT_MAX + 50))).toHaveLength(SEARCH_TEXT_MAX);
        const toolbar = readFileSync(path.resolve(__dirname, '../../src/views/Projects/components/ProjectFiltersToolbar.vue'), 'utf8');
        expect(toolbar).toContain(':maxlength="SEARCH_TEXT_MAX"');
    });
});

describe('every search the web app and the desktop tracker send', () => {
    const ROOT = path.resolve(__dirname, '../../..');
    const CLIENTS = [path.join(ROOT, 'frontend/src'), path.join(ROOT, 'time-tracker-app/renderer')];
    const sourceFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return ['locales', 'node_modules'].includes(entry.name) ? [] : sourceFiles(full);
        return /\.(js|jsx|vue)$/.test(entry.name) ? [full] : [];
    });
    const senders = CLIENTS.flatMap(sourceFiles).map((file) => [path.relative(ROOT, file), readFileSync(file, 'utf8')]).filter(([, text]) => text.includes('$regex'));

    it('leave the typed text as it is: escaping it is the server\'s work, done once', () => {
        expect(senders.map(([file]) => file)).toContain('time-tracker-app/renderer/components/TrackerSelection/TrackerSelection.jsx');
        expect(senders.length).toBeGreaterThan(5);
        const escapesFirst = senders.filter(([, text]) => text.includes("'\\\\$&'")).map(([file]) => file);
        expect(escapesFirst).toEqual([]);
    });
});

describe('a list search the server could not run', () => {
    it('is marked as failed, and the next search clears the mark', async () => {
        const { wrapper, search } = open();
        searchTask.mockImplementationOnce(() => Promise.reject(new Error('500')));
        search.taskSearch.value = 'brief';
        await flushPromises();
        expect(search.searchFailed.value).toBe(true);
        search.taskSearch.value = 'briefing';
        await flushPromises();
        expect(search.searchFailed.value).toBe(false);
        wrapper.unmount();
    });

    it('shows a plain message with a way to try again in place of the task view', () => {
        const page = readFileSync(path.resolve(__dirname, '../../src/views/Projects/Projects.vue'), 'utf8');
        expect(page).toMatch(/<EmptyState\s+v-else-if="searchFailed"\s+role="alert"/);
        expect(page.indexOf('v-else-if="searchFailed"')).toBeLessThan(page.indexOf(':is="getView(activeTab)"'));
        expect(page).toContain('@action="searchMongoDB"');
        expect(en.Projects.search_failed_title).toBe('The search did not work');
        expect(en.Projects.search_try_again).toBe('Try again');
    });
});

describe('the dashboard task list search', () => {
    it('sends typed text the same way', () => {
        const list = readFileSync(path.resolve(__dirname, '../../src/plugins/tasklistDashboard/views/DashBoardList/DashBoardList.vue'), 'utf8');
        expect(list).not.toContain('$regex: searchStr');
        expect(list.match(/\$regex: typedSearchText\(searchStr\)/g)).toHaveLength(2);
    });
});
