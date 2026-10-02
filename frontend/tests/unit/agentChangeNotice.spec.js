import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, ref } from 'vue';

const { apiRequest, toast, push } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, push: vi.fn(() => Promise.resolve()) }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

import UndoToast from '@/components/molecules/UndoToast/UndoToast.vue';
import { dismissUndoToast, showUndoToast } from '@/composable/useUndoToast';
import { GATHER_MS, GATHER_MAX_MS, useAgentChangeNotice } from '@/views/Ai/agentChangeNotice';
import en from '@/locales/en';

const COMPANY = 'c1';
const CHANGES = '/api/v2/agents/changes';
const UNDO = (id) => `/api/v1/audit-logs/${id}/undo`;

const change = (auditId, over = {}) => ({ auditId, agentName: 'Claude', action: 'task.comment', label: 'Comment on a task', taskId: 't1', name: 'Fix login', undoable: true, parts: [], ...over });
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refusedWith = (statusText) => Promise.reject(Object.assign(new Error('Request failed with status code 410'), { response: { status: 410, data: { status: false, statusText } } }));

const fakeSocket = () => {
    const handlers = {};
    return {
        on: (event, handler) => { handlers[event] = handler; },
        off: (event) => { delete handlers[event]; },
        fire: (payload) => handlers.agentsChanged?.(payload),
        bound: () => Boolean(handlers.agentsChanged)
    };
};

let wrapper;
let socket;
let world;

const Host = defineComponent({
    props: { socket: Object, companyId: String },
    setup(props) {
        useAgentChangeNotice(ref(props.socket), ref(props.companyId));
        return () => h(UndoToast);
    }
});

const mountHost = () => {
    const words = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    wrapper = mount(Host, { props: { socket, companyId: COMPANY }, attachTo: document.body, global: { plugins: [words], mocks: { $t: words.global.t } } });
};

const applied = (auditId, companyId = COMPANY) => socket.fire({ kind: 'change', companyId, auditId });
const gathered = async () => { await vi.advanceTimersByTimeAsync(GATHER_MS); await flushPromises(); };
const reads = () => apiRequest.mock.calls.filter(([type, url]) => type === 'get' && url.startsWith(CHANGES)).map(([, url]) => decodeURIComponent(url.split('ids=')[1]).split(','));
const notice = () => wrapper.find('.ah-undo-toast');
const undoButton = () => wrapper.find('[data-test="undo-toast-undo"]');
const showButton = () => wrapper.find('[data-test="undo-toast-action"]');

