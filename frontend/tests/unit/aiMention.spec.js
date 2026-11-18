import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

const { apiRequest, users } = vi.hoisted(() => ({ apiRequest: vi.fn(), users: {} }));
const composable = vi.hoisted(() => ({
    useGetterFunctions: () => ({ getUser: (id) => users[id] || { id, Employee_Name: '' } }),
    useCustomComposable: () => ({ makeUniqueId: () => 'id', changeText: (text) => text, debounce: (fn) => fn }),
}));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/components/atom/UserProfile/UserProfile.vue', () => ({ default: { name: 'UserProfile', render: () => null } }));

import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { AI_MENTION_KEY, aiAuthorOf, mentionsAi } from '@/utils/aiMention';
import { threadStore } from '@/composable/commentThreads';
import CommentInput from '@/components/atom/CommentInput/CommentInput.vue';
import CommentThread from '@/components/molecules/CommentThread/CommentThread.vue';
import MainChatMessage from '@/components/organisms/MainChat/MainChatMessage.vue';
import MainChatMessageBody from '@/components/organisms/MainChat/MainChatMessageBody.vue';

const ADA = '64b000000000000000000001';
const BO = '64b000000000000000000002';
const PARENT = '64c000000000000000000001';
const TASK = '64d000000000000000000001';
const CITED = '64d000000000000000000009';

const aiReply = (extra = {}) => ({
    _id: 'ai1', parentId: PARENT, userId: 'ai', actorType: 'ai', aiAskerId: ADA, aiQuestionId: PARENT, taskId: TASK, type: 'text',
    message: 'It ships on Friday [WEB-7].', aiCitations: [{ kind: 'task', id: CITED, ref: 'WEB-7', projectId: 'p1' }],
    createdAt: '2026-09-28T09:00:00.000Z', ...extra,
});
const parent = (extra = {}) => ({ _id: PARENT, userId: ADA, projectId: 'p1', sprintId: 's1', taskId: TASK, message: '@[AI](ai_ask) when?', type: 'text', replyCount: 1, ...extra });
const router = { resolve: (to) => ({ href: `/company-1/project?task=${to.query ? to.query.task : ''}` }) };

const resetStore = () => ['replies', 'loaded', 'added', 'versions'].forEach((key) => {
    Object.keys(threadStore[key]).forEach((id) => { delete threadStore[key][id]; });
});

let wrapper;
beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    resetStore();
    resetAiAvailability();
    users[ADA] = { id: ADA, Employee_Name: 'Ada' };
    users[BO] = { id: BO, Employee_Name: 'Bo' };
    apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data: [aiReply()] } }));
});
afterEach(() => { if (wrapper) wrapper.unmount(); wrapper = null; });

describe('the @ai mention', () => {
    it('is recognised picked or typed, and not inside an address or another name', () => {
        expect(AI_MENTION_KEY).toBe('ai_ask');
        expect(mentionsAi('@[AI](ai_ask) when?')).toBe(true);
        expect(mentionsAi('hey @ai, when?')).toBe(true);
        expect(mentionsAi('mail me@ai.example or @aiden')).toBe(false);
    });

    it('marks only rows the AI wrote', () => {
        expect(aiAuthorOf(aiReply())).toEqual({ askerId: ADA });
        expect(aiAuthorOf({ userId: BO, actorType: 'agent' })).toBeNull();
    });
});

