import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {}, params: {} }), useRouter: () => null }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/molecules/AiUnavailable/AiModelNotice.vue', () => ({ default: { name: 'AiModelNotice', render: () => null } }));
vi.mock('@/components/organisms/MainChat/MainChatRecorder.vue', () => ({ default: { name: 'MainChatRecorder', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('@/views/Ai/agentAccess', () => ({ useAgentAccess: () => ({ canManage: ref(false) }) }));
vi.mock('@/views/Ai/useAgents', () => ({
    reasonOf: (error, key) => key,
    autonomyOf: () => ({ key: 'suggest' }),
    useAgents: () => ({ spend: ref({}), skillManifest: ref([]), loadSkills: vi.fn(), loadSpend: vi.fn() })
}));
vi.mock('@/views/Ai/useParity', () => ({
    useParity: () => ({
        agents: ref([]), registryManifest: ref({}), runs: ref([]), routable: ref([]),
        loadAgents: vi.fn(), loadRegistry: vi.fn(), loadRuns: vi.fn(), loadRoutable: vi.fn(), startRun: vi.fn()
    })
}));

import AskPage from '@/views/Ai/AskPage.vue';
import { answerHtml } from '@/views/Ai/askMarkdown';
import { readSse } from '@/views/Ai/askStream';
import { quickCreate, closeQuickCreate, readDraft } from '@/components/organisms/QuickCreateTask/quickCreateTask';
import * as env from '@/config/env';

const TASK = { kind: 'task', id: 't1', ref: 'OPS-1', title: 'Budget review', project: 'Ops', projectId: 'p1', detail: '' };

const LinkStub = defineComponent({ name: 'RouterLink', props: { to: { type: [Object, String], required: true } }, setup: (props, { slots }) => () => h('a', { href: '#' }, slots.default && slots.default()) });

const encoder = new TextEncoder();
const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

/* A fetch body that hands out the scripted chunks, then waits for the abort signal when told to hang. */
const streamed = (chunks, { hang = false } = {}) => (url, init) => {
    const queue = chunks.map((chunk) => encoder.encode(chunk));
    return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : null) },
        body: {
            getReader: () => ({
                read: () => {
                    if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
                    if (!hang) return Promise.resolve({ done: true, value: undefined });
                    return new Promise((resolve, reject) => {
                        const fail = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
                        if (init.signal.aborted) fail();
                        else init.signal.addEventListener('abort', fail);
                    });
                },
                cancel: vi.fn()
            })
        }
    });
};

const done = (over = {}) => ({ event: 'done', configured: true, mode: 'ask', threadId: 'th1', turnId: 'tu1', answer: 'Budget is **12k** [OPS-1].', cited: [TASK], sources: [TASK], scope: { projects: 1, privileged: false }, usage: { tokens: 42, model: 'm-1' }, ...over });

const serve = ({ threads = [], thread = null } = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (url === env.AI_ASK_SOURCES) return Promise.resolve({ data: { status: true, data: { configured: true, projects: [] } } });
        if (String(url).startsWith(env.AGENT_MODELS)) return Promise.resolve({ data: { status: true, data: { models: [{ model: 'm-1', priced: false }] } } });
        if (type === 'get' && url === env.AI_ASK_THREADS) return Promise.resolve({ data: { status: true, data: { threads } } });
        if (type === 'get' && String(url).startsWith(`${env.AI_ASK_THREADS}/`)) return Promise.resolve({ data: { status: true, data: thread } });
        if (type === 'delete') return Promise.resolve({ data: { status: true } });
        return Promise.reject(new Error(`unexpected ${type} ${url}`));
    });
};

const mountPage = async (options) => {
    serve(options);
    const wrapper = mount(AskPage, { attachTo: document.body, global: { stubs: { RouterLink: LinkStub, teleport: true } } });
    await flushPromises();
    return wrapper;
};

const ask = async (wrapper, question) => {
    const box = wrapper.find('#land-q');
    await box.setValue(question);
    await box.trigger('keydown', { key: 'Enter' });
    await flushPromises();
};

const bodyOf = (call) => JSON.parse(call[1].body);

let wrapper;
beforeEach(() => {
    apiRequest.mockReset();
    closeQuickCreate();
    sessionStorage.clear();
});
afterEach(() => {
    if (wrapper) wrapper.unmount();
    wrapper = null;
    vi.unstubAllGlobals();
});

