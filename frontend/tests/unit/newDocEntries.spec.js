import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { api, push, perms, toast } = vi.hoisted(() => ({
    api: { apiRequest: vi.fn() },
    push: vi.fn(),
    perms: { allowed: true },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/services', () => api);
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'c1', id: 'p1' } }), useRouter: () => ({ push }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => perms.allowed }) }));

import NewInProjectMenu from '@/views/Projects/components/NewInProjectMenu.vue';
import { canCreateDocIn } from '@/components/molecules/Pages/useNewDoc';

const ME = 'user-1';
const OPEN_PROJECT = { _id: 'p1', ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] };
const PRIVATE_PROJECT = { _id: 'p2', ProjectName: 'Board only', isPrivateSpace: true, AssigneeUserId: ['user-9', 'tId_team-1'] };
const MY_TEAM = { _id: 'team-1', assigneeUsersArray: [ME] };

describe('who may create a doc', () => {
    it('is any member when the doc has no project', () => {
        expect(canCreateDocIn(null, { userId: ME, roleType: 3 })).toBe(true);
    });

    it('is anyone who sees a project that is not private', () => {
        expect(canCreateDocIn(OPEN_PROJECT, { userId: ME, roleType: 3 })).toBe(true);
        expect(canCreateDocIn(OPEN_PROJECT, { userId: ME, roleType: 0 })).toBe(true);
    });

    it('is only the people and teams on a private project, and owners and admins', () => {
        expect(canCreateDocIn(PRIVATE_PROJECT, { userId: ME, roleType: 3 })).toBe(false);
        expect(canCreateDocIn(PRIVATE_PROJECT, { userId: 'user-9', roleType: 3 })).toBe(true);
        expect(canCreateDocIn(PRIVATE_PROJECT, { userId: ME, roleType: 3, teams: [MY_TEAM] })).toBe(true);
        expect(canCreateDocIn(PRIVATE_PROJECT, { userId: ME, roleType: 1 })).toBe(true);
        expect(canCreateDocIn(PRIVATE_PROJECT, { userId: ME, roleType: 2 })).toBe(true);
    });
});

describe('New doc in the project "+ New" menu', () => {
    let wrapper;
    const created = () => api.apiRequest.mock.calls.filter(([method]) => method === 'post').map(([, url, body]) => [url, body]);
    const docItem = () => wrapper.findAll('[role="menuitem"]').find((item) => item.text().includes('Docs.new_doc'));

    async function openMenu(projectData, { roleType = 3, teams = [] } = {}) {
        const store = createStore({
            modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), teams: () => teams } } },
        });
        wrapper = mount(NewInProjectMenu, {
            props: { projectData },
            global: { plugins: [store], stubs: { ShellIcon: true, SprintFolderInput: true, teleport: true } },
        });
        const trigger = wrapper.find('button[aria-expanded]');
        if (trigger.exists()) await trigger.trigger('click');
        return trigger.exists();
    }

    beforeEach(() => {
        perms.allowed = true;
        api.apiRequest.mockResolvedValue({ data: { status: true, data: { _id: 'd9' } } });
    });
    afterEach(() => wrapper?.unmount());

    it('creates the doc in this project and opens it', async () => {
        await openMenu(OPEN_PROJECT);
        await docItem().trigger('click');
        await flushPromises();
        expect(created()).toEqual([['/api/v2/pages', { title: 'Docs.untitled', projectId: 'p1' }]]);
        expect(push).toHaveBeenCalledWith({ name: 'PageEditor', params: { cid: 'c1', pageId: 'd9' } });
        expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    });

    it('is hidden in a private project the person is not on', async () => {
        await openMenu(PRIVATE_PROJECT);
        expect(wrapper.findAll('[role="menuitem"]').length).toBeGreaterThan(0);
        expect(docItem()).toBeUndefined();
    });

    it('shows in a private project for its team and for an admin', async () => {
        await openMenu(PRIVATE_PROJECT, { teams: [MY_TEAM] });
        expect(docItem()).toBeDefined();
        wrapper.unmount();
        await openMenu(PRIVATE_PROJECT, { roleType: 2 });
        expect(docItem()).toBeDefined();
    });

    it('is the only entry for someone who may write docs but not add tasks, lists or folders', async () => {
        perms.allowed = false;
        expect(await openMenu(OPEN_PROJECT)).toBe(true);
        expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text())).toEqual(['Docs.new_doc']);
    });

    it('leaves no menu at all when nothing can be created', async () => {
        perms.allowed = false;
        expect(await openMenu(PRIVATE_PROJECT)).toBe(false);
    });

    it('says so when the server refuses, and opens nothing', async () => {
        api.apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Project not found.' } });
        await openMenu(OPEN_PROJECT);
        await docItem().trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Project not found.', { position: 'top-right' });
        expect(push).not.toHaveBeenCalled();
    });
});
