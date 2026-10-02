/* Task 047: a list or a folder made, renamed, moved, archived or removed elsewhere reaches the store the tree, the
   List and Board headers and the list menu read, without a reload. The signal names the list or folder; what the
   project holds is read through the guarded route. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, ref } from 'vue';
import { createStore } from 'vuex';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => 0 }) }));
vi.mock('@/store/index', () => ({ default: { getters: { 'settings/companyUserDetail': {}, 'settings/rules': {}, 'settings/projectRules': {} } } }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/utils/storageQueryBuild', () => ({ storageQueryBuilder: vi.fn() }));
vi.mock('@/composable/commonFunction', () => ({ isBundledPriorityImage: vi.fn() }));

import * as mutations from '@/store/ProjectData/mutations';
import projectData from '@/store/ProjectData/index';
import { treeCache, resetProjectTreeCache } from '@/components/molecules/ProjectTree/projectTreeData';
import { projectBranch } from '@/components/molecules/ProjectTree/projectTreeModel';
import { GATHER_MS, READ_GAP_MS } from '@/views/Projects/liveProjects';
import { FOLDERS_CHANGED_EVENT, LIST_CHANGED_EVENT, useLiveLists } from '@/views/Projects/liveLists';

const APP = fs.readFileSync(path.resolve(__dirname, '../../src/App.vue'), 'utf8');
const TREE = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/composables/useProjectTree.js'), 'utf8');
const COMPANY = 'c1';
const READ = (projectId, collection) => `/api/v1/project/sprintFolder/${projectId}?collection=${collection}`;
const sprint = (over = {}) => ({ _id: 's1', projectId: 'p1', name: 'Backlog', private: false, deletedStatusKey: 0, tasks: 2, ...over });
const folder = (over = {}) => ({ _id: 'f1', projectId: 'p1', name: 'Design', deletedStatusKey: 0, parentFolderId: null, ...over });
const refused = (status) => Promise.reject(Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false } } }));

const fakeSocket = () => {
    const handlers = {};
    return {
        on: (event, handler) => { handlers[event] = handler; },
        off: (event, handler) => { if (handlers[event] === handler) delete handlers[event]; },
        fire: (event, payload) => handlers[event]?.(payload),
        bound: () => Object.keys(handlers).sort()
    };
};

let store;
let socket;
let socketRef;
let wrapper;
let server;

const Host = defineComponent({
    props: { companyId: String },
    setup(props) {
        useLiveLists(socketRef, computed(() => props.companyId));
        return () => h('div');
    }
});

/* The project page holds the open project's lists and folders in the store. */
const mountHost = ({ sprints = { p1: [sprint()] }, folders = { p1: [folder()] }, tasks = {} } = {}) => {
    store = createStore({
        modules: {
            projectData: {
                namespaced: true,
                state: () => ({ allProjects: { data: [{ _id: 'p1', ProjectName: 'Alpha', sprintsObj: {}, sprintsfolders: {} }] }, sprints, folders, tasks, tableTasks: {} }),
                getters: projectData.getters,
                mutations
            }
        }
    });
    wrapper = mount(Host, { props: { companyId: COMPANY }, global: { plugins: [store] } });
};

const listChanged = (projectId, sprintId = 's1', kind = 'changed', companyId = COMPANY) => socket.fire(LIST_CHANGED_EVENT, { kind, companyId, projectId, sprintId });
const folderChanged = (projectId, folderId = 'f1', kind = 'changed', companyId = COMPANY) => socket.fire(FOLDERS_CHANGED_EVENT, { kind, companyId, projectId, folderId });
const gathered = async (ms = GATHER_MS) => { await vi.advanceTimersByTimeAsync(ms); await flushPromises(); };
const reads = () => apiRequest.mock.calls.filter(([type]) => type === 'get').map(([, url]) => url);
const heldLists = (projectId = 'p1') => store.getters['projectData/sprints'][projectId];
const heldFolders = (projectId = 'p1') => store.getters['projectData/folders'][projectId];
const namesOf = (rows) => (rows || []).map((row) => row.name);
const branch = () => projectBranch({ sprints: heldLists(), folders: heldFolders() }, { privileged: true });

