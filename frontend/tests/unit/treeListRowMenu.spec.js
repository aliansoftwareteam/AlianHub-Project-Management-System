import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

const { apiRequest, getters, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    getters: {},
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

/* The real checkPermission runs here over a store this spec fills, and nothing provides `selectedProject`:
   an entry shows only if the menu reads the project it was handed. */
vi.mock('@/store/index', () => ({ default: { getters } }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/utils/storageQueryBuild', () => ({ storageQueryBuilder: vi.fn() }));
vi.mock('@/composable/commonFunction', () => ({ isBundledPriorityImage: vi.fn() }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import * as env from '@/config/env';
import en from '@/locales/en';
import SprintRowMenu from '@/components/molecules/ProjectTree/SprintRowMenu.vue';
import SprintRenameInput from '@/components/molecules/ProjectTree/SprintRenameInput.vue';
import ProjectTree from '@/components/molecules/ProjectTree/ProjectTree.vue';
import { resetProjectTreeCache } from '@/components/molecules/ProjectTree/projectTreeData';
import { resetFavourites } from '@/composable/favourites';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const MEMBER = 3;
const KEYS = ['project_sprint_create', 'project_sprint_name_edit', 'sprint_type_change', 'project_folder_create'];
const rulesGranting = (...granted) => ({
    project: Object.fromEntries(KEYS.map((key) => [key, { roles: [{ key: MEMBER, permission: granted.includes(key) }] }]))
});

const folder = (id, name, extra = {}) => ({ _id: id, name, projectId: 'p1', deletedStatusKey: 0, parentFolderId: null, ...extra });
const FOLDERS = [folder('design', 'Design'), folder('icons', 'Icons', { parentFolderId: 'design' }), folder('ops', 'Ops'), folder('old', 'Old', { deletedStatusKey: 2 })];
const sprint = (id, name, folderId, extra = {}) => ({ _id: id, name, projectId: 'p1', deletedStatusKey: 0, private: false, tasks: 0, ...(folderId ? { folderId } : {}), ...extra });
const SPRINTS = [sprint('d1', 'Roadmap', 'design'), sprint('d2', 'Research', 'design'), sprint('i1', 'Glyphs', 'icons'), sprint('r1', 'Inbox'), sprint('r2', 'Research')];
const project = (extra = {}) => ({ _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true, ...extra });

const commits = [];
const record = (type) => (state, payload) => commits.push({ type, payload });
const makeStore = () => createStore({
    getters: {
        'projectData/sprints': () => ({ p1: SPRINTS }),
        'projectData/folders': () => ({ p1: FOLDERS }),
        'settings/companyUserDetail': () => ({ roleType: MEMBER }),
        'settings/teams': () => []
    },
    mutations: {
        'projectData/mutateSprints': record('projectData/mutateSprints'),
        'projectData/relocateSprint': record('projectData/relocateSprint'),
        'projectData/mutateFolders': record('projectData/mutateFolders')
    }
});

const mounted = [];
const show = (component, props, plugins = []) => {
    const wrapper = mount(component, { props, attachTo: document.body, global: { plugins: [makeStore(), ...plugins], mocks: { $t: i18n.global.t } } });
    mounted.push(wrapper);
    return wrapper;
};
const rowOf = (id) => {
    const stored = SPRINTS.find((item) => item._id === id);
    return { id, name: stored.name, folderId: stored.folderId || '' };
};
const menu = (id, handed = project()) => show(SprintRowMenu, { project: handed, sprint: rowOf(id), folders: FOLDERS, sprints: SPRINTS });
const entries = async (wrapper) => {
    if (!wrapper.find('.pt-row__more').exists()) return [];
    await wrapper.find('.pt-row__more').trigger('click');
    return wrapper.findAll('[role="menuitem"]').map((item) => item.text());
};
const choose = async (wrapper, label) => {
    await wrapper.find('.pt-row__more').trigger('click');
    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === label).trigger('click');
    await vi.dynamicImportSettled();
    await flushPromises();
};
const targets = () => [...document.body.querySelectorAll('.mtf__item')];
const targetNames = () => targets().map((el) => el.querySelector('.mtf__name').textContent.trim());
const refusal = (statusText) => Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { status: false, statusText, message: statusText } } });
const moved = (id, folderId) => ({ ...SPRINTS.find((item) => item._id === id), folderId });

beforeEach(() => {
    commits.length = 0;
    apiRequest.mockReset();
    Object.values(toast).forEach((spy) => spy.mockClear());
    resetProjectTreeCache();
    resetFavourites();
    Object.assign(getters, {
        'settings/companyUserDetail': { roleType: MEMBER },
        'settings/rules': rulesGranting('project_sprint_name_edit'),
        'settings/projectRules': rulesGranting()
    });
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

describe('which actions a list row offers', () => {
    it('a move and a rename to someone who may rename lists', async () => {
        expect(await entries(menu('d1'))).toEqual(['Move to folder…', 'Rename']);
    });

    it.each(['sprint_type_change', 'project_sprint_create'])('only the move to someone who holds %s', async (key) => {
        getters['settings/rules'] = rulesGranting(key);
        expect(await entries(menu('d1'))).toEqual(['Move to folder…']);
    });

    it('nothing without one of the permissions the server asks for, or in a closed project', async () => {
        getters['settings/rules'] = rulesGranting('project_folder_create');
        expect(await entries(menu('d1'))).toEqual([]);
        getters['settings/rules'] = rulesGranting('project_sprint_name_edit');
        expect(await entries(menu('d1', project({ status: 'close' })))).toEqual([]);
    });

    it('reads each key from the rules of the project it is handed', async () => {
        expect(await entries(menu('d1', project({ isGlobalPermission: false })))).toEqual([]);
        getters['settings/projectRules'] = rulesGranting('project_sprint_name_edit');
        getters['settings/rules'] = rulesGranting();
        expect(await entries(menu('d1', project({ isGlobalPermission: false })))).toEqual(['Move to folder…', 'Rename']);
    });

    it('names the list in the label of its button', () => {
        expect(menu('d1').find('.pt-row__more').attributes('aria-label')).toBe('Actions for Roadmap');
    });
});

describe('moving a list', () => {
    it('offers the top level and every live folder, subfolders under their folder, with the current one marked', async () => {
        const wrapper = menu('d1');
        await choose(wrapper, 'Move to folder…');
        expect(targetNames()).toEqual(['Top level of the project', 'Design', 'Icons', 'Ops']);
        expect(targets().map((el) => el.classList.contains('mtf__item--sub'))).toEqual([false, false, true, false]);
        expect(targets().map((el) => el.getAttribute('aria-current'))).toEqual([null, 'true', null, null]);
        expect(document.body.textContent).toContain('Choose where Roadmap goes');
    });

    it('moves it into the subfolder that is picked', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: moved('d1', 'icons') } });
        const wrapper = menu('d1');
        await choose(wrapper, 'Move to folder…');
        targets()[2].click();
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledTimes(1);
        const [method, url, body] = apiRequest.mock.calls[0];
        expect([method, url]).toEqual(['patch', `${env.SPRINT}/d1`]);
        expect(body).toMatchObject({
            type: 'updateSprint',
            companyId: 'company-1',
            projectId: 'p1',
            updateObject: { $set: { folderId: 'icons', folderName: 'Icons' } },
            sprintName: 'Roadmap',
            projectData: { id: 'p1', ProjectName: 'Alpha' }
        });
        expect(commits).toEqual([
            { type: 'projectData/mutateSprints', payload: { op: 'modified', data: moved('d1', 'icons') } },
            { type: 'projectData/relocateSprint', payload: { data: moved('d1', 'icons'), oldFolderId: 'design' } }
        ]);
        expect(toast.success).toHaveBeenCalledWith('List moved', { position: 'top-right' });
        expect(wrapper.emitted('reveal')).toEqual([['icons']]);
        expect(document.body.querySelector('.mtf__item')).toBeNull();
    });

    it('moves it out to the top level', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: moved('i1', null) } });
        const wrapper = menu('i1');
        await choose(wrapper, 'Move to folder…');
        document.body.querySelector('.mtf__item--root').click();
        await flushPromises();

        expect(apiRequest.mock.calls[0][2].updateObject).toEqual({ $set: { folderId: null, folderName: '' } });
        expect(commits[1]).toEqual({ type: 'projectData/relocateSprint', payload: { data: moved('i1', null), oldFolderId: 'icons' } });
        expect(wrapper.emitted('reveal')).toBeUndefined();
    });

    it('moves a top-level list into a folder', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: moved('r1', 'ops') } });
        const wrapper = menu('r1');
        await choose(wrapper, 'Move to folder…');
        expect(targets()[0].getAttribute('aria-current')).toBe('true');
        targets()[3].click();
        await flushPromises();
        expect(apiRequest.mock.calls[0][2].updateObject).toEqual({ $set: { folderId: 'ops', folderName: 'Ops' } });
        expect(commits[1].payload.oldFolderId).toBeNull();
    });

    it('shows the server\'s reason when the move is refused, and stores nothing', async () => {
        apiRequest.mockRejectedValue(refusal('An archived or deleted folder cannot take a list.'));
        const wrapper = menu('d1');
        await choose(wrapper, 'Move to folder…');
        targets()[3].click();
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('An archived or deleted folder cannot take a list.', { position: 'top-right' });
        expect(commits).toEqual([]);
    });
});

