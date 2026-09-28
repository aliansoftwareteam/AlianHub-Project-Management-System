import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

const { apiRequest, skills } = vi.hoisted(() => ({ apiRequest: vi.fn(), skills: { list: [] } }));

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
    useAgents: () => ({ spend: ref({}), skillManifest: ref(skills.list), loadSkills: vi.fn(), loadSpend: vi.fn() })
}));
vi.mock('@/views/Ai/useParity', () => ({
    useParity: () => ({
        agents: ref([]), registryManifest: ref({}), runs: ref([]), routable: ref([]),
        loadAgents: vi.fn(), loadRegistry: vi.fn(), loadRuns: vi.fn(), loadRoutable: vi.fn(), startRun: vi.fn()
    })
}));

import AskPage from '@/views/Ai/AskPage.vue';
import AskAnswer from '@/views/Ai/AskAnswer.vue';
import * as env from '@/config/env';
import { undoToast, runUndo, dismissUndoToast } from '@/composable/useUndoToast';
import { slashQuery, mentionAt, workItemsOf, matchMember, answerBlocks, STARTERS } from '@/views/Ai/askComposer';

const LinkStub = defineComponent({ name: 'RouterLink', props: { to: { type: [Object, String], required: true } }, setup: (props, { slots }) => () => h('a', { href: '#' }, slots.default && slots.default()) });

const PROJECTS = [{ id: 'p1', name: 'Ops' }, { id: 'p2', name: 'Web' }];

const encoder = new TextEncoder();
const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const streamed = (chunks) => () => {
    const queue = chunks.map((chunk) => encoder.encode(chunk));
    return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
        body: { getReader: () => ({ read: () => Promise.resolve(queue.length ? { done: false, value: queue.shift() } : { done: true, value: undefined }), cancel: vi.fn() }) }
    });
};
const done = (over = {}) => ({ event: 'done', configured: true, mode: 'ask', threadId: 'th1', turnId: 'tu1', answer: 'Fine.', cited: [], sources: [], scope: { projects: 1 }, usage: { model: 'm' }, ...over });

const SEARCH = {
    tasks: [{ _id: 't1', TaskName: 'Budget review', TaskKey: 'OPS-1', ProjectID: 'p1' }],
    projects: [{ _id: 'p1', ProjectName: 'Ops' }],
    pages: [{ _id: 'g1', title: 'Budget runbook', ProjectID: 'p1' }],
    comments: []
};

const TARGET = {
    projectId: 'p1', name: 'Ops', canCreate: true, canAssign: true,
    lists: [{ id: 'l1', name: 'Backlog' }],
    members: [{ id: 'user-1', name: 'Mia Me' }, { id: 'u2', name: 'Priya Shah' }]
};

const serve = (extra = () => undefined) => {
    apiRequest.mockImplementation((type, url, body) => {
        const answered = extra(type, url, body);
        if (answered) return answered;
        if (url === env.AI_ASK_SOURCES) return Promise.resolve({ data: { status: true, data: { configured: true, projects: PROJECTS } } });
        if (String(url).startsWith(env.AGENT_MODELS)) return Promise.resolve({ data: { status: true, data: { models: [] } } });
        if (type === 'get' && url === env.AI_ASK_THREADS) return Promise.resolve({ data: { status: true, data: { threads: [] } } });
        if (type === 'post' && url === env.GLOBAL_SEARCH) return Promise.resolve({ data: { status: true, data: SEARCH } });
        if (type === 'get' && String(url).startsWith(`${env.AI_ASK_BUILD}/`)) return Promise.resolve({ data: { status: true, data: TARGET } });
        return Promise.reject(new Error(`unexpected ${type} ${url}`));
    });
};

const mountPage = async () => {
    const wrapper = mount(AskPage, { attachTo: document.body, global: { stubs: { RouterLink: LinkStub, teleport: true } } });
    await flushPromises();
    return wrapper;
};

const type = async (wrapper, text) => {
    const box = wrapper.find('#land-q');
    box.element.value = text;
    box.element.setSelectionRange(text.length, text.length);
    await box.trigger('input');
    await flushPromises();
    return box;
};

const bodyOf = (call) => JSON.parse(call[1].body);

