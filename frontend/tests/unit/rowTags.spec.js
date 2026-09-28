/* Owner decision 2026-09-27: a task's tags show on List and Table rows, not only on board cards. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createStore } from 'vuex';

const access = vi.hoisted(() => ({ tagPermission: true, tagsApp: true }));
vi.mock('@/composable', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        useCustomComposable: () => ({
            ...real.useCustomComposable(),
            checkPermission: (key) => (key === 'task.task_tag' ? access.tagPermission : true),
            checkApps: (app) => (app === 'tags' ? access.tagsApp : true)
        }),
        useGetterFunctions: () => ({ ...real.useGetterFunctions(), getUser: () => null, getTaskStatus: () => ({ name: 'To do' }) })
    };
});
vi.mock('@/utils/TaskOperations', () => ({ default: { updateTags: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({
    useTaskSummaries: () => ({ get: () => ({ state: 'idle' }), ensure: () => {}, generate: () => {}, pin: () => {}, unpin: () => {} })
}));
vi.mock('@/views/Projects/TableView/useTaskCategories.js', () => ({
    useTaskCategories: () => ({ get: () => ({ state: 'idle' }), ensure: () => {}, generate: () => {}, pin: () => {}, unpin: () => {} })
}));

import ListRow from '@/views/Projects/ListView/ListRow.vue';
import TableRow from '@/views/Projects/TableView/TableRow.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');

const tag = (uid, tagName, colour = '#1f7a4d') => ({ uid, tagName, tagColor: colour, tagBgColor: `${colour}35` });
const PROJECT_TAGS = [
    tag('tag-ux', 'UX'),
    tag('tag-api', 'api'),
    tag('tag-bug', 'Bug'),
    tag('tag-docs', 'Docs'),
    tag('tag-perf', 'Perf'),
    tag('tag-qa', 'QA'),
    tag('tag-unused', 'Unused')
];
const SIX = ['tag-ux', 'tag-api', 'tag-bug', 'tag-docs', 'tag-perf', 'tag-qa'];

const store = createStore({
    getters: {
        'settings/companyPriority': () => [],
        'settings/companyMembers': () => [],
        'settings/teams': () => [],
        'projectData/currentProjectDetails': () => ({}),
        'users/users': () => []
    }
});

const task = (tagsArray) => ({
    _id: 't1',
    TaskName: 'Tag the release notes',
    TaskKey: 'SHOP-12',
    isParentTask: true,
    statusType: 'active',
    statusKey: 1,
    sprintId: 's1',
    AssigneeUserId: [],
    tagsArray
});

const mountRow = async (Row, { tagsArray = [], width = 1280, archived = false } = {}) => {
    const wrapper = mount(Row, {
        props: { data: task(tagsArray) },
        global: {
            plugins: [store],
            provide: {
                selectedProject: ref({ _id: 'p1', isGlobalPermission: true, tagsArray: PROJECT_TAGS }),
                showArchived: ref(archived),
                $clientWidth: ref(width),
                $defaultUserAvatar: ref(''),
                $defaultGhostCustomUserImg: ref(''),
                $defaultTaskStatusImg: ref('')
            },
            stubs: { ShellIcon: true, ProvenanceBadge: true, ConfirmationSidebar: true }
        }
    });
    await flushPromises();
    return wrapper;
};

const chipNames = (wrapper) => wrapper.findAll('.tagname').map((chip) => chip.text());
const addTagButton = (wrapper) => wrapper.find('button[aria-label="Tags.add_tag"]');
const overflow = (wrapper) => wrapper.find('.tagcount');

describe.each([
    ['List', ListRow],
    ['Table', TableRow]
])('%s row tags', (_, Row) => {
    beforeEach(() => {
        access.tagPermission = true;
        access.tagsApp = true;
    });

    it('shows each of three tags as a chip, sorted by name', async () => {
        const wrapper = await mountRow(Row, { tagsArray: ['tag-ux', 'tag-api', 'tag-bug'] });
        expect(chipNames(wrapper)).toEqual(['api', 'Bug', 'UX']);
        expect(overflow(wrapper).exists()).toBe(false);
    });

    it('caps the chips at three and counts the rest', async () => {
        const wrapper = await mountRow(Row, { tagsArray: SIX });
        expect(chipNames(wrapper)).toEqual(['api', 'Bug', 'Docs']);
        expect(overflow(wrapper).text()).toContain('+3');
    });

    it('names the hidden tags for a screen reader and on hover', async () => {
        const more = overflow(await mountRow(Row, { tagsArray: SIX }));
        expect(more.attributes('title')).toContain('Perf, QA, UX');
        expect(more.find('.ah-sr-only').exists()).toBe(true);
    });

    it('shows chips that do nothing but show the tag, not the chip edit menu', async () => {
        const wrapper = await mountRow(Row, { tagsArray: ['tag-ux'] });
        expect(wrapper.find('.tagHover__icon-close').exists()).toBe(false);
        expect(wrapper.find('.tagHover__icon').exists()).toBe(false);
    });

    it('shows no chips for an untagged task', async () => {
        const wrapper = await mountRow(Row, { tagsArray: [] });
        expect(wrapper.find('.tagname').exists()).toBe(false);
    });

    it('shows no chips and no add button with the Tags app off', async () => {
        access.tagsApp = false;
        const wrapper = await mountRow(Row, { tagsArray: ['tag-ux'] });
        expect(wrapper.find('.tagname').exists()).toBe(false);
        expect(addTagButton(wrapper).exists()).toBe(false);
    });

    it('offers the add-tag button to a member who may tag', async () => {
        const button = addTagButton(await mountRow(Row, { tagsArray: ['tag-ux'] }));
        expect(button.exists()).toBe(true);
        expect(button.isVisible()).toBe(true);
    });

    it('offers the add-tag button on an untagged task too', async () => {
        expect(addTagButton(await mountRow(Row, { tagsArray: [] })).exists()).toBe(true);
    });

    it('shows a view-only member the chips without an add-tag button', async () => {
        access.tagPermission = false;
        const wrapper = await mountRow(Row, { tagsArray: ['tag-ux'] });
        expect(chipNames(wrapper)).toEqual(['UX']);
        expect(addTagButton(wrapper).exists()).toBe(false);
    });

    it('shows nothing to a member without tag access', async () => {
        access.tagPermission = null;
        const wrapper = await mountRow(Row, { tagsArray: ['tag-ux'] });
        expect(wrapper.find('.tagname').exists()).toBe(false);
        expect(addTagButton(wrapper).exists()).toBe(false);
    });

    it('keeps the archive read-only', async () => {
        const wrapper = await mountRow(Row, { tagsArray: ['tag-ux'], archived: true });
        expect(chipNames(wrapper)).toEqual(['UX']);
        expect(addTagButton(wrapper).exists()).toBe(false);
    });
});

describe('List row tags at phone width', () => {
    it('show two chips and count the rest', async () => {
        const wrapper = await mountRow(ListRow, { tagsArray: SIX, width: 390 });
        expect(chipNames(wrapper)).toEqual(['api', 'Bug']);
        expect(overflow(wrapper).text()).toContain('+4');
    });
});

describe('the tags have a column of their own', () => {
    it('List: the row has a tags cell under a Tags header', async () => {
        const wrapper = await mountRow(ListRow, { tagsArray: ['tag-ux'] });
        expect(wrapper.find('[role="cell"].lv2__c-tags .tagname').exists()).toBe(true);
        const view = fs.readFileSync(path.join(SRC, 'views/Projects/ListView/ListView.vue'), 'utf8');
        expect(view).toMatch(/class="lv2__c-tags" role="columnheader">.*List\.col_tags/);
    });

    it('Table: the row has a tags cell under a Tags header, one grid track per header', async () => {
        const wrapper = await mountRow(TableRow, { tagsArray: ['tag-ux'] });
        expect(wrapper.find('[role="cell"].tv2__tags .tagname').exists()).toBe(true);
        const view = fs.readFileSync(path.join(SRC, 'views/Projects/TableView/TableView.vue'), 'utf8');
        const head = view.match(/<div class="tv2__head" role="row">([\s\S]*?)\n {16}<\/div>/)[1];
        expect(head).toContain("$t('List.col_tags')");
        const headers = (head.match(/role="columnheader"/g) || []).length;
        const css = fs.readFileSync(path.join(SRC, 'views/Projects/TableView/style.css'), 'utf8');
        const tracks = css.match(/--tv2-cols:([^;]+);/)[1].trim().replace(/minmax\([^)]*\)/g, 'x').split(/\s+/).length;
        expect(tracks).toBe(headers);
        expect(wrapper.findAll('[role="row"] > [role="cell"]')).toHaveLength(headers);
    });
});
