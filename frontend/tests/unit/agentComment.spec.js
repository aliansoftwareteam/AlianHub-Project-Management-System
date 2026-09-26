import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';

const VISIBLE = '6a8ef8f37a685406dbc572a1';
const HIDDEN = '6a8f05849fde326c61184fa0';
const PERSON = '6a8ee972d625fca52e519a05';

const apiRequest = vi.fn();
vi.mock('@/services', () => ({ apiRequest: (...args) => apiRequest(...args) }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'users/users': [] } }), createStore: () => ({}) }));
vi.mock('@/composable/projects', () => ({ useProjects: () => ({ getDateType: () => 'today' }) }));
vi.mock('@/composable/commonFunction', () => ({ storageHelper: () => ({ handleStorageImageRequest: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useConvertDate: () => ({ convertDateFormat: () => 'date' }),
    useGetterFunctions: () => ({
        getUser: (id) => (id === PERSON
            ? { _id: PERSON, Employee_Name: 'Max Member', Employee_profileImageURL: 'max.png' }
            : { _id: id, Employee_Name: 'Ghost User', Employee_profileImageURL: 'ghost.png' })
    })
}));

import { agentAuthorOf, agentReplyHtml, automationAuthorOf, pageRefIds } from '@/utils/agentComment';
import Comment from '@/components/organisms/Comment/Comment.vue';

const asDom = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
};

const visiblePages = new Map([[VISIBLE, { _id: VISIBLE, title: 'Ask smoke: Requirements' }]]);
const render = (text) => asDom(agentReplyHtml(text, {
    pageOf: (id) => visiblePages.get(id) || null,
    pageHref: (id) => `http://localhost/c1/pages/${id}`,
    pageLabel: 'page',
    hiddenPageLabel: 'hidden page',
}));

describe('agentReplyHtml', () => {
    it('links a cited page the viewer can open, by its title', () => {
        const host = render(`See [page:${VISIBLE}] for the list`);
        const anchors = host.querySelectorAll('a');
        expect(anchors).toHaveLength(1);
        expect(anchors[0].getAttribute('href')).toBe(`http://localhost/c1/pages/${VISIBLE}`);
        expect(anchors[0].textContent).toBe('Ask smoke: Requirements');
        expect(anchors[0].getAttribute('rel')).toBe('noopener noreferrer');
        expect(host.textContent).not.toContain('[page:');
    });

    it('does not link a page the viewer cannot open, nor name it', () => {
        const host = render(`Hidden one [page:${HIDDEN}]`);
        expect(host.querySelector('a')).toBeNull();
        expect(host.textContent).toContain('hidden page');
        expect(host.textContent).not.toContain(HIDDEN);
    });

    it('escapes the text around a citation', () => {
        const host = render(`<img src=x onerror="alert(1)"> [page:${VISIBLE}] <script>alert(2)</script>`);
        expect(host.querySelectorAll('img, script, [onerror]')).toHaveLength(0);
        expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
        expect(host.textContent).toContain('<script>alert(2)</script>');
        expect(host.querySelectorAll('a')).toHaveLength(1);
    });

    it('renders the reply markdown through the sanitiser, without images', () => {
        const host = render('- **Ask smoke** first\n- second\n\n![x](https://tracker.example/p.png)');
        expect(host.querySelectorAll('li')).toHaveLength(2);
        expect(host.querySelector('li strong').textContent).toBe('Ask smoke');
        expect(host.textContent).not.toContain('**');
        expect(host.querySelector('img')).toBeNull();
    });

    it('lists the distinct page ids a reply cites', () => {
        expect(pageRefIds(`a [page:${VISIBLE}] b [page:${HIDDEN}] c [page:${VISIBLE}]`)).toEqual([VISIBLE, HIDDEN]);
    });
});

describe('agentAuthorOf', () => {
    it('reads an agent row, a legacy assistant row and a person row', () => {
        expect(agentAuthorOf({ userId: PERSON, actorType: 'agent', isAgent: true, agentName: 'Alian' })).toEqual({ name: 'Alian', assistant: false });
        expect(agentAuthorOf({ userId: 'alian' })).toEqual({ name: '', assistant: true });
        expect(agentAuthorOf({ userId: PERSON })).toBeNull();
    });
});

describe('automationAuthorOf', () => {
    it('reads a rule comment, an older rule comment without a name, and a person row', () => {
        expect(automationAuthorOf({ userId: 'automation:rule-1', actorType: 'automation', automationName: 'Nudge' })).toEqual({ name: 'Nudge' });
        expect(automationAuthorOf({ userId: 'automation:rule-1' })).toEqual({ name: '' });
        expect(automationAuthorOf({ userId: 'automation' })).toEqual({ name: '' });
        expect(automationAuthorOf({ userId: PERSON })).toBeNull();
        expect(automationAuthorOf({ userId: 'automations-fan' })).toBeNull();
    });
});

describe('Comment thread row for an automation comment', () => {
    const mountRow = (message) => shallowMount(Comment, {
        props: { message: { _id: 'm1', type: 'text', createdAt: 1, updatedAt: 1, reactions: [], sent: false, ...message }, showUser: true, showOptions: false },
    });

    it('shows the rule, not the Ghost User placeholder', async () => {
        const wrapper = mountRow({ userId: 'automation:rule-1', actorType: 'automation', automationName: 'Nudge', message: 'Reminder' });
        await flushPromises();
        expect(wrapper.text()).not.toContain('Ghost User');
        expect(wrapper.find('.show__user').text()).toContain('Nudge');
        expect(wrapper.find('.ah-chip--automation').exists()).toBe(true);
        expect(wrapper.find('.ah-avatar--automation').exists()).toBe(true);
    });

    it('names an older rule comment as an automation', async () => {
        const wrapper = mountRow({ userId: 'automation:rule-1', message: 'Reminder' });
        await flushPromises();
        expect(wrapper.text()).not.toContain('Ghost User');
        expect(wrapper.find('.show__user').text()).toContain('Comments.an_automation');
    });

    it('names the automation when a person replies to it', async () => {
        const wrapper = mountRow({ userId: PERSON, message: 'thanks', hasReply: true, reply_userId: 'automation:rule-1', reply_type: 'text', reply_message: 'Reminder' });
        await flushPromises();
        expect(wrapper.text()).not.toContain('Ghost User');
        expect(wrapper.find('.message_replay').text()).toContain('Comments.an_automation');
    });
});

describe('Comment thread row for an assistant reply', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockResolvedValue({ data: { status: true, data: [{ _id: VISIBLE, title: 'Ask smoke: Requirements' }] } });
    });

    const mountRow = (message) => shallowMount(Comment, {
        props: { message: { _id: 'm1', type: 'text', createdAt: 1, updatedAt: 1, reactions: [], sent: false, ...message }, showUser: true, showOptions: false },
    });

    it('shows an agent reply under the agent, not the Ghost User placeholder', async () => {
        const wrapper = mountRow({ userId: 'alian-agent-id', actorType: 'agent', isAgent: true, agentName: 'Alian', message: 'Hello' });
        await flushPromises();
        expect(wrapper.text()).not.toContain('Ghost User');
        expect(wrapper.find('.show__user').text()).toContain('Alian');
        expect(wrapper.find('.ah-chip--agent').exists()).toBe(true);
    });

    it('shows a legacy @Alian reply as the assistant, and its page citation as a link', async () => {
        const wrapper = mountRow({
            userId: 'alian',
            message: `The pages are:\n\n- **Ask smoke** [page:${VISIBLE}]\n- Other [page:${HIDDEN}]`,
            hasReply: true,
            reply_userId: PERSON,
            reply_type: 'text',
            reply_message: '@[Alian](alian) what pages exist?',
        });
        await flushPromises();
        expect(wrapper.text()).not.toContain('Ghost User');
        expect(wrapper.find('.show__user').text()).toContain('Comments.ai_assistant');
        const anchors = wrapper.findAll('a');
        expect(anchors).toHaveLength(1);
        expect(anchors[0].attributes('href')).toContain(`/pages/${VISIBLE}`);
        expect(anchors[0].text()).toBe('Ask smoke: Requirements');
        expect(wrapper.text()).not.toContain(`[page:`);
        expect(wrapper.text()).not.toContain('**');
    });

    it('names the assistant when a person replies to it', async () => {
        const wrapper = mountRow({ userId: PERSON, message: 'thanks', hasReply: true, reply_userId: 'alian', reply_type: 'text', reply_message: 'The pages are' });
        await flushPromises();
        expect(wrapper.text()).not.toContain('Ghost User');
        expect(wrapper.find('.message_replay').text()).toContain('Comments.ai_assistant');
    });
});