let wrapper;
beforeEach(() => {
    vi.useRealTimers();
    apiRequest.mockReset();
    skills.list = [
        { key: 'digest.ceo', name: 'Reporter', description: 'A digest' },
        { key: 'brief.parse', name: 'Brief parser', description: 'Parses a brief' }
    ];
});
afterEach(() => {
    if (wrapper) wrapper.unmount();
    wrapper = null;
    dismissUndoToast();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe('composer helpers', () => {
    it('reads a / command only at the start of the box', () => {
        expect(slashQuery('/')).toBe('');
        expect(slashQuery('/rep')).toBe('rep');
        expect(slashQuery('what /rep')).toBeNull();
        expect(slashQuery('/rep more words')).toBeNull();
    });

    it('reads the @ word under the caret', () => {
        expect(mentionAt('look at @bud', 12)).toEqual({ query: 'bud', start: 8, end: 12 });
        expect(mentionAt('@', 1)).toEqual({ query: '', start: 0, end: 1 });
        expect(mentionAt('mail me@example.com', 19)).toBeNull();
        expect(mentionAt('look at @bud and', 16)).toBeNull();
    });

    it('reads a list of work out of an answer, with a due date and an owner when it names them', () => {
        const items = workItemsOf([
            'Here is the plan [OPS-1]:',
            '',
            '1. **Draft the budget** — due 2026-10-03, owner: Priya Shah [OPS-1]',
            '2. Book the venue (@Mia)',
            '- [ ] Send the invites',
            '',
            'That is all.'
        ].join('\n'));
        expect(items).toEqual([
            { title: 'Draft the budget', due: '2026-10-03', who: 'Priya Shah' },
            { title: 'Book the venue', due: '', who: 'Mia' },
            { title: 'Send the invites', due: '', who: '' }
        ]);
        expect(workItemsOf('Just one paragraph with no list.')).toEqual([]);
    });

    it('matches an owner to a project member by name, or leaves it unassigned', () => {
        const members = [{ id: 'u1', name: 'Mia Me' }, { id: 'u2', name: 'Priya Shah' }];
        expect(matchMember('Priya Shah', members)).toBe('u2');
        expect(matchMember('mia', members)).toBe('u1');
        expect(matchMember('Nobody', members)).toBe('');
        expect(matchMember('', members)).toBe('');
    });

    it('turns an answer into editor blocks without Markdown marks or citations', () => {
        const blocks = answerBlocks('# Plan\n\nWe **ship** it [OPS-1].\n\n- one\n- two');
        expect(blocks.map((b) => b.type)).toEqual(['header', 'paragraph', 'list']);
        expect(blocks[1].data.text).toBe('We ship it OPS-1.');
    });
});

describe('starter cards', () => {
    it('shows four cards on an empty thread and fills an editable prompt without sending', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        serve();
        wrapper = await mountPage();
        const cards = wrapper.findAll('[data-test="ask-starter"]');
        expect(cards.map((c) => c.attributes('data-key'))).toEqual(STARTERS.map((s) => s.key));
        expect(cards).toHaveLength(4);

        await wrapper.find('[data-test="ask-starter"][data-key="urgent"]').trigger('click');
        expect(wrapper.find('#land-q').element.value).toBe('Ask.starter_urgent_prompt');
        expect(document.activeElement).toBe(wrapper.find('#land-q').element);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('names the scoped project in the status update prompt', async () => {
        serve();
        wrapper = await mountPage();
        await wrapper.find('select[aria-label="AiLanding.ctl_scope_label"]').setValue('p2');
        await wrapper.find('[data-test="ask-starter"][data-key="status"]').trigger('click');
        expect(wrapper.find('#land-q').element.value).toBe('Ask.starter_status_prompt');
        await wrapper.find('select[aria-label="AiLanding.ctl_scope_label"]').setValue('');
        await wrapper.find('[data-test="ask-starter"][data-key="status"]').trigger('click');
        expect(wrapper.find('#land-q').element.value).toBe('Ask.starter_status_prompt_all');
    });

    it('hides the cards once the thread has a question', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(streamed([sse(done())])));
        serve();
        wrapper = await mountPage();
        await type(wrapper, 'hello there');
        await wrapper.find('#land-q').trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(wrapper.findAll('[data-test="ask-starter"]')).toHaveLength(0);
    });
});

describe('/ picks a skill', () => {
    it('opens the skill list, moves with the arrows, picks with Enter and sends the skill with the question', async () => {
        const fetch = vi.fn().mockImplementation(streamed([sse(done())]));
        vi.stubGlobal('fetch', fetch);
        serve();
        wrapper = await mountPage();
        const box = await type(wrapper, '/');
        const menu = wrapper.find('[data-test="ask-menu"]');
        expect(menu.exists()).toBe(true);
        expect(box.attributes('aria-expanded')).toBe('true');
        expect(wrapper.findAll('[data-test="ask-menu-item"]').map((i) => i.text())).toEqual([expect.stringContaining('Reporter'), expect.stringContaining('Brief parser')]);

        await box.trigger('keydown', { key: 'ArrowDown' });
        expect(box.attributes('aria-activedescendant')).toBe(wrapper.findAll('[data-test="ask-menu-item"]')[1].attributes('id'));
        await box.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(wrapper.find('[data-test="ask-menu"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="ask-skill-chip"]').text()).toContain('Brief parser');
        expect(box.element.value).toBe('');
        expect(fetch).not.toHaveBeenCalled();

        await type(wrapper, 'summarise this brief');
        await box.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(bodyOf(fetch.mock.calls[0])).toEqual({ question: 'summarise this brief', mode: 'ask', skill: 'brief.parse' });
    });

    it('filters as you type and closes on Escape', async () => {
        serve();
        wrapper = await mountPage();
        await type(wrapper, '/rep');
        expect(wrapper.findAll('[data-test="ask-menu-item"]')).toHaveLength(1);
        await wrapper.find('#land-q').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('[data-test="ask-menu"]').exists()).toBe(false);
    });
});