describe('renaming a list', () => {
    const input = (id) => show(SprintRenameInput, { project: project(), sprint: rowOf(id), sprints: SPRINTS });
    const type = async (wrapper, name, key = 'Enter') => {
        await wrapper.find('input').setValue(name);
        await wrapper.find('input').trigger('keydown', { key });
        await flushPromises();
    };

    it('is asked of the tree, which edits the row in place', async () => {
        const wrapper = menu('d1');
        await choose(wrapper, 'Rename');
        expect(wrapper.emitted('rename')).toEqual([['d1']]);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('saves the new name on Enter', async () => {
        const renamed = { ...SPRINTS[0], name: 'Plan' };
        apiRequest.mockResolvedValue({ data: { status: true, data: renamed } });
        const wrapper = input('d1');
        expect(wrapper.find('input').attributes('aria-label')).toBe('Rename Roadmap');
        await type(wrapper, ' Plan ');

        expect(apiRequest).toHaveBeenCalledWith('patch', `${env.SPRINT}/d1`, { type: 'editSprintName', companyId: 'company-1', projectId: 'p1', sprintName: 'Plan' });
        expect(commits).toEqual([{ type: 'projectData/mutateSprints', payload: { op: 'modified', data: renamed } }]);
        expect(wrapper.emitted('done')).toHaveLength(1);
    });

    it('sends nothing for the same name, a short one, or the name of a list beside it', async () => {
        const same = input('d1');
        await type(same, 'Roadmap');
        expect(same.emitted('done')).toHaveLength(1);

        const short = input('d1');
        await type(short, 'ab');
        expect(toast.error).toHaveBeenCalledWith('A list name needs at least 3 characters.', { position: 'top-right' });
        expect(short.emitted('done')).toBeUndefined();

        const taken = input('d1');
        await type(taken, 'research');
        expect(toast.error).toHaveBeenCalledWith('Sprint already exists', { position: 'top-right' });
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('allows a name used in another folder', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { ...SPRINTS[0], name: 'Inbox' } } });
        await type(input('d1'), 'Inbox');
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('cancels on Escape and keeps the field open when the server refuses', async () => {
        const cancelled = input('d1');
        await type(cancelled, 'Plan', 'Escape');
        expect(cancelled.emitted('done')).toHaveLength(1);
        expect(apiRequest).not.toHaveBeenCalled();

        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Sprint not found' } });
        const refused = input('d1');
        await type(refused, 'Plan');
        expect(toast.error).toHaveBeenCalledWith('Sprint not found', { position: 'top-right' });
        expect(refused.emitted('done')).toBeUndefined();
        expect(commits).toEqual([]);
    });
});

describe('list rows in the project tree', () => {
    const blank = { render: () => null };
    const routes = [
        { path: '/:cid/project/:id/p', name: 'Project', component: blank },
        { path: '/:cid/project/:id/f/:folderId', name: 'ProjectFolder', component: blank },
        { path: '/:cid/project/:id/fs/:folderId/:sprintId', name: 'ProjectFolderSprint', component: blank },
        { path: '/:cid/project/:id/s/:sprintId', name: 'ProjectSprint', component: blank }
    ];
    const tree = async (projects = [project(), { _id: 'p2', ProjectName: 'Beta', isGlobalPermission: true }]) => {
        apiRequest.mockResolvedValue({ data: [] });
        const router = createRouter({ history: createMemoryHistory(), routes });
        await router.push({ name: 'ProjectFolderSprint', params: { cid: 'company-1', id: 'p1', folderId: 'design', sprintId: 'd1' } });
        await router.isReady();
        const wrapper = show(ProjectTree, { projects, label: 'Projects' }, [router]);
        await flushPromises();
        return wrapper;
    };
    const rowNamed = (wrapper, name) => wrapper.findAll('.pt-row').find((row) => row.find('.pt-row__name').exists() && row.find('.pt-row__name').text() === name);

    it('carry the menu in the open project', async () => {
        const wrapper = await tree();
        expect(rowNamed(wrapper, 'Roadmap').find('.pt-row__more').attributes('aria-label')).toBe('Actions for Roadmap');
        expect(rowNamed(wrapper, 'Inbox').find('.pt-row__more').exists()).toBe(true);
    });

    it('edit the name in place when Rename is chosen', async () => {
        const wrapper = await tree();
        await choose(rowNamed(wrapper, 'Roadmap'), 'Rename');
        const field = wrapper.find('input.pt-row__rename');
        expect(field.exists()).toBe(true);
        expect(field.element.value).toBe('Roadmap');
        await field.trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('input.pt-row__rename').exists()).toBe(false);
    });

    it('open the way to the subfolder a list was moved into', async () => {
        const wrapper = await tree();
        expect(rowNamed(wrapper, 'Glyphs')).toBeUndefined();
        apiRequest.mockResolvedValue({ data: { status: true, data: moved('r1', 'icons') } });
        await choose(rowNamed(wrapper, 'Inbox'), 'Move to folder…');
        targets()[2].click();
        await flushPromises();
        expect(rowNamed(wrapper, 'Glyphs')).toBeDefined();
    });
});
