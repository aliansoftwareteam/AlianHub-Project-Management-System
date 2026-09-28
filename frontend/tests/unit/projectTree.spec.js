import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ref } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));

import ProjectTree from '@/components/molecules/ProjectTree/ProjectTree.vue';
import ProjectTreePanel from '@/views/Projects/components/ProjectTreePanel.vue';
import { resetProjectTreeCache } from '@/components/molecules/ProjectTree/projectTreeData';
import { resetFavourites } from '@/composable/favourites';
import { projectTreePanelState } from '@/views/Projects/components/projectTreePanelState';

const SPRINTS = {
    p1: [
        { _id: 's1', name: 'Backlog', projectId: 'p1', deletedStatusKey: 0, private: false, tasks: 4 },
        { _id: 's2', name: 'Sprint 2', projectId: 'p1', folderId: 'f1', deletedStatusKey: 0, private: false, tasks: 3 },
        { _id: 's3', name: 'Secret sprint', projectId: 'p1', deletedStatusKey: 0, private: true, AssigneeUserId: ['someone-else'], tasks: 9 },
        { _id: 's4', name: 'Team sprint', projectId: 'p1', folderId: 'f1', deletedStatusKey: 0, private: true, AssigneeUserId: ['tId_team-1'], tasks: 2 },
        { _id: 's5', name: 'Mine', projectId: 'p1', deletedStatusKey: 0, private: true, AssigneeUserId: ['user-1'], tasks: 1 },
        { _id: 's6', name: 'Deleted sprint', projectId: 'p1', deletedStatusKey: 1, private: false, tasks: 5 }
    ],
    p2: [{ _id: 's9', name: 'Beta list', projectId: 'p2', deletedStatusKey: 0, private: false, tasks: 0 }]
};
const FOLDERS = { p1: [{ _id: 'f1', name: 'Design', projectId: 'p1', deletedStatusKey: 0 }], p2: [] };
const PROJECTS = [{ _id: 'p1', ProjectName: 'Alpha' }, { _id: 'p2', ProjectName: 'Beta' }];

const blank = { render: () => null };
const routes = [
    { path: '/:cid/home', name: 'Home', component: blank },
    { path: '/:cid/project/:id/p', name: 'Project', component: blank },
    { path: '/:cid/project/:id/f/:folderId', name: 'ProjectFolder', component: blank },
    { path: '/:cid/project/:id/fs/:folderId/:sprintId', name: 'ProjectFolderSprint', component: blank },
    { path: '/:cid/project/:id/s/:sprintId', name: 'ProjectSprint', component: blank }
];

const makeStore = (roleType = 3) => createStore({
    getters: {
        'projectData/sprints': () => ({}),
        'projectData/folders': () => ({}),
        'settings/companyUserDetail': () => ({ roleType }),
        'settings/teams': () => [{ _id: 'team-1', assigneeUsersArray: ['user-1'] }]
    }
});

const mounted = [];
const mountWith = async (component, props, { at, roleType, width = 1280 } = {}) => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push(at || { name: 'ProjectFolderSprint', params: { cid: 'company-1', id: 'p1', folderId: 'f1', sprintId: 's2' } });
    await router.isReady();
    const wrapper = mount(component, {
        props,
        attachTo: document.body,
        global: { plugins: [makeStore(roleType), router], provide: { $clientWidth: ref(width) } }
    });
    mounted.push(wrapper);
    await flushPromises();
    return { wrapper, router };
};

const items = (wrapper) => wrapper.findAll('[role="treeitem"]');
const itemNamed = (wrapper, name) => items(wrapper).find((el) => el.text().includes(name));

