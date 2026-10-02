/* Hand check, build 772: the header chip "Agents paused" came only after a reload and stayed after "Resume
   agents". The project list is read once at start and no project event reaches a browser, so the chip follows
   the save in this browser, and the agents signal in every other one. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import ProjectAgentLimitsCard from '@/views/Projects/ProjectDetail/ProjectAgentLimitsCard.vue';
import { agentsPausedIn, forgetAgentPauses, useAgentPause } from '@/views/Projects/composables/agentPause';

const PROJECTS = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/Projects.vue'), 'utf8');
const urlOf = (projectId) => `/api/v2/agents/project-limits/${projectId}`;
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const answer = (limits = {}) => ({ limits: { atOnce: 3, paused: false, ...limits }, defaults: { atOnce: 3, paused: false }, atOnceRange: { min: 1, max: 20 }, canEdit: true });

const liveSocket = () => {
    const handlers = new Map();
    return {
        on: vi.fn((event, handler) => handlers.set(event, handler)),
        off: vi.fn((event, handler) => { if (handlers.get(event) === handler) handlers.delete(event); }),
        tell: (event, payload) => handlers.get(event)?.(payload),
        listens: (event) => handlers.has(event),
    };
};

const serve = (held) => apiRequest.mockImplementation((type, url, body) => {
    const projectId = url.split('/').pop();
    if (type === 'put') Object.assign(held[projectId], body);
    return ok(answer(held[projectId]));
});
const readsOf = (projectId) => apiRequest.mock.calls.filter(([type, url]) => type === 'get' && url === urlOf(projectId)).length;

const mountCard = async (socket) => {
    const wrapper = mount(ProjectAgentLimitsCard, { props: { projectId: 'p1' }, global: { provide: { $socket: ref(socket || liveSocket()) } } });
    await flushPromises();
    return wrapper;
};

const mountHeader = (project, socket) => mount(defineComponent({
    setup() {
        const { agentsPaused } = useAgentPause(project, socket);
        return () => h('i', { 'data-paused': String(agentsPaused.value) });
    },
}));
const shown = (wrapper) => wrapper.attributes('data-paused');

beforeEach(() => {
    apiRequest.mockReset();
    forgetAgentPauses();
});

describe('in the browser that saved', () => {
    it('the pause is known the moment the card saves it, and gone the moment agents are resumed', async () => {
        const held = { p1: { paused: false } };
        serve(held);
        const asLoaded = { _id: 'p1', agentLimits: { atOnce: 3, paused: false } };
        const header = mountHeader(ref(asLoaded), ref(liveSocket()));
        const card = await mountCard();
        expect(shown(header)).toBe('false');

        await card.find('[data-test="pause"]').trigger('click');
        await flushPromises();
        expect(agentsPausedIn(asLoaded)).toBe(true);
        expect(shown(header)).toBe('true');

        await card.find('[data-test="resume"]').trigger('click');
        await flushPromises();
        expect(agentsPausedIn({ _id: 'p1', agentLimits: { paused: true } })).toBe(false);
        expect(shown(header)).toBe('false');
    });

    it('a save that is refused changes nothing', async () => {
        apiRequest.mockImplementation((type) => (type === 'get' ? ok(answer()) : Promise.reject(Object.assign(new Error('no'), { response: { data: { statusText: 'Owner/admin only.' } } }))));
        const card = await mountCard();
        await card.find('[data-test="pause"]').trigger('click');
        await flushPromises();
        expect(agentsPausedIn({ _id: 'p1', agentLimits: { paused: false } })).toBe(false);
    });

    it('a project nobody changed says what it was loaded with', () => {
        expect(agentsPausedIn({ _id: 'p2', agentLimits: { paused: true } })).toBe(true);
        expect(agentsPausedIn({ _id: 'p3' })).toBe(false);
        expect(agentsPausedIn(null)).toBe(false);
    });
});

describe('in every other open browser', () => {
    it('the header reads the open project again when the agents signal says limits changed, and only then', async () => {
        const held = { p1: { paused: true } };
        serve(held);
        const socket = liveSocket();
        const header = mountHeader(ref({ _id: 'p1', agentLimits: { paused: false } }), ref(socket));
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();

        socket.tell('agentsChanged', { kind: 'run' });
        socket.tell('agentsChanged', { kind: 'claim' });
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();

        socket.tell('agentsChanged', { kind: 'limits' });
        await flushPromises();
        expect(readsOf('p1')).toBe(1);
        expect(shown(header)).toBe('true');

        held.p1.paused = false;
        socket.tell('agentsChanged', { kind: 'limits' });
        await flushPromises();
        expect(shown(header)).toBe('false');
    });

    it('a project opened after such a signal is read once, since the signal names no project', async () => {
        const held = { p1: { paused: false }, p2: { paused: true } };
        serve(held);
        const socket = liveSocket();
        const project = ref({ _id: 'p1', agentLimits: { paused: false } });
        const header = mountHeader(project, ref(socket));
        socket.tell('agentsChanged', { kind: 'limits' });
        await flushPromises();

        project.value = { _id: 'p2', agentLimits: { paused: false } };
        await nextTick();
        await flushPromises();
        expect(readsOf('p2')).toBe(1);
        expect(shown(header)).toBe('true');

        project.value = { _id: 'p1', agentLimits: { paused: false } };
        await nextTick();
        await flushPromises();
        project.value = { _id: 'p2', agentLimits: { paused: false } };
        await nextTick();
        await flushPromises();
        expect(readsOf('p1')).toBe(1);
        expect(readsOf('p2')).toBe(1);
    });

    it('believes the latest read when a pause and a resume follow each other and the first answer lands last', async () => {
        const landings = [];
        apiRequest.mockImplementation(() => new Promise((resolve) => { landings.push(resolve); }));
        const socket = liveSocket();
        const header = mountHeader(ref({ _id: 'p1', agentLimits: { paused: false } }), ref(socket));
        socket.tell('agentsChanged', { kind: 'limits' });
        socket.tell('agentsChanged', { kind: 'limits' });
        landings[1]({ data: { status: true, data: answer({ paused: false }) } });
        landings[0]({ data: { status: true, data: answer({ paused: true }) } });
        await flushPromises();
        expect(shown(header)).toBe('false');
    });

    it('keeps what it shows when the read fails, and stops listening when the page closes', async () => {
        apiRequest.mockImplementation(() => Promise.reject(new Error('offline')));
        const socket = liveSocket();
        const header = mountHeader(ref({ _id: 'p1', agentLimits: { paused: true } }), ref(socket));
        socket.tell('agentsChanged', { kind: 'limits' });
        await flushPromises();
        expect(shown(header)).toBe('true');
        header.unmount();
        expect(socket.listens('agentsChanged')).toBe(false);
    });

    it('the card follows too: it shows Resume after someone else paused', async () => {
        const held = { p1: { paused: false } };
        serve(held);
        const socket = liveSocket();
        const card = await mountCard(socket);
        expect(card.find('[data-test="pause"]').exists()).toBe(true);

        held.p1.paused = true;
        socket.tell('agentsChanged', { kind: 'limits' });
        await flushPromises();
        expect(card.find('[data-test="resume"]').exists()).toBe(true);
        expect(card.find('[data-test="paused-note"]').exists()).toBe(true);
    });
});

describe('the project page', () => {
    it('hands the header the live state, not only what the project was loaded with', () => {
        expect(PROJECTS).toMatch(/:agentsPaused="agentsPaused"/);
        expect(PROJECTS).toMatch(/const \{ agentsPaused \} = useAgentPause\(projectData, socket\)/);
        expect(PROJECTS).not.toMatch(/:agentsPaused="projectData\?\.agentLimits/);
    });
});
