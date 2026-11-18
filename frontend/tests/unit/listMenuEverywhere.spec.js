/* Task 046: a list offers one menu, the same in every place a list is shown. The benchmark found
   "Move to folder" and "Make it a sprint" on the Calendar tab alone. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';
import fs from 'fs';
import path from 'path';

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
import { useCustomComposable } from '@/composable';
import ListMenu from '@/components/molecules/ListMenu/ListMenu.vue';
import ProjectHeader from '@/views/Projects/components/ProjectHeader.vue';
import { LIST_MENU, listMenuEntries, sprintState } from '@/views/Projects/composables/listMenu';
import { resetProjectTreeCache } from '@/components/molecules/ProjectTree/projectTreeData';
import { resetFavourites } from '@/composable/favourites';
import { undoToast } from '@/composable/useUndoToast';
import { resetLinkableGoals } from '@/views/Goals/goalLinking';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const MEMBER = 3;
const GUEST = 0;
const KEYS = ['project_sprint_create', 'project_sprint_name_edit', 'sprint_type_change', 'sprint_archive', 'sprint_delete', 'sprint_restore'];
const rulesGranting = (...granted) => ({
    project: Object.fromEntries(KEYS.map((key) => [key, { roles: [{ key: MEMBER, permission: granted.includes(key) }] }]))
});
const without = (...denied) => rulesGranting(...KEYS.filter((key) => !denied.includes(key)));

const DAY = 24 * 60 * 60 * 1000;
const FOLDERS = [
    { _id: 'design', name: 'Design', projectId: 'p1', deletedStatusKey: 0, parentFolderId: null },
    { _id: 'icons', name: 'Icons', projectId: 'p1', deletedStatusKey: 0, parentFolderId: 'design' }
];
const sprint = (id, name, extra = {}) => ({ _id: id, name, projectId: 'p1', deletedStatusKey: 0, private: false, ...extra });
const SPRINTS = [
    sprint('plain', 'Roadmap', { folderId: 'design' }),
    sprint('planned', 'Sprint 9', { isScrum: true, state: 'planned' }),
    sprint('running', 'Sprint 8', { isScrum: true, state: 'active', endDate: new Date(Date.now() + DAY).toISOString() }),
    sprint('shelved', 'Old ideas', { deletedStatusKey: 2 })
];
const project = (extra = {}) => ({ _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true, ...extra });
const docOf = (id) => SPRINTS.find((item) => item._id === id);
/* The shape the project views hold a list in: the document with its id spelled `id`. */
const grouped = (id) => ({ ...docOf(id), id });
const folderMap = () => Object.fromEntries(FOLDERS.map((folder) => [folder._id, { ...folder, folderId: folder._id }]));

const commits = [];
let viewerRole = MEMBER;
const makeStore = () => createStore({
    getters: {
        'projectData/sprints': () => ({ p1: SPRINTS }),
        'projectData/folders': () => ({ p1: FOLDERS }),
        'settings/companyUserDetail': () => ({ roleType: viewerRole }),
        'settings/teams': () => []
    },
    mutations: {
        'projectData/mutateSprints': (state, payload) => commits.push({ type: 'projectData/mutateSprints', payload }),
        'projectData/relocateSprint': (state, payload) => commits.push({ type: 'projectData/relocateSprint', payload })
    }
});

const blank = { render: () => null };
const routes = [
    { path: '/:cid/project/:id/p', name: 'Project', component: blank },
    { path: '/:cid/project/:id/f/:folderId', name: 'ProjectFolder', component: blank },
    { path: '/:cid/project/:id/fs/:folderId/:sprintId', name: 'ProjectFolderSprint', component: blank },
    { path: '/:cid/project/:id/s/:sprintId', name: 'ProjectSprint', component: blank }
];
let router;

const mounted = [];
const show = (component, props) => {
    const wrapper = mount(component, { props, attachTo: document.body, global: { plugins: [makeStore(), router], mocks: { $t: i18n.global.t } } });
    mounted.push(wrapper);
    return wrapper;
};