describe('@ adds context', () => {
    it('searches what the asker can open, inserts a chip and sends the ids as context', async () => {
        const fetch = vi.fn().mockImplementation(streamed([sse(done())]));
        vi.stubGlobal('fetch', fetch);
        serve();
        wrapper = await mountPage();
        const box = await type(wrapper, 'what changed in @bud');
        await new Promise((resolve) => setTimeout(resolve, 260));
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', env.GLOBAL_SEARCH, { query: 'bud' });
        const items = wrapper.findAll('[data-test="ask-menu-item"]');
        expect(items.map((i) => i.attributes('data-kind'))).toEqual(['project', 'task', 'page']);

        await box.trigger('keydown', { key: 'ArrowDown' });
        await box.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(wrapper.findAll('[data-test="ask-context-chip"]').map((c) => c.text())).toEqual([expect.stringContaining('Budget review')]);
        expect(box.element.value).toBe('what changed in ');

        await box.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(bodyOf(fetch.mock.calls[0])).toEqual({ question: 'what changed in', mode: 'ask', context: [{ kind: 'task', id: 't1' }] });
        expect(wrapper.findAll('[data-test="ask-context-chip"]')).toHaveLength(0);
    });

    it('removes a chip with its button', async () => {
        serve();
        wrapper = await mountPage();
        const box = await type(wrapper, '@bud');
        await new Promise((resolve) => setTimeout(resolve, 260));
        await flushPromises();
        await box.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(wrapper.findAll('[data-test="ask-context-chip"]')).toHaveLength(1);
        await wrapper.find('[data-test="ask-context-remove"]').trigger('click');
        expect(wrapper.findAll('[data-test="ask-context-chip"]')).toHaveLength(0);
    });
});

const LIST_ANSWER = {
    answer: 'Next steps:\n\n1. Draft the budget — due 2026-10-03, owner: Priya Shah\n2. Book the venue\n3. Send the invites',
    question: 'plan the offsite',
    mode: 'ask',
    cited: [],
    sources: [],
    status: 'done'
};

const mountAnswer = (answer = LIST_ANSWER) => mount(AskAnswer, {
    attachTo: document.body,
    props: { answer, projects: PROJECTS, projectId: 'p1' },
    global: { stubs: { RouterLink: LinkStub, teleport: true } }
});