describe('Ask is a conversation', () => {
    it('streams the answer, then sends the thread id with a follow-up', async () => {
        const fetch = vi.fn()
            .mockImplementationOnce(streamed([sse({ event: 'token', text: 'Budget is ' }), sse({ event: 'token', text: '**12k** [OPS-1].' }), sse(done())]))
            .mockImplementationOnce(streamed([sse(done({ answer: 'Alice [OPS-1].', turnId: 'tu2' }))]));
        vi.stubGlobal('fetch', fetch);
        wrapper = await mountPage();

        await ask(wrapper, 'what is the budget');
        expect(fetch.mock.calls[0][0]).toContain(env.AI_ASK_STREAM);
        expect(bodyOf(fetch.mock.calls[0])).toEqual({ question: 'what is the budget', mode: 'ask' });
        expect(wrapper.findAll('[data-test="ask-turn"]')).toHaveLength(1);
        expect(wrapper.find('.ask__answer strong').text()).toBe('12k');

        await ask(wrapper, 'who owns it');
        expect(bodyOf(fetch.mock.calls[1])).toEqual({ question: 'who owns it', mode: 'ask', threadId: 'th1' });
        expect(wrapper.findAll('[data-test="ask-turn"]')).toHaveLength(2);
        expect(wrapper.find('#land-q').element.value).toBe('');
    });

    it('starts over with New question and focuses the question box', async () => {
        const fetch = vi.fn().mockImplementation(streamed([sse(done())]));
        vi.stubGlobal('fetch', fetch);
        wrapper = await mountPage();
        await ask(wrapper, 'what is the budget');

        await wrapper.find('[data-test="ask-new"]').trigger('click');
        expect(wrapper.findAll('[data-test="ask-turn"]')).toHaveLength(0);
        expect(document.activeElement).toBe(wrapper.find('#land-q').element);

        await ask(wrapper, 'fresh');
        expect(bodyOf(fetch.mock.calls[1])).toEqual({ question: 'fresh', mode: 'ask' });
    });

    it('sends on Enter and leaves Shift+Enter for a new line', async () => {
        const fetch = vi.fn().mockImplementation(streamed([sse(done())]));
        vi.stubGlobal('fetch', fetch);
        wrapper = await mountPage();
        const box = wrapper.find('#land-q');
        await box.setValue('two lines');
        await box.trigger('keydown', { key: 'Enter', shiftKey: true });
        expect(fetch).not.toHaveBeenCalled();
        await box.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does not refuse to ask because the model has no price', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(streamed([sse(done())])));
        wrapper = await mountPage();
        await wrapper.find('#land-q').setValue('budget');
        expect(wrapper.find('[data-test="ask-send"]').attributes('disabled')).toBeUndefined();
    });

    it('stops a streaming answer, aborting the request, and says so', async () => {
        const fetch = vi.fn().mockImplementation(streamed([sse({ event: 'token', text: 'Budget is' })], { hang: true }));
        vi.stubGlobal('fetch', fetch);
        wrapper = await mountPage();

        await ask(wrapper, 'what is the budget');
        const live = wrapper.find('[data-test="ask-live"]');
        expect(live.attributes('aria-live')).toBe('polite');
        expect(live.text()).toBe('');
        const stop = wrapper.find('[data-test="ask-stop"]');
        expect(stop.exists()).toBe(true);
        expect(wrapper.find('[data-test="ask-send"]').exists()).toBe(false);

        await stop.trigger('click');
        await flushPromises();

        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(wrapper.find('[data-test="ask-stop"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="ask-stopped"]').exists()).toBe(true);
        expect(live.text()).toBe('Ask.answer_stopped');
    });

    it('announces the answer once, when it is complete', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(streamed([sse({ event: 'token', text: 'Budget' }), sse(done())])));
        wrapper = await mountPage();
        await ask(wrapper, 'what is the budget');
        expect(wrapper.find('[data-test="ask-live"]').text()).toBe('Ask.answer_ready');
        expect(wrapper.find('[data-test="ask-turn"] .ask__answer').attributes('aria-live')).toBeUndefined();
    });

    it('renders the answer as sanitised Markdown: script and event handlers are stripped', async () => {
        const hostile = 'Plan:\n\n- **one**\n\n<script>window.pwned = 1</script><img src=x onerror="window.pwned = 1"> [link](javascript:alert(1))';
        vi.stubGlobal('fetch', vi.fn().mockImplementation(streamed([sse(done({ answer: hostile, cited: [], sources: [] }))])));
        wrapper = await mountPage();
        await ask(wrapper, 'plan');

        const body = wrapper.find('.ask__answer');
        expect(body.find('li strong').text()).toBe('one');
        expect(body.find('script').exists()).toBe(false);
        expect(body.find('img').exists()).toBe(false);
        expect(body.html()).not.toMatch(/onerror=/i);
        expect(body.findAll('a').every((a) => !/^javascript:/i.test(a.attributes('href') || ''))).toBe(true);
        expect(window.pwned).toBeUndefined();
    });

    it('shows a server refusal from the stream as an error on the turn', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(streamed([sse({ event: 'error', statusText: 'Model m-9 has no price.', code: 'unpriced_model' })])));
        wrapper = await mountPage();
        await ask(wrapper, 'budget');
        expect(wrapper.find('[data-test="ask-turn-error"]').text()).toBe('Model m-9 has no price.');
    });
});