const popupIds = () => [...document.body.querySelectorAll('.task-menu [role="menuitem"]')].map((item) => item.getAttribute('data-item'));
const closePopup = async () => {
    document.body.click();
    await flushPromises();
};

/* Each place a list shows its menu, and how its entry ids are read there. */
const PLACES = {
    'the project tree': async (id, handed, archivedView) => {
        const wrapper = show(ListMenu, { inTree: true, project: handed, sprint: { id, name: docOf(id).name, folderId: docOf(id).folderId || '' }, folders: FOLDERS, sprints: SPRINTS, archivedView });
        if (!wrapper.find('.pt-row__more').exists()) return [];
        await wrapper.find('.pt-row__more').trigger('click');
        return wrapper.findAll('[role="menuitem"]').map((item) => item.attributes('data-item'));
    },
    'the project header': async (id, handed, archivedView) => {
        const wrapper = mount(ProjectHeader, {
            props: { project: handed, projects: [handed], sprint: grouped(id) },
            attachTo: document.body,
            global: { plugins: [makeStore(), router], mocks: { $t: i18n.global.t }, provide: { showArchived: archivedView } }
        });
        mounted.push(wrapper);
        if (!wrapper.find('.ph2__crumb .lm__more').exists()) return [];
        await wrapper.find('.ph2__crumb .lm__more').trigger('click');
        await flushPromises();
        const ids = popupIds();
        await closePopup();
        return ids;
    },
    'a List view heading': async (id, handed, archivedView) => {
        const wrapper = show(ListMenu, { project: handed, sprint: grouped(id), archivedView });
        if (!wrapper.find('.lm__more').exists()) return [];
        await wrapper.find('.lm__more').trigger('click');
        await flushPromises();
        const ids = popupIds();
        await closePopup();
        return ids;
    },
    'the Calendar tab': async (id, handed, archivedView) => {
        const { checkPermission } = useCustomComposable();
        return listMenuEntries({
            project: handed,
            list: grouped(id),
            folders: folderMap(),
            check: (key) => checkPermission(key, handed.isGlobalPermission),
            archivedView,
            goalsOffered: viewerRole !== GUEST && router.hasRoute('Goals')
        }).map((entry) => entry.id);
    }
};
const everywhere = async (id, handed = project(), archivedView = false) => {
    const seen = {};
    for (const [place, read] of Object.entries(PLACES)) seen[place] = await read(id, handed, archivedView);
    return seen;
};
const inEveryPlace = (ids) => Object.fromEntries(Object.keys(PLACES).map((place) => [place, ids]));

const source = (file) => fs.readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');