beforeEach(() => {
    vi.useFakeTimers();
    [apiRequest, toast.success, toast.error, push].forEach((mock) => mock.mockClear());
    socket = fakeSocket();
    world = { canList: false, changes: {}, undo: () => ok({}) };
    apiRequest.mockImplementation((type, url) => {
        if (type === 'get' && url.startsWith(CHANGES)) {
            const ids = decodeURIComponent(url.split('ids=')[1]).split(',');
            return ok({ canList: world.canList, changes: ids.map((id) => world.changes[id]).filter(Boolean) });
        }
        if (type === 'post') return world.undo(url);
        return ok({});
    });
    mountHost();
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    dismissUndoToast();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('one change by the person\'s own agent', () => {
    it('says who changed what, with Undo', async () => {
        world.changes.a1 = change('a1');
        applied('a1');
        expect(apiRequest).not.toHaveBeenCalled();
        await gathered();
        expect(reads()).toEqual([['a1']]);
        expect(notice().text()).toContain('Claude changed Fix login: Comment on a task');
        expect(undoButton().exists()).toBe(true);
        expect(showButton().exists()).toBe(false);
    });

    it('names no task when the change has none to name', async () => {
        world.changes.a1 = change('a1', { taskId: '', name: '', label: 'Rename a list' });
        applied('a1');
        await gathered();
        expect(notice().text()).toContain('Claude made a change: Rename a list');
    });

    it('offers no Undo for a change that cannot be undone', async () => {
        world.changes.a1 = change('a1', { undoable: false });
        applied('a1');
        await gathered();
        expect(notice().exists()).toBe(true);
        expect(undoButton().exists()).toBe(false);
    });

    it('shows nothing when the server has nothing to say about it', async () => {
        applied('a1');
        await gathered();
        expect(reads()).toEqual([['a1']]);
        expect(notice().exists()).toBe(false);
    });

    it('ignores a signal for another company, another kind of agent news and a signal with no id', async () => {
        world.changes.a1 = change('a1');
        applied('a1', 'c2');
        socket.fire({ kind: 'proposal' });
        socket.fire({ kind: 'change', companyId: COMPANY });
        await gathered();
        expect(apiRequest).not.toHaveBeenCalled();
        expect(notice().exists()).toBe(false);
    });

    it('stops listening when the page goes away', () => {
        expect(socket.bound()).toBe(true);
        wrapper.unmount();
        wrapper = null;
        expect(socket.bound()).toBe(false);
    });
});

describe('Undo from the notice', () => {
    beforeEach(async () => {
        world.changes.a1 = change('a1');
        applied('a1');
        await gathered();
    });

    it('asks the undo the audit log uses and says it is done', async () => {
        await undoButton().trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', UNDO('a1'), {});
        expect(toast.success).toHaveBeenCalledWith(en.AgentChange.undone, expect.anything());
        expect(notice().exists()).toBe(false);
    });

    it('shows the server\'s reason when the undo is refused', async () => {
        world.undo = () => refusedWith('The undo window closed at 2026-10-02T10:00:00.000Z.');
        await undoButton().trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('The undo window closed at 2026-10-02T10:00:00.000Z.', expect.anything());
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows the reason of an undo the server answered without doing', async () => {
        world.undo = () => Promise.resolve({ data: { status: false, statusText: 'Already undone.' } });
        await undoButton().trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Already undone.', expect.anything());
    });
});

describe('several changes close together', () => {
    const burst = (n) => Array.from({ length: n }, (_, i) => `a${i + 1}`);

    it('are read once and shown as one notice with a count and no Undo', async () => {
        burst(5).forEach((id) => { world.changes[id] = change(id); applied(id); });
        await gathered();
        expect(reads()).toEqual([burst(5)]);
        expect(notice().text()).toContain('Claude made 5 changes');
        expect(undoButton().exists()).toBe(false);
        expect(showButton().exists()).toBe(false);
    });

    it('offer Show to a person who may open the list of agent changes, and it opens that list', async () => {
        world.canList = true;
        burst(3).forEach((id) => { world.changes[id] = change(id); applied(id); });
        await gathered();
        expect(showButton().text()).toBe(en.AgentChange.show);
        await showButton().trigger('click');
        expect(push).toHaveBeenCalledWith({ name: 'AuditLog', params: { cid: COMPANY }, query: { scope: 'agent' } });
        expect(notice().exists()).toBe(false);
    });

    it('do not wait for ever while changes keep coming', async () => {
        world.changes.a1 = change('a1');
        const step = GATHER_MS - 100;
        for (let waited = 0; waited < GATHER_MAX_MS + step; waited += step) {
            applied('a1');
            // eslint-disable-next-line no-await-in-loop
            await vi.advanceTimersByTimeAsync(step);
        }
        expect(reads().length).toBeGreaterThan(0);
    });

    it('count a change once however often it is announced', async () => {
        world.changes.a1 = change('a1');
        applied('a1');
        applied('a1');
        await gathered();
        expect(reads()).toEqual([['a1']]);
        expect(notice().text()).toContain('Claude changed Fix login');
    });

    it('count a batch as its parts, undone together through the batch', async () => {
        world.changes.a1 = change('a1');
        world.changes.a2 = change('a2');
        world.changes.b1 = change('b1', { action: 'tasks.batch', label: 'Record a batch of task changes as one group', taskId: '', name: '', parts: ['a1', 'a2'] });
        ['a1', 'a2', 'b1'].forEach((id) => applied(id));
        await gathered();
        expect(notice().text()).toContain('Claude made 2 changes');
        await undoButton().trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', UNDO('b1'), {});
    });

    it('say how many of a batch were undone when some could not be', async () => {
        world.changes.b1 = change('b1', { action: 'tasks.batch', taskId: '', name: '', parts: ['a1', 'a2', 'a3'] });
        world.undo = () => ok({ undone: 2, items: [{ ok: true }, { ok: true }, { ok: false }] });
        applied('b1');
        await gathered();
        expect(notice().text()).toContain('Claude made 3 changes');
        await undoButton().trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('2 of 3 changes were undone.', expect.anything());
    });

    it('show a batch of one as that one change', async () => {
        world.changes.a1 = change('a1');
        world.changes.b1 = change('b1', { action: 'tasks.batch', taskId: '', name: '', parts: ['a1'] });
        applied('a1');
        applied('b1');
        await gathered();
        expect(notice().text()).toContain('Claude changed Fix login: Comment on a task');
        await undoButton().trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', UNDO('a1'), {});
    });

    it('join the notice that is still up', async () => {
        world.changes.a1 = change('a1');
        world.changes.a2 = change('a2');
        applied('a1');
        await gathered();
        applied('a2');
        await gathered();
        expect(notice().text()).toContain('Claude made 2 changes');
        expect(undoButton().exists()).toBe(false);
    });

    it('start again once another notice has taken the place', async () => {
        world.changes.a1 = change('a1');
        world.changes.a2 = change('a2', { name: 'Ship it' });
        applied('a1');
        await gathered();
        showUndoToast({ message: 'Status updated', undo: vi.fn() });
        applied('a2');
        await gathered();
        expect(notice().text()).toContain('Claude changed Ship it: Comment on a task');
    });

    it('wait while the page is out of sight, and are told together when the person comes back', async () => {
        const showTab = (visible) => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
            document.dispatchEvent(new Event('visibilitychange'));
        };
        showTab(false);
        burst(3).forEach((id) => { world.changes[id] = change(id); applied(id); });
        await vi.advanceTimersByTimeAsync(GATHER_MAX_MS * 4);
        expect(apiRequest).not.toHaveBeenCalled();
        showTab(true);
        await gathered();
        expect(reads()).toEqual([burst(3)]);
        expect(notice().text()).toContain('Claude made 3 changes');
    });

    it('do not name one agent for the changes of two', async () => {
        world.changes.a1 = change('a1');
        world.changes.a2 = change('a2', { agentName: 'ChatGPT' });
        applied('a1');
        applied('a2');
        await gathered();
        expect(notice().text()).toContain('Your AI made 2 changes');
    });
});

describe('the shared notice', () => {
    it('still offers Undo to every caller that hands it one, and none to a caller that hands it nothing', async () => {
        showUndoToast({ message: 'Status updated', undo: vi.fn() });
        await flushPromises();
        expect(undoButton().exists()).toBe(true);
        showUndoToast({ message: 'Nothing to take back' });
        await flushPromises();
        expect(undoButton().exists()).toBe(false);
    });
});