beforeEach(() => {
    vi.useFakeTimers();
    resetProjectTreeCache();
    apiRequest.mockReset();
    server = { 'p1:sprints': [sprint()], 'p1:folders': [folder()] };
    apiRequest.mockImplementation((type, url) => {
        const [, projectId, collection] = /sprintFolder\/([^?]+)\?collection=(\w+)/.exec(url);
        const answer = server[`${projectId}:${collection}`];
        return typeof answer === 'number' ? refused(answer) : Promise.resolve({ data: answer });
    });
    socket = fakeSocket();
    socketRef = ref(socket);
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('a list changed elsewhere in the open project', () => {
    it('is read through the project\'s list route, in the background, and never taken from the signal', async () => {
        mountHost();
        server['p1:sprints'] = [sprint({ name: 'Backlog, renamed' })];
        socket.fire(LIST_CHANGED_EVENT, { kind: 'changed', companyId: COMPANY, projectId: 'p1', sprintId: 's1', name: 'From the signal' });
        expect(apiRequest).not.toHaveBeenCalled();
        await gathered();
        expect(apiRequest).toHaveBeenCalledWith('get', READ('p1', 'sprints'), undefined, undefined, { background: true });
        expect(namesOf(heldLists())).toEqual(['Backlog, renamed']);
    });

    it('made elsewhere is added', async () => {
        mountHost();
        server['p1:sprints'] = [sprint(), sprint({ _id: 's2', name: 'Sprint 12' })];
        listChanged('p1', 's2', 'added');
        await gathered();
        expect(namesOf(heldLists())).toEqual(['Backlog', 'Sprint 12']);
        expect(heldLists()[1].id).toBe('s2');
    });

    it('renamed elsewhere shows its new name in the tree', async () => {
        mountHost();
        server['p1:sprints'] = [sprint({ name: 'Icebox' })];
        listChanged('p1');
        await gathered();
        expect(namesOf(branch().sprints)).toEqual(['Icebox']);
    });

    it('moved into a folder sits under it, and the tasks already loaded follow', async () => {
        const task = { _id: 't1', sprintId: 's1', sprintArray: { id: 's1', name: 'Backlog' }, subtaskArray: [{ _id: 't2', sprintArray: {} }] };
        mountHost({ tasks: { p1: { s1: { tasks: [task] } } } });
        server['p1:sprints'] = [sprint({ folderId: 'f1', folderName: 'Design' })];
        listChanged('p1');
        await gathered();
        expect(branch().sprints).toEqual([]);
        expect(namesOf(branch().folders[0].sprints)).toEqual(['Backlog']);
        const moved = store.state.projectData.tasks.p1.s1.tasks[0];
        expect(moved.folderObjId).toBe('f1');
        expect(moved.sprintArray).toMatchObject({ folderId: 'f1', folderName: 'Design' });
        expect(moved.subtaskArray[0].folderObjId).toBe('f1');
    });

    it('made a sprint with dates carries them for the list menu and its settings', async () => {
        mountHost();
        server['p1:sprints'] = [sprint({ isScrum: true, state: 'planned', startDate: '2026-10-05T00:00:00.000Z', endDate: '2026-10-16T23:59:59.999Z' })];
        listChanged('p1');
        await gathered();
        expect(heldLists()[0]).toMatchObject({ isScrum: true, state: 'planned', startDate: '2026-10-05T00:00:00.000Z', endDate: '2026-10-16T23:59:59.999Z' });
    });

    it('archived elsewhere leaves the live tree', async () => {
        mountHost();
        server['p1:sprints'] = [sprint({ deletedStatusKey: 2 })];
        listChanged('p1');
        await gathered();
        expect(heldLists()[0].deletedStatusKey).toBe(2);
        expect(branch().sprints).toEqual([]);
    });

    it('that the route no longer answers, in the trash or shared away from this person, is dropped', async () => {
        mountHost({ sprints: { p1: [sprint(), sprint({ _id: 's2', name: 'Redundancy plan' })] } });
        listChanged('p1', 's2', 'removed');
        await gathered();
        expect(namesOf(heldLists())).toEqual(['Backlog']);
    });
});

describe('a folder changed elsewhere in the open project', () => {
    it('made, renamed or removed elsewhere is read through the project\'s folder route', async () => {
        mountHost();
        server['p1:folders'] = [folder({ name: 'Design system' }), folder({ _id: 'f2', name: 'Legal', parentFolderId: undefined })];
        folderChanged('p1', 'f2', 'added');
        await gathered();
        expect(reads()).toEqual([READ('p1', 'folders')]);
        expect(heldFolders()).toEqual([folder({ name: 'Design system' }), folder({ _id: 'f2', name: 'Legal', parentFolderId: null })]);

        server['p1:folders'] = [];
        folderChanged('p1', 'f1', 'removed');
        await gathered(READ_GAP_MS);
        expect(heldFolders()).toEqual([]);
    });
});

describe('a project the sidebar tree holds and the page does not', () => {
    it('has the tree\'s own copy read again, and is not put in the store', async () => {
        mountHost();
        treeCache.p2 = { sprints: [sprint({ _id: 's9', projectId: 'p2' })], folders: [], loaded: true, loading: null };
        server['p2:sprints'] = [sprint({ _id: 's9', projectId: 'p2', name: 'Roadmap' })];
        server['p2:folders'] = [folder({ _id: 'f9', projectId: 'p2' })];
        listChanged('p2', 's9');
        folderChanged('p2', 'f9', 'added');
        await gathered();
        expect(namesOf(treeCache.p2.sprints)).toEqual(['Roadmap']);
        expect(namesOf(treeCache.p2.folders)).toEqual(['Design']);
        expect(Object.keys(store.state.projectData.sprints)).toEqual(['p1']);
        expect(Object.keys(store.state.projectData.folders)).toEqual(['p1']);
    });

    it('is left alone when nothing here shows its lists', async () => {
        mountHost();
        listChanged('p3', 's3', 'added');
        folderChanged('p3', 'f3', 'added');
        await gathered();
        expect(reads()).toEqual([]);
    });
});

describe('a burst of changes', () => {
    it('costs one read of the lists and one of the folders for each project', async () => {
        mountHost();
        ['s1', 's2', 's1'].forEach((id) => listChanged('p1', id));
        folderChanged('p1');
        folderChanged('p1', 'f2', 'added');
        await gathered();
        expect(reads().sort()).toEqual([READ('p1', 'folders'), READ('p1', 'sprints')]);
    });

    it('reads a project that keeps changing every few seconds at most, and never misses its last change', async () => {
        mountHost();
        listChanged('p1');
        await gathered();
        server['p1:sprints'] = [sprint({ name: 'Second' })];
        listChanged('p1');
        await gathered();
        expect(reads()).toHaveLength(1);
        server['p1:sprints'] = [sprint({ name: 'Last' })];
        listChanged('p1');
        await gathered(READ_GAP_MS);
        expect(reads()).toHaveLength(2);
        expect(namesOf(heldLists())).toEqual(['Last']);
    });
});

describe('signals that are not for this page', () => {
    it('another company\'s, and one that names no project, list or folder, are ignored', async () => {
        mountHost();
        listChanged('p1', 's1', 'changed', 'c2');
        folderChanged('p1', 'f1', 'changed', 'c2');
        socket.fire(LIST_CHANGED_EVENT, { kind: 'changed', companyId: COMPANY, sprintId: 's1' });
        socket.fire(LIST_CHANGED_EVENT, { kind: 'changed', companyId: COMPANY, projectId: 'p1' });
        socket.fire(FOLDERS_CHANGED_EVENT, { type: 'update' });
        socket.fire(LIST_CHANGED_EVENT, undefined);
        await gathered();
        expect(reads()).toEqual([]);
    });

    it.each([403, 404, 500])('a read that answers %s leaves what is shown as it was', async (status) => {
        mountHost();
        server['p1:sprints'] = status;
        listChanged('p1');
        await gathered();
        expect(namesOf(heldLists())).toEqual(['Backlog']);
    });

    it('an answer that is not a list of rows leaves what is shown as it was', async () => {
        mountHost();
        server['p1:sprints'] = { message: 'Invalid type' };
        listChanged('p1');
        await gathered();
        expect(namesOf(heldLists())).toEqual(['Backlog']);
    });

    it('a read that lands after the company was switched is thrown away', async () => {
        mountHost();
        let land;
        apiRequest.mockImplementation(() => new Promise((resolve) => { land = resolve; }));
        listChanged('p1');
        await gathered();
        await wrapper.setProps({ companyId: 'c2' });
        land({ data: [sprint({ name: 'From the other company' })] });
        await flushPromises();
        expect(namesOf(heldLists())).toEqual(['Backlog']);
    });

    it('waits while the page is out of sight and reads once it is seen again', async () => {
        mountHost();
        server['p1:sprints'] = [sprint({ name: 'Seen later' })];
        const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        listChanged('p1');
        await gathered();
        expect(reads()).toEqual([]);
        visibility.mockReturnValue(false);
        document.dispatchEvent(new Event('visibilitychange'));
        await gathered();
        expect(namesOf(heldLists())).toEqual(['Seen later']);
        visibility.mockRestore();
    });
});

describe('the socket', () => {
    it('is followed when it connects late, and let go when the page closes', async () => {
        socketRef = ref(null);
        mountHost();
        expect(socket.bound()).toEqual([]);
        socketRef.value = socket;
        await flushPromises();
        expect(socket.bound()).toEqual([FOLDERS_CHANGED_EVENT, LIST_CHANGED_EVENT].sort());
        wrapper.unmount();
        wrapper = null;
        expect(socket.bound()).toEqual([]);
    });

    it('is bound by the shell alone, which hands over the socket and the company', () => {
        expect(APP).toMatch(/useLiveLists\(socket, companyId\)/);
        expect(TREE).not.toMatch(/foldersChanged|FOLDERS_CHANGED_EVENT/);
    });
});