beforeEach(async () => {
    commits.length = 0;
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
    Object.values(toast).forEach((spy) => spy.mockClear());
    resetProjectTreeCache();
    resetFavourites();
    resetLinkableGoals();
    viewerRole = MEMBER;
    Object.assign(getters, {
        'settings/companyUserDetail': { roleType: MEMBER },
        'settings/rules': rulesGranting(...KEYS),
        'settings/projectRules': rulesGranting()
    });
    router = createRouter({ history: createMemoryHistory(), routes });
    await router.push({ name: 'ProjectFolderSprint', params: { cid: 'company-1', id: 'p1', folderId: 'design', sprintId: 'plain' } });
    await router.isReady();
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

describe('the places that draw a list menu take it from the one source', () => {
    it.each([
        ['the project tree', 'components/molecules/ProjectTree/ProjectTree.vue', /<ListMenu[\s\S]*?in-tree/],
        ['the project header', 'views/Projects/components/ProjectHeader.vue', /<ListMenu /],
        ['a List view heading', 'views/Projects/ListView/ListView.vue', /<ListMenu /],
        ['the Calendar tab', 'components/organisms/SprinstList/SprintsList.vue', /v-for="entry in listEntries"/]
    ])('%s', (place, file, drawn) => {
        expect(source(file)).toMatch(drawn);
    });

    it('the Calendar tab spells out no list entry of its own', () => {
        const calendar = source('components/organisms/SprinstList/SprintsList.vue');
        expect(calendar).toMatch(/listMenuEntries\(/);
        expect(calendar).not.toMatch(/Scrum\.make_it_a_sprint|Projects\.move_to_folder'/);
    });

    it('the menu component knows no entry the source does not list', () => {
        const ids = LIST_MENU.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(['rename', 'copy-link', 'move', 'count-toward-goal', 'start-sprint', 'complete-sprint', 'sprint-settings', 'plain-list', 'archive', 'restore', 'delete']);
    });
});

describe('the same list shows the same entries in every place', () => {
    it('a plain list: rename, link, move, make it a sprint, archive, delete', async () => {
        expect(await everywhere('plain')).toEqual(inEveryPlace(['rename', 'copy-link', 'move', 'sprint-settings', 'archive', 'delete']));
    });

    it('a sprint that has not started can be started or made a plain list again', async () => {
        expect(await everywhere('planned')).toEqual(inEveryPlace(['rename', 'copy-link', 'move', 'start-sprint', 'sprint-settings', 'plain-list', 'archive', 'delete']));
    });

    it('a running sprint can be completed, and not made a plain list', async () => {
        expect(await everywhere('running')).toEqual(inEveryPlace(['rename', 'copy-link', 'move', 'complete-sprint', 'sprint-settings', 'archive', 'delete']));
    });

    it('an archived list can be linked to, restored or deleted', async () => {
        expect(await everywhere('shelved', project(), true)).toEqual(inEveryPlace(['copy-link', 'restore', 'delete']));
    });

    it('a closed project leaves the link alone', async () => {
        expect(await everywhere('plain', project({ status: 'close' }))).toEqual(inEveryPlace(['copy-link']));
    });

    it('says "Make it a sprint" for a plain list and "Sprint settings" for a sprint', () => {
        const label = (id) => listMenuEntries({ project: project(), list: grouped(id), folders: FOLDERS, check: () => true }).find((entry) => entry.id === 'sprint-settings').labelKey;
        expect(en.Scrum[label('plain').split('.')[1]]).toBe('Make it a sprint');
        expect(en.Scrum[label('planned').split('.')[1]]).toBe('Sprint settings');
        expect(en.Scrum.make_it_a_plain_list).toBe('Make it a plain list');
    });
});

describe('an entry whose permission is off is gone from every place', () => {
    it.each([
        ['project_sprint_name_edit', 'plain', ['copy-link', 'move', 'sprint-settings', 'archive', 'delete']],
        ['sprint_archive', 'plain', ['rename', 'copy-link', 'move', 'sprint-settings', 'delete']],
        ['sprint_delete', 'plain', ['rename', 'copy-link', 'move', 'sprint-settings', 'archive']],
        ['project_sprint_create', 'planned', ['rename', 'copy-link', 'move', 'archive', 'delete']],
        ['sprint_restore', 'shelved', ['copy-link', 'delete']]
    ])('%s', async (key, id, left) => {
        getters['settings/rules'] = without(key);
        expect(await everywhere(id, project(), id === 'shelved')).toEqual(inEveryPlace(left));
    });

    it('the move needs one of the three keys the server takes for it', async () => {
        getters['settings/rules'] = without('project_sprint_name_edit', 'sprint_type_change', 'project_sprint_create');
        expect(await everywhere('plain')).toEqual(inEveryPlace(['copy-link', 'archive', 'delete']));
        getters['settings/rules'] = rulesGranting('sprint_type_change');
        expect(await everywhere('plain')).toEqual(inEveryPlace(['copy-link', 'move']));
    });

    it('each key is read from the rules of the project the menu is handed', async () => {
        const own = project({ isGlobalPermission: false });
        expect(await everywhere('plain', own)).toEqual(inEveryPlace(['copy-link']));
        getters['settings/projectRules'] = rulesGranting('sprint_archive', 'project_sprint_create');
        getters['settings/rules'] = rulesGranting();
        expect(await everywhere('plain', own)).toEqual(inEveryPlace(['copy-link', 'move', 'sprint-settings', 'archive']));
    });
});

describe('the sprint state the entries follow', () => {
    it('matches the server: none, planned, active, overdue, closed', () => {
        const now = Date.parse('2026-10-01T12:00:00Z');
        expect(sprintState({ isScrum: false, state: 'active' }, now)).toBe('none');
        expect(sprintState({ isScrum: true, state: '' }, now)).toBe('planned');
        expect(sprintState({ isScrum: true, state: 'active', endDate: '2026-10-02T00:00:00Z' }, now)).toBe('active');
        expect(sprintState({ isScrum: true, state: 'active', endDate: '2026-09-30T00:00:00Z' }, now)).toBe('overdue');
        expect(sprintState({ isScrum: true, state: 'closed' }, now)).toBe('closed');
    });
});

describe('what the entries do, from a place that had none of them before', () => {
    const heading = (id, extra = {}) => show(ListMenu, { project: project(), sprint: grouped(id), ...extra });
    const choose = async (wrapper, id) => {
        await wrapper.find('.lm__more').trigger('click');
        await flushPromises();
        document.body.querySelector(`.task-menu [data-item="${id}"]`).click();
        await vi.dynamicImportSettled();
        await flushPromises();
    };
    const confirm = async () => {
        document.body.querySelector('[data-action="confirm"]').click();
        await flushPromises();
    };
    const answer = (doc) => apiRequest.mockResolvedValue({ data: { status: true, data: doc } });

    it('archive asks first, sends the status the server archives on, and offers an undo', async () => {
        answer({ ...docOf('plain'), deletedStatusKey: 2 });
        const wrapper = heading('plain');
        await choose(wrapper, 'archive');
        expect(apiRequest).not.toHaveBeenCalledWith('patch', expect.anything(), expect.anything());
        expect(document.body.querySelector('[role="alertdialog"]').textContent).toContain('Archive Roadmap?');
        await confirm();

        const [method, url, body] = apiRequest.mock.calls.find(([verb]) => verb === 'patch');
        expect([method, url]).toEqual(['patch', `${env.SPRINT}/plain`]);
        expect(body).toMatchObject({
            type: 'updateSprint', companyId: 'company-1', projectId: 'p1', folderId: 'design', sprintName: 'Roadmap',
            updateObject: { $set: { deletedStatusKey: 2 } }, projectData: { id: 'p1', ProjectName: 'Alpha' }
        });
        expect(commits).toEqual([{ type: 'projectData/mutateSprints', payload: { op: 'modified', data: { ...docOf('plain'), deletedStatusKey: 2 } } }]);
        expect(undoToast.current.message).toBe('Roadmap archived');
        expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    });

    it('leaves the page of the list it archived for the folder that held it', async () => {
        answer({ ...docOf('plain'), deletedStatusKey: 2 });
        const wrapper = heading('plain');
        await choose(wrapper, 'archive');
        await confirm();
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('ProjectFolder');
        expect(router.currentRoute.value.params.folderId).toBe('design');
    });

    it('delete asks first and sends the status the server deletes on', async () => {
        answer({ ...docOf('planned'), deletedStatusKey: 1 });
        const wrapper = heading('planned');
        await choose(wrapper, 'delete');
        expect(document.body.querySelector('[role="alertdialog"]').textContent).toContain('Delete Sprint 9?');
        await confirm();
        expect(apiRequest.mock.calls.find(([verb]) => verb === 'patch')[2].updateObject).toEqual({ $set: { deletedStatusKey: 1 } });
        expect(toast.success).toHaveBeenCalledWith('Sprint 9 deleted', { position: 'top-right' });
        expect(router.currentRoute.value.name).toBe('ProjectFolderSprint');
    });

    it('shows the server\'s reason when a write is refused, and stores nothing', async () => {
        apiRequest.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { status: false, statusText: 'Complete the sprint before archiving it.' } } }));
        const wrapper = heading('running');
        await choose(wrapper, 'archive');
        await confirm();
        expect(toast.error).toHaveBeenCalledWith('Complete the sprint before archiving it.', { position: 'top-right' });
        expect(commits).toEqual([]);
    });

    it('restore sends status 0 from the archived view', async () => {
        answer({ ...docOf('shelved'), deletedStatusKey: 0 });
        const wrapper = heading('shelved', { archivedView: true });
        await choose(wrapper, 'restore');
        expect(apiRequest.mock.calls.find(([verb]) => verb === 'patch')[2].updateObject).toEqual({ $set: { deletedStatusKey: 0 } });
        expect(toast.success).toHaveBeenCalledWith('Old ideas restored', { position: 'top-right' });
    });

    it('start sprint and make it a plain list call the sprint routes the Calendar tab calls', async () => {
        answer({ ...docOf('planned'), state: 'active' });
        await choose(heading('planned'), 'start-sprint');
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/sprints/start', { sprintId: 'planned' });
        expect(toast.success).toHaveBeenCalledWith('Sprint started', { position: 'top-right' });

        answer({ ...docOf('planned'), isScrum: false, state: '' });
        await choose(heading('planned'), 'plain-list');
        expect(document.body.querySelector('[role="alertdialog"]').textContent).toContain('Make Sprint 9 a plain list?');
        await confirm();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/sprints/scrum', { sprintId: 'planned', isScrum: false });
        expect(commits[commits.length - 1].payload.data).toMatchObject({ _id: 'planned', id: 'planned', isScrum: false });
    });

    it('make it a sprint opens the sprint settings for that list', async () => {
        await choose(heading('plain'), 'sprint-settings');
        expect(document.body.querySelector('.ssm [type="checkbox"]')).not.toBeNull();
        expect(document.body.querySelector('.ssm__sub').textContent).toBe('Roadmap');
    });

    it('move offers the folders and moves the list into the one picked', async () => {
        answer({ ...docOf('plain'), folderId: 'icons' });
        await choose(heading('plain'), 'move');
        const targets = [...document.body.querySelectorAll('.mtf__item')];
        expect(targets.map((el) => el.querySelector('.mtf__name').textContent.trim())).toEqual(['Top level of the project', 'Design', 'Icons']);
        targets[2].click();
        await flushPromises();
        expect(apiRequest.mock.calls.find(([verb]) => verb === 'patch')[2].updateObject).toEqual({ $set: { folderId: 'icons', folderName: 'Icons' } });
        expect(toast.success).toHaveBeenCalledWith('List moved', { position: 'top-right' });
    });

    it('rename edits the name in a dialog outside the tree', async () => {
        await choose(heading('plain'), 'rename');
        const field = document.body.querySelector('[role="dialog"] input.pt-row__rename');
        expect(field.value).toBe('Roadmap');
        expect(document.body.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Rename list');
    });

    it('copy link writes the address of the list\'s own page', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await choose(heading('plain'), 'copy-link');
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toMatch(/\/company-1\/project\/p1\/fs\/design\/plain$/);
        expect(toast.success).toHaveBeenCalled();
    });

    it('runs an entry for a place that draws the entries itself', async () => {
        const wrapper = show(ListMenu, { headless: true, project: project(), sprint: grouped('plain') });
        expect(wrapper.find('button').exists()).toBe(false);
        wrapper.vm.run('archive');
        await flushPromises();
        expect(document.body.querySelector('[role="alertdialog"]').textContent).toContain('Archive Roadmap?');
    });
});

