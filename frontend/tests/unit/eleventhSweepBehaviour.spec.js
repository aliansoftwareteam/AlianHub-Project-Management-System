/* Task 047, eleventh sweep (build 806): the task panel's tab row, the field manager's name column and the archived lists. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, rules } = vi.hoisted(() => ({ apiRequest: vi.fn(), rules: { showTasks: true } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/views/Projects/sprintActions', () => ({ setSprintStatus: vi.fn() }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => (key === 'task.show_tasks' ? rules.showTasks : true) })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import ArchivedLists from '@/views/Projects/components/ArchivedLists.vue';
import { archivedListsIn, archivedListsOf } from '@/views/Projects/folderSprints';
import { archiveViewLists } from '@/views/Projects/ListView/listFilter';
import en from '@/locales/en.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[3] : '';
};

const blocks = (css, query) => {
    const found = [];
    for (let at = css.indexOf(query); at !== -1; at = css.indexOf(query, at + 1)) {
        const open = css.indexOf('{', at);
        let depth = 1;
        let end = open + 1;
        for (; end < css.length && depth; end += 1) depth += css[end] === '{' ? 1 : css[end] === '}' ? -1 : 0;
        found.push(css.slice(open + 1, end - 1));
    }
    return found.join('\n');
};

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

describe('the task panel', () => {
    const css = read('components/organisms/TaskDetailOverlay/style.css');

    test('keeps its tab row at full height however tall the pane under it is', () => {
        expect(ruleBody(css, '.ah-detail__main')).toMatch(/flex-direction:\s*column/);
        expect(ruleBody(css, '.ah-detail__main')).toMatch(/overflow-y:\s*auto/);
        expect(ruleBody(css, '.ah-detail__tabs')).toMatch(/overflow-x:\s*auto/);
        expect(ruleBody(css, '.ah-detail__tabs')).toMatch(/flex:\s*none/);
    });
});

describe('the custom field manager', () => {
    const css = read('plugins/customFieldView/component/organisms/FieldBuilder/style.css');
    const tracks = (body) => /grid-template-columns:\s*([^;]+);/.exec(body)[1].trim();

    test('gives the free width of a row to the name alone', () => {
        const wide = tracks(ruleBody(css, '.fb__row'));
        expect(wide.match(/fr\b/g)).toHaveLength(1);
        expect(wide).toMatch(/^24px minmax\(0,\s*1fr\) /);
    });

    test('puts where the field is shown under the name when the table is narrow', () => {
        expect(ruleBody(css, '.fb__table')).toMatch(/container-type:\s*inline-size/);
        const narrow = blocks(css, '@container (max-width: 859px)');
        expect(tracks(ruleBody(narrow, '.fb__row'))).toBe('24px minmax(0, 1fr) 110px 90px');
        expect(ruleBody(narrow, '.fb__row > .fb__shown')).toMatch(/grid-column:\s*2 \/ -1/);
        expect(ruleBody(narrow, '.fb__row > .fb__shown')).toMatch(/grid-row:\s*2/);
        expect(ruleBody(narrow, '.fb__row-head > :nth-child(4)')).toMatch(/display:\s*none/);
    });

    test('still shows the whole name of a cut one on hover', () => {
        expect(read('plugins/customFieldView/component/organisms/FieldBuilder/FieldBuilder.vue'))
            .toContain('<span class="fb__name" :title="field.fieldTitle">{{ field.fieldTitle }}</span>');
        expect(ruleBody(css, '.fb__name')).toMatch(/text-overflow:\s*ellipsis/);
    });
});

const list = (id, name, deletedStatusKey = 0, extra = {}) => ({ id, _id: id, name, deletedStatusKey, ...extra });
const STORED = {
    _id: 'proj-1', ProjectName: 'Website', isGlobalPermission: true,
    sprintsObj: { l1: list('l1', 'Backlog', 0, { tasks: 4 }), l2: list('l2', 'Empty and archived', 2), l3: list('l3', 'Two tasks, archived', 2, { tasks: 2 }) },
    sprintsfolders: {}
};
/* What the page holds of the same project: its own copy keeps only the live lists at the top level (helper.js, filterSprints). */
const PAGE_COPY = { ...STORED, sprintsObj: { l1: STORED.sprintsObj.l1 } };

