/* Task 047: a project made or changed elsewhere reaches the store the sidebar, Home and the project page read,
   without a reload. The signal names the project; what it holds is read through the guarded route. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createStore, useStore } from 'vuex';
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
import ProjectHeader from '@/views/Projects/components/ProjectHeader.vue';
import { GATHER_MS, GATHER_MAX_MS, PROJECT_CHANGED_EVENT, READ_GAP_MS, useLiveProjects } from '@/views/Projects/liveProjects';

const APP = fs.readFileSync(path.resolve(__dirname, '../../src/App.vue'), 'utf8');
const COMPANY = 'c1';
const READ = (id) => `/api/v1/project/${id}`;
const list = { 's1': { _id: 's1', id: 's1', name: 'Backlog', createdAt: { seconds: 5 } } };
const folders = { 'f1': { _id: 'f1', folderId: 'f1', name: 'Design', sprintsObj: {} } };
const alpha = () => ({ _id: 'p1', id: 'p1', ProjectName: 'Alpha', statusType: 'active', isPrivateSpace: false, AssigneeUserId: [], isExpanded: true, sprintsObj: { ...list }, sprintsfolders: { ...folders } });
const row = (over = {}) => ({ _id: 'p1', ProjectName: 'Alpha', statusType: 'active', isPrivateSpace: false, AssigneeUserId: [], sprintsObj: {}, sprintsfolders: {}, ...over });
const answered = (data) => Promise.resolve({ data });
const refused = (status) => Promise.reject(Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false } } }));

const fakeSocket = () => {
    const handlers = {};
    return {
        on: (event, handler) => { handlers[event] = handler; },
        off: (event, handler) => { if (handlers[event] === handler) delete handlers[event]; },
        fire: (payload) => handlers[PROJECT_CHANGED_EVENT]?.(payload),
        bound: () => Boolean(handlers[PROJECT_CHANGED_EVENT])
    };
};

let store;
let socket;
let socketRef;
let wrapper;
let server;

const newStore = (held) => createStore({
    modules: {
        projectData: { namespaced: true, state: () => ({ allProjects: held, sprints: {}, folders: {} }), getters: projectData.getters, mutations }
    }
});

const Host = defineComponent({
    props: { companyId: String },
    setup(props) {
        useLiveProjects(socketRef, computed(() => props.companyId));
        return () => h('div');
    }
});

const mountHost = (held = { data: [alpha()], privateSnap: null, publicSnap: null }) => {
    store = newStore(held);
    wrapper = mount(Host, { props: { companyId: COMPANY }, global: { plugins: [store] } });
};

const changed = (projectId, kind = 'changed', companyId = COMPANY) => socket.fire({ kind, companyId, projectId });
const gathered = async (ms = GATHER_MS) => { await vi.advanceTimersByTimeAsync(ms); await flushPromises(); };
const afterTheGap = () => gathered(READ_GAP_MS);
const reads = () => apiRequest.mock.calls.filter(([type]) => type === 'get').map(([, url]) => url);
const stored = (id) => store.state.projectData.allProjects.data?.find((project) => project._id === id);
const shown = () => store.getters['projectData/projects'].data.map((project) => project._id);

beforeEach(() => {
    vi.useFakeTimers();
    apiRequest.mockReset();
    server = {};
    apiRequest.mockImplementation((type, url) => {
        const id = url.split('/').pop();
        return typeof server[id] === 'number' ? refused(server[id]) : answered(server[id]);
    });
    socket = fakeSocket();
    socketRef = ref(socket);
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('a project made elsewhere', () => {
    it('is read through the project route and put in the store', async () => {
        mountHost();
        server.p2 = row({ _id: 'p2', ProjectName: 'Beta' });
        changed('p2', 'added');
        expect(apiRequest).not.toHaveBeenCalled();
        await gathered();
        expect(apiRequest).toHaveBeenCalledWith('get', READ('p2'), undefined, undefined, { background: true });
        expect(shown()).toEqual(['p1', 'p2']);
        expect(stored('p2')).toMatchObject({ ProjectName: 'Beta', id: 'p2', isExpanded: false });
    });

    it('is the first project of a workspace that had none', async () => {
        mountHost([]);
        server.p2 = row({ _id: 'p2', ProjectName: 'Beta' });
        changed('p2', 'added');
        await gathered();
        expect(shown()).toEqual(['p2']);
    });

    it('is not shown when the signal is all that arrived', async () => {
        mountHost();
        server.p2 = 404;
        changed('p2', 'added');
        await gathered();
        expect(shown()).toEqual(['p1']);
    });
});

describe('a project changed elsewhere', () => {
    it('takes what the server holds now and lets go of what it no longer holds', async () => {
        mountHost();
        store.state.projectData.allProjects.data[0].agentLimits = { paused: true };
        server.p1 = row({ ProjectName: 'Alpha, renamed' });
        changed('p1');
        await gathered();
        expect(stored('p1').ProjectName).toBe('Alpha, renamed');
        expect(stored('p1').agentLimits).toBeUndefined();
    });

    it('keeps the lists and folders the tree folded into it, and whether it is open in the sidebar', async () => {
        mountHost();
        server.p1 = row({ ProjectName: 'Alpha, renamed' });
        changed('p1');
        await gathered();
        expect(stored('p1').sprintsObj).toEqual(list);
        expect(stored('p1').sprintsfolders).toEqual(folders);
        expect(stored('p1').isExpanded).toBe(true);
    });

    it('stays for a member whose team is on a private project, since the server answered the read', async () => {
        mountHost();
        server.p1 = row({ isPrivateSpace: true, AssigneeUserId: ['tId_team-1'] });
        changed('p1');
        await gathered();
        expect(stored('p1').isPrivateSpace).toBe(true);
    });

    it('leaves the active projects when it was closed', async () => {
        mountHost();
        server.p1 = row({ statusType: 'close' });
        changed('p1');
        await gathered();
        expect(shown()).toEqual([]);
        expect(store.getters['projectData/closeProject'].data.map((project) => project._id)).toEqual(['p1']);
    });
});

describe('a project that is gone', () => {
    it('is dropped on the word of the signal, without a read', async () => {
        mountHost();
        changed('p1', 'removed');
        await gathered();
        expect(reads()).toEqual([]);
        expect(stored('p1')).toBeUndefined();
    });

    it.each([404, 403])('is dropped when the read answers %s', async (status) => {
        mountHost();
        server.p1 = status;
        changed('p1');
        await gathered();
        expect(stored('p1')).toBeUndefined();
    });

    it('is dropped when the read answers a project in the trash', async () => {
        mountHost();
        server.p1 = row({ deletedStatusKey: 1 });
        changed('p1');
        await gathered();
        expect(stored('p1')).toBeUndefined();
    });

    it('comes back when it is restored', async () => {
        mountHost();
        changed('p1', 'removed');
        await gathered();
        server.p1 = row({ deletedStatusKey: 0 });
        changed('p1');
        await gathered();
        expect(shown()).toEqual(['p1']);
    });

    it('stays when the read fails for any other reason', async () => {
        mountHost();
        server.p1 = 500;
        changed('p1');
        await gathered();
        apiRequest.mockImplementation(() => Promise.reject(new Error('Network Error')));
        changed('p1');
        await afterTheGap();
        expect(reads()).toHaveLength(2);
        expect(stored('p1').ProjectName).toBe('Alpha');
    });
});

describe('a burst of changes', () => {
    it('costs one read for each project', async () => {
        mountHost();
        server.p1 = row();
        server.p2 = row({ _id: 'p2' });
        ['p1', 'p1', 'p2', 'p1', 'p2'].forEach((id) => changed(id));
        await gathered();
        expect(reads().sort()).toEqual([READ('p1'), READ('p2')]);
    });

    it('acts on the last word about a project', async () => {
        mountHost();
        server.p1 = row({ ProjectName: 'Restored' });
        changed('p1', 'removed');
        changed('p1', 'changed');
        await gathered();
        expect(stored('p1').ProjectName).toBe('Restored');
    });

    it('reads a project that keeps changing every few seconds at most, and never misses its last change', async () => {
        mountHost();
        server.p1 = row({ ProjectName: 'First' });
        changed('p1');
        await gathered();
        expect(reads()).toHaveLength(1);
        server.p1 = row({ ProjectName: 'Second' });
        changed('p1');
        await gathered();
        expect(reads()).toHaveLength(1);
        server.p1 = row({ ProjectName: 'Last' });
        changed('p1');
        await afterTheGap();
        expect(reads()).toHaveLength(2);
        expect(stored('p1').ProjectName).toBe('Last');
    });

    it('does not wait for ever while changes keep arriving', async () => {
        mountHost();
        server.p1 = row();
        for (let waited = 0; waited < GATHER_MAX_MS + GATHER_MS; waited += GATHER_MS / 2) {
            changed('p1');
            // eslint-disable-next-line no-await-in-loop
            await vi.advanceTimersByTimeAsync(GATHER_MS / 2);
        }
        expect(reads().length).toBeGreaterThan(0);
    });
});

describe('signals that are not for this page', () => {
    it('another company\'s, and one that names no project, are ignored', async () => {
        mountHost();
        server.p1 = row({ ProjectName: 'Never read' });
        changed('p1', 'changed', 'c2');
        socket.fire({ kind: 'changed', companyId: COMPANY });
        socket.fire(undefined);
        await gathered();
        expect(reads()).toEqual([]);
    });

    it('a read that lands after the company was switched is thrown away', async () => {
        mountHost();
        let land;
        apiRequest.mockImplementation(() => new Promise((resolve) => { land = resolve; }));
        changed('p1');
        await gathered();
        await wrapper.setProps({ companyId: 'c2' });
        land({ data: row({ ProjectName: 'From the other company' }) });
        await flushPromises();
        expect(stored('p1').ProjectName).toBe('Alpha');
    });

    it('waits while the page is out of sight and reads once it is seen again', async () => {
        mountHost();
        server.p1 = row({ ProjectName: 'Seen later' });
        const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        changed('p1');
        await gathered();
        expect(reads()).toEqual([]);
        visibility.mockReturnValue(false);
        document.dispatchEvent(new Event('visibilitychange'));
        await gathered();
        expect(stored('p1').ProjectName).toBe('Seen later');
        visibility.mockRestore();
    });
});

describe('the socket', () => {
    it('is followed when it connects late, and let go when the page closes', async () => {
        socketRef = ref(null);
        mountHost();
        expect(socket.bound()).toBe(false);
        socketRef.value = socket;
        await flushPromises();
        expect(socket.bound()).toBe(true);
        wrapper.unmount();
        wrapper = null;
        expect(socket.bound()).toBe(false);
    });

    it('is bound by the shell, which hands over the socket and the company', () => {
        expect(APP).toMatch(/useLiveProjects\(socket, companyId\)/);
    });
});

describe('the Agents paused chip of an open project', () => {
    const blank = { render: () => null };
    const Page = defineComponent({
        setup() {
            useLiveProjects(socketRef, ref(COMPANY));
            const { getters } = useStore();
            const project = computed(() => getters['projectData/projects'].data.find((item) => item._id === 'p1'));
            return () => h(ProjectHeader, { project: project.value, projects: [project.value], sprint: null, agentsPaused: project.value?.agentLimits?.paused === true });
        }
    });

    it('appears when another person pauses the project\'s agents and goes when they resume', async () => {
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:cid/project/:id/p', name: 'Project', component: blank }] });
        await router.push({ name: 'Project', params: { cid: COMPANY, id: 'p1' } });
        await router.isReady();
        store = newStore({ data: [alpha()], privateSnap: null, publicSnap: null });
        wrapper = mount(Page, { global: { plugins: [router, store], mocks: { $t: (key) => key } } });
        await flushPromises();
        const chip = () => wrapper.find('[data-test="agents-paused"]');
        expect(chip().exists()).toBe(false);

        server.p1 = row({ agentLimits: { paused: true } });
        changed('p1');
        await gathered();
        expect(chip().exists()).toBe(true);

        server.p1 = row({ agentLimits: { paused: false } });
        changed('p1');
        await afterTheGap();
        expect(chip().exists()).toBe(false);
    });
});