describe('answer actions', () => {
    it('copies the answer and makes a task prefilled with it', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        vi.stubGlobal('fetch', vi.fn().mockImplementation(streamed([sse(done({ answer: 'Review the **budget** with Ops [OPS-1].\n\nThen close it.' }))])));
        wrapper = await mountPage();
        await ask(wrapper, 'what next');

        await wrapper.find('[data-test="ask-copy"]').trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('Review the **budget** with Ops [OPS-1].\n\nThen close it.');

        await wrapper.find('[data-test="ask-make-task"]').trigger('click');
        expect(quickCreate.open).toBe(true);
        expect(quickCreate.projectId).toBe('p1');
        expect(readDraft()).toBe('Review the budget with Ops');
    });
});

describe('my threads', () => {
    const thread = {
        id: 'th9', title: 'Budget',
        turns: [{ turnId: 'a', question: 'what is the budget', answer: 'It is 12k [OPS-1].', mode: 'ask', model: 'm-1', createdAt: '2026-09-20T00:00:00Z', cited: [{ ...TASK, available: true }, { kind: 'task', id: 'gone', ref: 'HR-1', title: '', project: '', projectId: '', available: false }] }]
    };

    it('lists my threads on the Ask page, opens one and follows up in it', async () => {
        const fetch = vi.fn().mockImplementation(streamed([sse(done({ threadId: 'th9' }))]));
        vi.stubGlobal('fetch', fetch);
        wrapper = await mountPage({ threads: [{ id: 'th9', title: 'Budget', turns: 1, lastTurnAt: '2026-09-20T00:00:00Z' }], thread });

        const toggle = wrapper.find('[data-test="ask-history-toggle"]');
        expect(toggle.attributes('aria-expanded')).toBe('false');
        await toggle.trigger('click');
        expect(toggle.attributes('aria-expanded')).toBe('true');
        const rows = wrapper.findAll('[data-test="ask-history-open"]');
        expect(rows).toHaveLength(1);

        await rows[0].trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('get', `${env.AI_ASK_THREADS}/th9`);
        expect(wrapper.findAll('[data-test="ask-turn"]')).toHaveLength(1);
        expect(wrapper.find('[data-test="ask-cite-gone"]').exists()).toBe(true);

        await ask(wrapper, 'and now');
        expect(bodyOf(fetch.mock.calls[0])).toMatchObject({ question: 'and now', threadId: 'th9' });
    });

    it('deletes a thread after confirming', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        wrapper = await mountPage({ threads: [{ id: 'th9', title: 'Budget', turns: 1, lastTurnAt: '2026-09-20T00:00:00Z' }], thread });
        await wrapper.find('[data-test="ask-history-toggle"]').trigger('click');
        await wrapper.find('[data-test="ask-history-delete"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('delete', `${env.AI_ASK_THREADS}/th9`);
        expect(wrapper.findAll('[data-test="ask-history-open"]')).toHaveLength(0);
    });
});

describe('answerHtml', () => {
    it('links a cited ref and leaves an uncited one as text', () => {
        const html = answerHtml('See [OPS-1] and [XX-9].', { cited: [TASK], hrefOf: () => '/c/p?task=t1' });
        const box = document.createElement('div');
        box.innerHTML = html;
        const link = box.querySelector('a.ask-cite');
        expect(link.textContent).toBe('OPS-1');
        expect(link.getAttribute('href')).toBe('/c/p?task=t1');
        expect(box.textContent).toContain('[XX-9]');
    });

    it('escapes a ref that carries markup', () => {
        const evil = { ...TASK, ref: '<img src=x onerror=alert(1)>' };
        const box = document.createElement('div');
        box.innerHTML = answerHtml(`See [${evil.ref}].`, { cited: [evil], hrefOf: () => '"><script>x</script>' });
        expect(box.querySelector('img')).toBeNull();
        expect(box.querySelector('script')).toBeNull();
    });
});

describe('readSse', () => {
    it('parses whole events and keeps a partial one for the next chunk', () => {
        const { events, rest } = readSse(`${sse({ event: 'token', text: 'a' })}: ping\n\n${sse({ event: 'token', text: 'b' })}data: {"event":"to`);
        expect(events).toEqual([{ event: 'token', text: 'a' }, { event: 'token', text: 'b' }]);
        expect(rest).toBe('data: {"event":"to');
    });
});