describe('the archived lists of the project in view', () => {
    test('are read from the stored project, which still holds them', () => {
        expect(archivedListsOf(PAGE_COPY)).toEqual([]);
        expect(archivedListsIn([{ _id: 'other' }, STORED], 'proj-1').map((row) => row.name)).toEqual(['Empty and archived', 'Two tasks, archived']);
        expect(archivedListsIn(undefined, 'proj-1')).toEqual([]);
        expect(archivedListsIn([STORED], 'nowhere')).toEqual([]);
    });

    test('the project page asks the store, not its own copy', () => {
        const page = read('views/Projects/Projects.vue');
        expect(page).toContain("archivedListsIn(getters['projectData/projects']?.data, projectData.value?._id)");
        expect(page).not.toContain('archivedListsOf(projectData.value)');
    });
});

describe('the Archived lists block', () => {
    const open = (project = STORED) => mount(ArchivedLists, {
        props: { project, lists: archivedListsOf(STORED) },
        global: { plugins: [createStore({})], mocks: { $t: i18n.global.t }, provide: { $companyId: ref('company-1'), $userId: ref('user-1') } }
    });
    const rows = (wrapper) => wrapper.findAll('[data-test="archived-list"]');
    const asked = () => apiRequest.mock.calls.at(-1);

    beforeEach(() => {
        rules.showTasks = true;
        apiRequest.mockReset();
        apiRequest.mockResolvedValue({ status: 200, data: [{ _id: 'l3', count: 2 }] });
    });

    test('names an archived list with Restore whether or not it holds a task', async () => {
        const wrapper = open();
        await flushPromises();
        expect(rows(wrapper).map((row) => row.get('.al__name').text())).toEqual(['Empty and archived', 'Two tasks, archived']);
        expect(rows(wrapper).map((row) => row.get('button').text())).toEqual(['Restore', 'Restore']);
        wrapper.unmount();
    });

    test('counts the tasks of each one that the server answers for this person', async () => {
        const wrapper = open();
        expect(wrapper.findAll('.al__count')).toHaveLength(0);
        await flushPromises();
        expect(asked()[0]).toBe('post');
        expect(asked()[1]).toBe('/api/v1/task/find');
        expect(asked()[2].findQuery).toEqual([
            { $match: { objId: { ProjectID: 'proj-1' }, sprintId: { objId: { $in: ['l2', 'l3'] } }, deletedStatusKey: { $ne: 1 } } },
            { $group: { _id: '$sprintId', count: { $sum: 1 } } }
        ]);
        expect(rows(wrapper).map((row) => row.get('.al__count').text())).toEqual(['0 tasks', '2 tasks']);
        wrapper.unmount();
    });

    test('counts only their own for a person the project shows only their own tasks', async () => {
        rules.showTasks = false;
        const wrapper = open({ ...STORED, isGlobalPermission: false });
        await flushPromises();
        expect(asked()[2].findQuery[0].$match.AssigneeUserId).toEqual({ $in: ['user-1'] });
        wrapper.unmount();
    });

    test('shows no count when the count could not be read', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        apiRequest.mockRejectedValue(new Error('offline'));
        const wrapper = open();
        await flushPromises();
        expect(rows(wrapper)).toHaveLength(2);
        expect(wrapper.findAll('.al__count')).toHaveLength(0);
        logged.mockRestore();
        wrapper.unmount();
    });
});

describe('the List in the archive view', () => {
    const lists = [list('l1', 'Backlog'), list('l2', 'Empty and archived', 2), list('l3', 'Archived, one task archived before it', 2)];
    const rowsOf = (sprint) => ({ l1: 3, l3: 1 }[sprint.id] || 0);

    test('draws no group for a list archived whole that has no archived task to show', () => {
        expect(archiveViewLists(lists, { archiveView: true, rowsOf }).map((sprint) => sprint.id)).toEqual(['l1', 'l3']);
    });

    test('keeps every list outside the archive view', () => {
        expect(archiveViewLists(lists, { archiveView: false, rowsOf })).toBe(lists);
    });

    test('is what the List draws', () => {
        const view = read('views/Projects/ListView/ListView.vue');
        expect(view).toContain('<section v-for="sprint in shownSprints"');
        expect(view).not.toContain('<section v-for="sprint in groupedTasks"');
    });
});