describe('the mention list', () => {
    const Composer = (props) => defineComponent({
        setup() {
            const text = ref('');
            return () => h('div', [h(CommentInput, { modelValue: text.value, 'onUpdate:modelValue': (v) => { text.value = v; }, userIds: [ADA, BO], reply: {}, ...props }), h('output', { id: 'value' }, text.value)]);
        },
    });
    const openList = async (props) => {
        wrapper = mount(Composer(props), { attachTo: document.getElementById('app'), global: { provide: { $defaultUserAvatar: ref(''), $clientWidth: ref(1280) } } });
        const box = wrapper.find('textarea');
        box.element.value = '@';
        await box.trigger('input');
        box.element.setSelectionRange(1, 1);
        await box.trigger('keyup', { keyCode: 50, key: '@' });
        await nextTick();
        return box;
    };

    it('offers the AI when AI is usable, and it is reachable from the keyboard', async () => {
        applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: true });
        const box = await openList({ aiMention: true });
        const options = wrapper.findAll('[role="option"]');
        const ai = wrapper.find('[data-test="mention-ai"]');
        expect(ai.exists()).toBe(true);
        expect(ai.attributes('role')).toBe('option');
        expect(options.at(-1).attributes('id')).toBe(ai.attributes('id'));

        for (let i = 0; i < options.length - 1; i += 1) await box.trigger('keydown', { keyCode: 40, key: 'ArrowDown' });
        expect(box.attributes('aria-activedescendant')).toBe(ai.attributes('id'));
        await box.trigger('keypress', { keyCode: 13, key: 'Enter' });
        await nextTick();
        expect(wrapper.find('#value').text()).toBe('@[AI](ai_ask)');
    });

    it.each([
        ['AI is off for the workspace', { state: AI_STATE.OFF_WORKSPACE, loaded: true, planAllowsAi: true }, { aiMention: true }],
        ['no model is set up', { state: AI_STATE.UNCONFIGURED, loaded: true, planAllowsAi: true }, { aiMention: true }],
        ['the plan has no AI', { state: AI_STATE.ON, loaded: true, planAllowsAi: false }, { aiMention: true }],
        ['the composer does not take it', { state: AI_STATE.ON, loaded: true, planAllowsAi: true }, {}],
    ])('leaves the AI out when %s', async (label, availability, props) => {
        applyAiAvailability(availability);
        await openList(props);
        expect(wrapper.find('[data-test="mention-ai"]').exists()).toBe(false);
        expect(wrapper.findAll('[role="option"]').length).toBe(2);
    });
});

describe('an AI reply in a comment thread', () => {
    const mountThread = async (message) => {
        wrapper = mount(CommentThread, {
            props: { message, people: [] },
            attachTo: document.getElementById('app'),
            global: { stubs: { UserProfile: true, CommentAssignment: true }, mocks: { $router: router }, provide: { $userId: ref(BO), $companyId: ref('company-1') } },
        });
        await flushPromises();
        return wrapper;
    };

    it('is labelled as the AI answering for the asker, with its citations as links', async () => {
        await mountThread(parent());
        await wrapper.find('[data-test="thread-toggle"]').trigger('click');
        await flushPromises();

        const row = wrapper.find('[data-test="reply"]');
        expect(row.find('[data-test="ai-author"]').text()).toBe('AiMention.author');
        expect(row.find('[data-test="ai-for"]').text()).toBe('AiMention.answered_for');
        const cite = row.find('a.ask-cite');
        expect(cite.text()).toBe('WEB-7');
        expect(cite.attributes('href')).toBe(`/company-1/project?task=${CITED}`);
    });

    it('says the AI is answering while it works, and when it could not', async () => {
        await mountThread(parent({ replyCount: 0, aiAsk: { state: 'answering', askerId: ADA } }));
        expect(wrapper.find('[data-test="ai-state"]').text()).toBe('AiMention.answering');
        expect(wrapper.find('[data-test="ai-state"]').attributes('role')).toBe('status');

        await wrapper.setProps({ message: parent({ replyCount: 0, aiAsk: { state: 'failed', askerId: ADA } }) });
        expect(wrapper.find('[data-test="ai-state"]').text()).toBe('AiMention.failed');
    });
});

describe('an AI message in chat', () => {
    it('carries the AI label and the asker', () => {
        wrapper = shallowMount(MainChatMessage, { props: { message: { ...aiReply(), parentId: undefined, hasReply: true, reply_userId: ADA }, senderName: '' }, global: { mocks: { $t: (key) => key } } });
        expect(wrapper.find('.mc-msg').classes()).not.toContain('is-me');
        expect(wrapper.find('[data-test="ai-author"]').text()).toBe('AiMention.author');
        expect(wrapper.find('[data-test="ai-for"]').text()).toBe('AiMention.answered_for');
    });

    it('renders its citations', () => {
        wrapper = mount(MainChatMessageBody, { props: { message: aiReply({ parentId: undefined }) }, global: { mocks: { $router: router } } });
        expect(wrapper.find('a.ask-cite').text()).toBe('WEB-7');
    });
});
