/* Hand check, build 772: the header chip "Agents paused" came only after a reload and stayed after "Resume
   agents". One thing carries the pause now: the stored project. The card writes what it saved there at once,
   and `projectChanged` brings it to every other browser that may open the project. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore, useStore } from 'vuex';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => 0 }) }));

import ProjectAgentLimitsCard from '@/views/Projects/ProjectDetail/ProjectAgentLimitsCard.vue';
import * as mutations from '@/store/ProjectData/mutations';
import { GATHER_MS, PROJECT_CHANGED_EVENT, READ_GAP_MS, useLiveProjects } from '@/views/Projects/liveProjects';

const read = (file) => fs.readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');
const PROJECTS = read('views/Projects/Projects.vue');
const CARD = read('views/Projects/ProjectDetail/ProjectAgentLimitsCard.vue');
const FEED = read('views/Ai/agentFeed.js');
const COMPANY = 'c1';
const LIMITS = '/api/v2/agents/project-limits/p1';
const PROJECT = '/api/v1/project/p1';
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const answer = (limits) => ({ limits, defaults: { atOnce: 3, paused: false, directTasks: 10 }, atOnceRange: { min: 1, max: 20 }, directTasksRange: { min: 1, max: 100 }, directTasksMinutes: 10, canEdit: true });

const liveSocket = () => {
    const handlers = new Map();
    return {
        on: vi.fn((event, handler) => handlers.set(event, handler)),
        off: vi.fn((event, handler) => { if (handlers.get(event) === handler) handlers.delete(event); }),
        tell: (payload) => handlers.get(PROJECT_CHANGED_EVENT)?.(payload),
        hears: (event) => handlers.has(event),
    };
};

/* The server of one project: the limits route answers and saves its limits, the project route its row. */
let held;
let refuseSaves;
const serve = () => apiRequest.mockImplementation((type, url, body) => {
    if (url === PROJECT) return Promise.resolve({ data: { _id: 'p1', ProjectName: 'Alpha', statusType: 'active', agentLimits: { ...held, updatedBy: 'u1' } } });
    if (type === 'put' && refuseSaves) return Promise.reject(Object.assign(new Error('no'), { response: { data: { statusText: 'Owner/admin only.' } } }));
    if (type === 'put') Object.assign(held, body);
    return ok(answer({ ...held }));
});
const asked = (type, url) => apiRequest.mock.calls.filter(([calledType, calledUrl]) => calledType === type && calledUrl === url).length;

let socket;
let wrapper;

/* One browser: the shell that follows `projectChanged`, the header chip as the project page computes it, and the card when it is open. */
const openBrowser = async ({ card = true } = {}) => {
    const store = createStore({
        modules: {
            projectData: {
                namespaced: true,
                state: () => ({ allProjects: { data: [{ _id: 'p1', id: 'p1', ProjectName: 'Alpha', statusType: 'active', agentLimits: { atOnce: 3, paused: false, directTasks: 10 } }] } }),
                getters: { allProjects: (state) => state.allProjects },
                mutations,
            },
        },
    });
    socket = liveSocket();
    const Page = defineComponent({
        setup() {
            useLiveProjects(ref(socket), ref(COMPANY));
            const { getters } = useStore();
            const projectData = computed(() => getters['projectData/allProjects'].data.find((project) => project._id === 'p1'));
            return () => h('div', [
                h('i', { 'data-test': 'chip', 'data-paused': String(projectData.value?.agentLimits?.paused === true) }),
                card ? h(ProjectAgentLimitsCard, { projectId: 'p1' }) : null,
            ]);
        },
    });
    wrapper = mount(Page, { global: { plugins: [store], mocks: { $t: (key) => key } } });
    await flushPromises();
    return wrapper;
};
const chip = () => wrapper.find('[data-test="chip"]').attributes('data-paused');
const someoneSaved = async (limits) => {
    Object.assign(held, limits);
    socket.tell({ kind: 'changed', companyId: COMPANY, projectId: 'p1' });
    await vi.advanceTimersByTimeAsync(Math.max(GATHER_MS, READ_GAP_MS));
    await flushPromises();
};

