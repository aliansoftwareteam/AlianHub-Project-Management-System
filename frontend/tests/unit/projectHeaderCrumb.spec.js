import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn(() => Promise.resolve({ data: { status: true, data: [] } })) }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));

import * as env from '@/config/env';
import ProjectHeader from '@/views/Projects/components/ProjectHeader.vue';
import { resetFavourites, isFavourite } from '@/composable/favourites';
import { projectTreePanelState } from '@/views/Projects/components/projectTreePanelState';

const blank = { render: () => null };
const project = { _id: 'p1', ProjectName: 'Alpha', ProjectCode: 'AL' };

const open = async (sprint) => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/:cid/project/:id/p', name: 'Project', component: blank },
            { path: '/:cid/project/:id/fs/:folderId/:sprintId', name: 'ProjectFolderSprint', component: blank },
            { path: '/:cid/project/:id/s/:sprintId', name: 'ProjectSprint', component: blank }
        ]
    });
    await router.push({ name: 'Project', params: { cid: 'company-1', id: 'p1' } });
    await router.isReady();
    const wrapper = mount(ProjectHeader, { props: { project, projects: [project], sprint }, global: { plugins: [router] } });
    await flushPromises();
    return { wrapper, router };
};

beforeEach(() => {
    resetFavourites();
    apiRequest.mockClear();
});

describe('the project header location', () => {
    it('links the sprint crumb to the sprint', async () => {
        const { wrapper, router } = await open({ id: 's1', name: 'Sprint 1' });
        const crumb = wrapper.find('.ph2__crumb a[href]');
        expect(crumb.exists()).toBe(true);
        expect(crumb.text()).toBe('Sprint 1');
        expect(crumb.attributes('href')).toBe(router.resolve({ name: 'ProjectSprint', params: { cid: 'company-1', id: 'p1', sprintId: 's1' } }).href);
    });

    it('links a sprint inside a folder through its folder', async () => {
        const { wrapper, router } = await open({ id: 's2', name: 'Sprint 2', folderId: 'f1' });
        expect(wrapper.find('.ph2__crumb a[href]').attributes('href')).toBe(router.resolve({ name: 'ProjectFolderSprint', params: { cid: 'company-1', id: 'p1', folderId: 'f1', sprintId: 's2' } }).href);
    });

    it('stars the sprint in view from its crumb', async () => {
        const { wrapper } = await open({ id: 's1', name: 'Sprint 1' });
        await wrapper.find('.ph2__crumb button').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', env.USER_FAVOURITES, { type: 'sprint', id: 's1', favourite: true });
        expect(isFavourite('sprint', 's1')).toBe(true);
    });

    it('stars the project from the one store when no title slot replaces it', async () => {
        const { wrapper } = await open(null);
        await wrapper.find('.ph2__star').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', env.USER_FAVOURITES, { type: 'project', id: 'p1', favourite: true });
    });

    it('has a button that shows or hides the project tree', async () => {
        const { wrapper } = await open(null);
        const toggle = wrapper.find('button[aria-controls="project-tree-panel"]');
        expect(toggle.exists()).toBe(true);
        const before = toggle.attributes('aria-expanded');
        await toggle.trigger('click');
        expect(toggle.attributes('aria-expanded')).not.toBe(before);
        projectTreePanelState.collapsed = false;
        projectTreePanelState.open = false;
    });
});