beforeEach(() => {
    resetProjectTreeCache();
    resetFavourites();
    projectTreePanelState.collapsed = false;
    projectTreePanelState.open = false;
    apiRequest.mockImplementation((method, url) => {
        const match = /sprintFolder\/(\w+)\?collection=(\w+)/.exec(url);
        if (match) return Promise.resolve({ data: (match[2] === 'sprints' ? SPRINTS : FOLDERS)[match[1]] || [] });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
});

describe('the project tree', () => {
    it('is a tree of projects, folders and sprints with the current location opened and marked', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        expect(wrapper.find('[role="tree"]').attributes('aria-label')).toBe('Projects');

        const project = itemNamed(wrapper, 'Alpha');
        expect(project.attributes('aria-level')).toBe('1');
        expect(project.attributes('aria-expanded')).toBe('true');
        const folder = itemNamed(wrapper, 'Design');
        expect(folder.attributes('aria-level')).toBe('2');
        const current = itemNamed(wrapper, 'Sprint 2');
        expect(current.attributes('aria-level')).toBe('3');
        expect(current.attributes('aria-current')).toBe('page');
        expect(current.attributes('aria-selected')).toBe('true');
        expect(current.attributes('tabindex')).toBe('0');
        expect(items(wrapper).filter((el) => el.attributes('aria-current') === 'page')).toHaveLength(1);
    });

    it('shows task counts on sprints and folders', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        const row = (name) => itemNamed(wrapper, name).element.closest('.pt-row');
        expect(row('Backlog').textContent).toContain('4');
        expect(row('Design').textContent).toContain('5');
    });

    it('hides private sprints the member is not on, and deleted ones', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        const text = wrapper.text();
        expect(text).not.toContain('Secret sprint');
        expect(text).not.toContain('Deleted sprint');
        expect(text).toContain('Team sprint');
        expect(text).toContain('Mine');
    });

    it('shows an admin every private sprint', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' }, { roleType: 2 });
        expect(wrapper.text()).toContain('Secret sprint');
    });

    it('moves focus with the arrow keys and opens a closed project with the right arrow', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        const current = itemNamed(wrapper, 'Sprint 2');
        current.element.focus();
        await current.trigger('keydown', { key: 'ArrowUp' });
        expect(document.activeElement.textContent).toContain('Design');
        await wrapper.find('[role="tree"]').trigger('keydown', { key: 'End' });
        expect(document.activeElement.textContent).toContain('Beta');

        const beta = itemNamed(wrapper, 'Beta');
        expect(beta.attributes('aria-expanded')).toBe('false');
        await beta.trigger('keydown', { key: 'ArrowRight' });
        await flushPromises();
        expect(itemNamed(wrapper, 'Beta').attributes('aria-expanded')).toBe('true');
        expect(wrapper.text()).toContain('Beta list');

        await itemNamed(wrapper, 'Beta').trigger('keydown', { key: 'ArrowLeft' });
        expect(itemNamed(wrapper, 'Beta').attributes('aria-expanded')).toBe('false');
    });

    it('puts no control inside another and links each item', async () => {
        const { wrapper, router } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        const interactive = 'a[href], button, [tabindex]:not([tabindex="-1"])';
        const nested = [...wrapper.element.querySelectorAll('*')].filter((el) => el.matches(interactive) && el.querySelector(interactive));
        expect(nested).toEqual([]);
        expect(itemNamed(wrapper, 'Backlog').attributes('href')).toBe(router.resolve({ name: 'ProjectSprint', params: { cid: 'company-1', id: 'p1', sprintId: 's1' } }).href);
    });
});

describe('the tree panel on project pages', () => {
    it('shows the tree beside the project at 1024px and wider', async () => {
        const { wrapper } = await mountWith(ProjectTreePanel, { projects: PROJECTS }, { width: 1024 });
        const panel = wrapper.find('#project-tree-panel');
        expect(panel.exists()).toBe(true);
        expect(panel.find('[role="tree"]').exists()).toBe(true);
        expect(itemNamed(wrapper, 'Sprint 2').attributes('aria-current')).toBe('page');
        expect(wrapper.text()).not.toContain('Secret sprint');
    });

    it('stays out of the way on a narrow screen until its button opens it', async () => {
        const { wrapper } = await mountWith(ProjectTreePanel, { projects: PROJECTS }, { width: 390 });
        expect(wrapper.find('[role="tree"]').exists()).toBe(false);
        projectTreePanelState.open = true;
        await flushPromises();
        expect(wrapper.find('[role="tree"]').exists()).toBe(true);
    });

    it('can be collapsed on a wide screen', async () => {
        const { wrapper } = await mountWith(ProjectTreePanel, { projects: PROJECTS }, { width: 1280 });
        projectTreePanelState.collapsed = true;
        await flushPromises();
        expect(wrapper.find('[role="tree"]').exists()).toBe(false);
    });

    it('is mounted by the project page', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/Projects.vue'), 'utf8');
        expect(source).toMatch(/<ProjectTreePanel\b/);
    });
});