beforeEach(() => {
    vi.useFakeTimers();
    apiRequest.mockReset();
    held = { atOnce: 3, paused: false, directTasks: 10 };
    refuseSaves = false;
    serve();
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('in the browser that saved', () => {
    it('the chip shows the pause the moment the card saves it, and goes the moment agents are resumed', async () => {
        await openBrowser();
        expect(chip()).toBe('false');

        await wrapper.find('[data-test="pause"]').trigger('click');
        await flushPromises();
        expect(chip()).toBe('true');
        expect(asked('get', PROJECT)).toBe(0);

        await wrapper.find('[data-test="resume"]').trigger('click');
        await flushPromises();
        expect(chip()).toBe('false');
    });

    it('one save costs one read when its own change comes back: the project, and not the limits again', async () => {
        await openBrowser();
        await wrapper.find('[data-test="pause"]').trigger('click');
        await flushPromises();
        const limitsReads = asked('get', LIMITS);

        await someoneSaved({});
        expect(asked('get', PROJECT)).toBe(1);
        expect(asked('get', LIMITS)).toBe(limitsReads);
        expect(asked('put', LIMITS)).toBe(1);
        expect(chip()).toBe('true');
    });

    it('a save that is refused changes nothing', async () => {
        refuseSaves = true;
        await openBrowser();
        await wrapper.find('[data-test="pause"]').trigger('click');
        await flushPromises();
        expect(chip()).toBe('false');
    });
});

describe('in every other browser that may open the project', () => {
    it('the chip follows a pause and a resume made elsewhere, for one read of the project each', async () => {
        await openBrowser({ card: false });
        await someoneSaved({ paused: true });
        expect(chip()).toBe('true');
        expect(asked('get', PROJECT)).toBe(1);
        expect(asked('get', LIMITS)).toBe(0);

        await someoneSaved({ paused: false });
        expect(chip()).toBe('false');
        expect(asked('get', PROJECT)).toBe(2);
    });

    it('the open card follows too: it shows Resume after someone else paused, for one read of the limits', async () => {
        await openBrowser();
        expect(wrapper.find('[data-test="pause"]').exists()).toBe(true);
        const before = asked('get', LIMITS);

        await someoneSaved({ paused: true });
        expect(wrapper.find('[data-test="resume"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="paused-note"]').exists()).toBe(true);
        expect(asked('get', LIMITS)).toBe(before + 1);
    });

    it('a change to the project that leaves its limits alone costs the card nothing', async () => {
        await openBrowser();
        const before = asked('get', LIMITS);
        await someoneSaved({});
        expect(asked('get', PROJECT)).toBe(1);
        expect(asked('get', LIMITS)).toBe(before);
    });

    it('a pause and a resume close together cost one read and show how it ended', async () => {
        await openBrowser({ card: false });
        socket.tell({ kind: 'changed', companyId: COMPANY, projectId: 'p1' });
        await someoneSaved({ paused: false });
        expect(asked('get', PROJECT)).toBe(1);
        expect(chip()).toBe('false');
    });

    it('stops listening when the page closes', async () => {
        await openBrowser();
        expect(socket.hears(PROJECT_CHANGED_EVENT)).toBe(true);
        wrapper.unmount();
        wrapper = null;
        expect(socket.hears(PROJECT_CHANGED_EVENT)).toBe(false);
    });
});

describe('one mechanism', () => {
    it('the project page hands the header what the stored project says', () => {
        expect(PROJECTS).toMatch(/:agentsPaused="projectData\?\.agentLimits\?\.paused === true"/);
        expect(PROJECTS).not.toMatch(/useAgentPause/);
    });

    it('the card listens to no signal of its own, and the agents signal has no kind for limits', () => {
        expect(CARD).not.toMatch(/\$socket|agentsChanged|AGENTS_CHANGED_EVENT/);
        expect(CARD).toMatch(/useStoredProjectPart\(\(\) => props\.projectId, "agentLimits", saved, follow\)/);
        expect(FEED).not.toMatch(/LIMITS_CHANGE/);
        expect(fs.existsSync(path.resolve(__dirname, '../../src/views/Projects/composables/agentPause.js'))).toBe(false);
    });
});