describe('counting a list toward a goal', () => {
    const GOAL = { _id: 'g1', name: 'Launch the site', canEdit: true, archived: false, targets: [{ id: 't1', name: 'Launch tasks', kind: 'tasks', sources: { sprintIds: [], taskIds: [] } }] };
    const goalsAre = (goals) => apiRequest.mockImplementation((method, url) => Promise.resolve({ data: { status: true, data: url === '/api/v2/goals' ? goals : [] } }));
    const goalReads = () => apiRequest.mock.calls.filter(([, url]) => url === '/api/v2/goals');
    const WITH_ENTRY = ['rename', 'copy-link', 'move', 'count-toward-goal', 'sprint-settings', 'archive', 'delete'];
    const WITHOUT_ENTRY = WITH_ENTRY.filter((id) => id !== 'count-toward-goal');

    beforeEach(() => {
        router.addRoute({ path: '/:cid/goals', name: 'Goals', component: blank });
        goalsAre([GOAL]);
    });

    it('is offered in every place to anyone who could own a goal, whatever goals they have', async () => {
        goalsAre([]);
        expect(await everywhere('plain')).toEqual(inEveryPlace(WITH_ENTRY));
    });

    it('is offered nowhere to a guest, and nowhere in a build without the Goals page', async () => {
        viewerRole = GUEST;
        expect(await everywhere('plain')).toEqual(inEveryPlace(WITHOUT_ENTRY));
        expect(goalReads()).toEqual([]);

        viewerRole = MEMBER;
        router.removeRoute('Goals');
        expect(await everywhere('plain')).toEqual(inEveryPlace(WITHOUT_ENTRY));
    });

    it('is not offered for an archived list, in a closed project, or for a chat channel', async () => {
        const offered = (seen) => Object.values(seen).some((ids) => ids.includes('count-toward-goal'));
        expect(offered(await everywhere('shelved', project(), true))).toBe(false);
        expect(offered(await everywhere('plain', project({ status: 'close' })))).toBe(false);
        const { checkPermission } = useCustomComposable();
        const ids = (list) => listMenuEntries({ project: project(), list, folders: [], check: (key) => checkPermission(key, true), goalsOffered: true }).map((entry) => entry.id);
        expect(ids({ ...grouped('plain'), mainChat: true })).not.toContain('count-toward-goal');
        expect(ids(grouped('plain'))).toContain('count-toward-goal');
    });

    it('asks for no goals when the menus are drawn, and once when the first of them is opened', async () => {
        const first = show(ListMenu, { project: project(), sprint: grouped('plain') });
        const second = show(ListMenu, { inTree: true, project: project(), sprint: { id: 'planned', name: 'Sprint 9', folderId: '' }, folders: FOLDERS, sprints: SPRINTS });
        show(ListMenu, { headless: true, project: project(), sprint: grouped('running') });
        await flushPromises();
        expect(goalReads()).toEqual([]);

        await first.find('.lm__more').trigger('click');
        await flushPromises();
        expect(goalReads()).toEqual([['get', '/api/v2/goals']]);
        await closePopup();

        await second.find('.pt-row__more').trigger('click');
        await first.find('.lm__more').trigger('click');
        await flushPromises();
        expect(goalReads()).toHaveLength(1);
    });

    it('is drawn by the Calendar tab with the same rule', () => {
        const calendar = source('components/organisms/SprinstList/SprintsList.vue');
        expect(calendar).toContain('const { offered: goalsOffered } = useGoalLinking();');
        expect(calendar).toContain('goalsOffered: goalsOffered.value');
    });

    it('opens the picker for that list, which sends the target\'s sources with the list added', async () => {
        const wrapper = show(ListMenu, { headless: true, project: project(), sprint: grouped('plain') });
        wrapper.vm.run('count-toward-goal');
        await vi.waitFor(() => expect(document.body.querySelector('[data-test="glk"]')).not.toBeNull());
        await flushPromises();
        expect(document.body.querySelector('[data-test="glk"]').textContent).toContain('the list Roadmap');

        apiRequest.mockClear();
        document.body.querySelector('[data-test="glk"]').dispatchEvent(new Event('submit', { cancelable: true }));
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('patch', '/api/v2/goals/g1/targets/t1', { sources: { sprintIds: ['plain'], taskIds: [] } });
        expect(document.body.querySelector('[data-test="glk"]')).toBeNull();
    });
});