describe('build from an answer', () => {
    it('offers Create tasks only for an answer that lists work', async () => {
        serve();
        wrapper = mountAnswer({ ...LIST_ANSWER, answer: 'Budget is 12k.' });
        expect(wrapper.find('[data-test="ask-build-tasks"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="ask-build-doc"]').exists()).toBe(true);
    });

    it('previews a checklist and creates only the ticked items, with Undo', async () => {
        const created = [{ index: 0, taskId: 'n1', title: 'Draft the budget' }, { index: 1, taskId: 'n3', title: 'Send the invites' }];
        serve((kind, url) => {
            if (kind === 'post' && url === env.AI_ASK_CREATE_TASKS) return Promise.resolve({ data: { status: true, data: { created, failed: [] } } });
            if (kind === 'post' && url === env.V2_TASKS_BULK) return Promise.resolve({ data: { status: true } });
            return undefined;
        });
        wrapper = mountAnswer();
        await wrapper.find('[data-test="ask-build-tasks"]').trigger('click');
        await flushPromises();

        const rows = wrapper.findAll('[data-test="build-row"]');
        expect(rows).toHaveLength(3);
        expect(rows[0].find('input[type="text"]').element.value).toBe('Draft the budget');
        expect(rows[0].find('input[type="date"]').element.value).toBe('2026-10-03');
        expect(rows[0].find('select').element.value).toBe('u2');
        expect(apiRequest).toHaveBeenCalledWith('get', `${env.AI_ASK_BUILD}/p1`);

        await rows[1].find('input[type="checkbox"]').setValue(false);
        await rows[2].find('input[type="text"]').setValue('Send the invites today');
        await wrapper.find('[data-test="build-create"]').trigger('click');
        await flushPromises();

        const create = apiRequest.mock.calls.find(([kind, url]) => kind === 'post' && url === env.AI_ASK_CREATE_TASKS);
        expect(create[2].projectId).toBe('p1');
        expect(create[2].sprintId).toBe('l1');
        expect(create[2].items.map((i) => i.title)).toEqual(['Draft the budget', 'Send the invites today']);
        expect(create[2].items[0].assigneeId).toBe('u2');
        expect(new Date(create[2].items[0].dueDate).getDate()).toBe(3);
        expect(create[2].items[1]).toEqual({ title: 'Send the invites today' });
        expect(wrapper.find('[data-test="build-dialog"]').exists()).toBe(false);

        expect(undoToast.current).toMatchObject({ message: 'Ask.build_tasks_created' });
        await runUndo();
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', env.V2_TASKS_BULK, { action: 'bulkTrash', taskIds: ['n1', 'n3'] });
    });

    it('keeps the rows that failed in the preview with the reason', async () => {
        serve((kind, url) => {
            if (kind === 'post' && url === env.AI_ASK_CREATE_TASKS) {
                return Promise.resolve({ data: { status: true, data: { created: [{ index: 0, taskId: 'n1', title: 'Draft the budget' }], failed: [{ index: 1, code: 'assignee_not_allowed' }] } } });
            }
            return undefined;
        });
        wrapper = mountAnswer();
        await wrapper.find('[data-test="ask-build-tasks"]').trigger('click');
        await flushPromises();
        await wrapper.findAll('[data-test="build-row"]')[2].find('input[type="checkbox"]').setValue(false);
        await wrapper.find('[data-test="build-create"]').trigger('click');
        await flushPromises();
        const rows = wrapper.findAll('[data-test="build-row"]');
        expect(rows.map((r) => r.find('input[type="text"]').element.value)).toEqual(['Book the venue', 'Send the invites']);
        expect(rows[0].find('[data-test="build-row-error"]').text()).toBe('Ask.build_error_assignee_not_allowed');
    });

    it('says so and creates nothing when the project does not allow it', async () => {
        serve((kind, url) => (kind === 'get' && String(url).startsWith(`${env.AI_ASK_BUILD}/`)
            ? Promise.resolve({ data: { status: true, data: { ...TARGET, canCreate: false } } })
            : undefined));
        wrapper = mountAnswer();
        await wrapper.find('[data-test="ask-build-tasks"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="build-not-allowed"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="build-create"]').attributes('disabled')).toBeDefined();
    });

    it('saves the answer as a draft doc in the chosen project, with Undo', async () => {
        serve((kind, url) => {
            if (kind === 'post' && url === env.PAGES) return Promise.resolve({ data: { status: true, data: { _id: 'd1', title: 'Offsite plan', ProjectID: 'p2' } } });
            if (kind === 'delete' && url === `${env.PAGES}/d1`) return Promise.resolve({ data: { status: true } });
            return undefined;
        });
        wrapper = mountAnswer();
        await wrapper.find('[data-test="ask-build-doc"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="doc-title"]').setValue('Offsite plan');
        await wrapper.find('[data-test="doc-project"]').setValue('p2');
        await wrapper.find('[data-test="doc-create"]').trigger('click');
        await flushPromises();

        const create = apiRequest.mock.calls.find(([kind, url]) => kind === 'post' && url === env.PAGES);
        expect(create[2]).toMatchObject({ title: 'Offsite plan', projectId: 'p2', createdByAgent: true });
        expect(create[2].contentBlocks.map((b) => b.type)).toEqual(['paragraph', 'list']);
        expect(wrapper.find('[data-test="doc-dialog"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="ask-doc-link"]').exists()).toBe(true);

        expect(undoToast.current).toMatchObject({ message: 'Ask.build_doc_created' });
        await runUndo();
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('delete', `${env.PAGES}/d1`);
        expect(wrapper.find('[data-test="ask-doc-link"]').exists()).toBe(false);
    });
});
