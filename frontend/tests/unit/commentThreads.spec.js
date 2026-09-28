import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const { apiRequest, store, users, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    store: { getters: { 'settings/companyUserDetail': { roleType: 3 } } },
    users: {},
    route: { query: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => false },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text, debounce: (fn) => fn, makeUniqueId: () => 'u1' }),
    useGetterFunctions: () => ({ getUser: (id) => users[id] || { Employee_Name: 'Someone' } }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import { applyCommentEvent, replyCountOf, threadStore } from '@/composable/commentThreads';
import CommentThread from '@/components/molecules/CommentThread/CommentThread.vue';
import CommentAssignment from '@/components/molecules/CommentThread/CommentAssignment.vue';
import TaskActionItems from '@/components/organisms/TaskDetailOverlay/TaskActionItems.vue';
import AssignedCommentsCard from '@/components/molecules/Home/AssignedCommentsCard.vue';
import Inbox from '@/views/Inbox/Inbox.vue';

const ME = 'user-1';
const ADA = '64b000000000000000000001';
const BO = '64b000000000000000000002';
const PARENT = '64c000000000000000000001';
const TASK = '64d000000000000000000001';
const people = [{ id: ME, name: 'Me' }, { id: ADA, name: 'Ada' }, { id: BO, name: 'Bo' }];

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const parent = (extra = {}) => ({ _id: PARENT, userId: ADA, projectId: '64e000000000000000000001', sprintId: '64f000000000000000000001', taskId: TASK, message: 'Check the numbers', type: 'text', replyCount: 2, ...extra });
const reply = (id, extra = {}) => ({ _id: id, parentId: PARENT, userId: BO, taskId: TASK, message: `reply ${id}`, type: 'text', createdAt: '2026-09-24T09:00:00.000Z', ...extra });
const calls = (method, part) => apiRequest.mock.calls.filter(([m, url]) => m === method && String(url).includes(part));

const resetStore = () => ['replies', 'loaded', 'added', 'versions'].forEach((key) => {
    Object.keys(threadStore[key]).forEach((id) => { delete threadStore[key][id]; });
});

let wrapper;
const mountWith = async (component, props, provide = {}) => {
    wrapper = mount(component, {
        props,
        attachTo: document.getElementById('app'),
        global: { stubs: { UserProfile: true, ShellIcon: true }, provide: { $userId: ref(ME), $companyId: ref('company-1'), $clientWidth: ref(1280), ...provide } },
    });
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
    resetStore();
    store.getters['settings/companyUserDetail'] = { roleType: 3 };
    users[ADA] = { Employee_Name: 'Ada' };
    users[BO] = { Employee_Name: 'Bo' };
    apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get' && url.includes('/replies')) return ok([reply('r1'), reply('r2')]);
        if (method === 'post' && url === '/api/v1/comments') return ok({ ...body.data, _id: 'r3', parentId: PARENT, userId: ME, taskId: TASK });
        if (method === 'post' && url.endsWith('/assign')) return ok({ ...parent(), assigneeId: body.assigneeId, assignedBy: ME, resolved: false });
        if (method === 'post' && url.endsWith('/resolve')) return ok({ ...parent(), assigneeId: ME, assignedBy: ADA, resolved: body.resolved });
        return ok([]);
    });
});
afterEach(() => { if (wrapper) wrapper.unmount(); wrapper = null; });

describe('a comment thread', () => {
    it('starts collapsed with the reply count and expands on demand', async () => {
        await mountWith(CommentThread, { message: parent(), people });
        const toggle = wrapper.find('[data-test="thread-toggle"]');
        expect(toggle.element.tagName).toBe('BUTTON');
        expect(toggle.attributes('aria-expanded')).toBe('false');
        expect(toggle.text()).toBe('Comments.replies_count');
        expect(wrapper.findAll('[data-test="reply"]')).toHaveLength(0);
        expect(calls('get', '/replies')).toHaveLength(0);

        await toggle.trigger('click');
        await flushPromises();
        expect(calls('get', `/replies?parentId=${PARENT}`)).toHaveLength(1);
        expect(toggle.attributes('aria-expanded')).toBe('true');
        expect(wrapper.find(`#${toggle.attributes('aria-controls')}`).exists()).toBe(true);
        expect(wrapper.findAll('[data-test="reply"]').map((row) => row.text())).toEqual([
            expect.stringContaining('reply r1'), expect.stringContaining('reply r2'),
        ]);

        await toggle.trigger('click');
        expect(wrapper.findAll('[data-test="reply"]')).toHaveLength(0);
    });

    it('sends a reply to the parent from the keyboard', async () => {
        await mountWith(CommentThread, { message: parent({ replyCount: 0 }), people });
        expect(wrapper.find('[data-test="thread-toggle"]').exists()).toBe(false);
        await wrapper.find('[data-test="reply-open"]').trigger('click');
        await flushPromises();
        const input = wrapper.find('[data-test="reply-input"]');
        expect(document.activeElement).toBe(input.element);
        await input.setValue('Looks <fine>');
        await input.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        const [, , body] = calls('post', '/api/v1/comments')[0];
        expect(body.data).toMatchObject({ parentId: PARENT, message: 'Looks &lt;fine&gt;', objId: { taskId: TASK } });
        expect(wrapper.findAll('[data-test="reply"]').map((row) => row.text()).join(' ')).toContain('Looks');
        expect(input.element.value).toBe('');
    });

    it('counts replies that arrive while it is collapsed, and keeps them out of the main list', () => {
        const top = parent({ replyCount: 1 });
        expect(applyCommentEvent({ _id: 'top', taskId: TASK })).toBe(false);
        expect(applyCommentEvent(reply('r9'), { inserted: true })).toBe(true);
        expect(applyCommentEvent(reply('r9'), { inserted: true })).toBe(true);
        expect(replyCountOf(top)).toBe(2);
    });
});

describe('assigning and resolving', () => {
    it('shows the assignee and lets the assignee resolve and reopen', async () => {
        await mountWith(CommentAssignment, { comment: parent({ assigneeId: ME, assignedBy: ADA, resolved: false }), people });
        expect(wrapper.find('[data-test="assigned-to"]').text()).toBe('Comments.assigned_to');
        await wrapper.find('[data-test="resolve"]').trigger('click');
        await flushPromises();
        expect(calls('post', '/resolve')[0][2]).toEqual({ id: PARENT, resolved: true });
        expect(wrapper.find('[data-test="resolve"]').text()).toBe('Comments.reopen');
        expect(wrapper.find('[data-test="assign"]').exists()).toBe(false);
    });

    it('offers no resolve to a member who is not on the comment', async () => {
        await mountWith(CommentAssignment, { comment: parent({ assigneeId: BO, assignedBy: ADA }), people });
        expect(wrapper.find('[data-test="resolve"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="assign"]').exists()).toBe(false);
        store.getters['settings/companyUserDetail'] = { roleType: 2 };
        wrapper.unmount();
        await mountWith(CommentAssignment, { comment: parent({ assigneeId: BO, assignedBy: ADA }), people });
        expect(wrapper.find('[data-test="resolve"]').exists()).toBe(true);
    });

    it('assigns through a searchable listbox of people', async () => {
        await mountWith(CommentAssignment, { comment: parent(), people });
        const trigger = wrapper.find('[data-test="assign"]').element.closest('button');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        trigger.click();
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const list = document.querySelector('#my-dropdown [role="listbox"]');
        expect(list).not.toBeNull();
        const search = document.querySelector('#my-dropdown input[type="search"]');
        search.value = 'bo';
        search.dispatchEvent(new Event('input'));
        await flushPromises();
        const options = [...list.querySelectorAll('[role="option"]')];
        expect(options.map((o) => o.textContent.trim())).toEqual(['Bo']);
        options[0].click();
        await flushPromises();
        expect(calls('post', '/assign')[0][2]).toEqual({ id: PARENT, assigneeId: BO });
        expect(wrapper.find('[data-test="assigned-to"]').exists()).toBe(true);
    });
});

describe('Action items on the task panel', () => {
    const task = { _id: TASK, ProjectID: '64e000000000000000000001', sprintId: '64f000000000000000000001' };

    it('lists the open assigned comments with their count and opens one', async () => {
        apiRequest.mockImplementation((method, url) => (url.includes('/action-items') ? ok([parent({ assigneeId: BO }), parent({ _id: 'c2', message: 'Second', assigneeId: ADA })]) : ok([])));
        await mountWith(TaskActionItems, { task });
        expect(calls('get', `/action-items?projectId=${task.ProjectID}&sprintId=${task.sprintId}&taskId=${TASK}`)).toHaveLength(1);
        expect(wrapper.find('h2').text()).toBe('TaskPanel.action_items');
        expect(wrapper.findAll('[data-test="action-item"]')).toHaveLength(2);
        await wrapper.find('[data-test="action-item"] button').trigger('click');
        expect(wrapper.emitted('open')[0][0]._id).toBe(PARENT);
    });

    it('stays hidden when nothing is assigned', async () => {
        await mountWith(TaskActionItems, { task });
        expect(wrapper.find('[data-test="action-items"]').exists()).toBe(false);
    });
});

describe('Home card', () => {
    it('lists my open assigned comments, opens their task and resolves them', async () => {
        apiRequest.mockImplementation((method, url, body) => {
            if (url.includes('/assigned-to-me')) return ok([{ ...parent({ assigneeId: ME, assignedBy: ADA }), taskName: 'Launch', taskKey: 'AH-1' }]);
            if (url.endsWith('/resolve')) return ok({ ...parent(), resolved: body.resolved });
            return ok([]);
        });
        await mountWith(AssignedCommentsCard, {});
        const rows = wrapper.findAll('[data-test="assigned-comment"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].text()).toContain('AH-1 · Launch');
        await rows[0].find('button').trigger('click');
        expect(wrapper.emitted('open')[0][0]).toEqual({ _id: TASK, ProjectID: parent().projectId, sprintId: parent().sprintId });
        await rows[0].find('.hc-assigned__resolve').trigger('click');
        await flushPromises();
        expect(calls('post', '/resolve')[0][2]).toEqual({ id: PARENT, resolved: true });
        expect(wrapper.findAll('[data-test="assigned-comment"]')).toHaveLength(0);
    });
});

describe('Inbox filter', () => {
    it('has an Assigned comments kind that asks the server for it', async () => {
        apiRequest.mockImplementation((method, url) => {
            if (url.endsWith('/counts')) return ok({ primary: 1 });
            const kind = new URL(url, 'http://x').searchParams.get('kind');
            const items = kind === 'assigned'
                ? [{ sourceType: 'notification', sourceId: 'n1', key: 'comment_assigned', kind: 'assigned', message: 'Check the numbers', actorId: ADA, unread: true, createdAt: '2026-09-24T09:00:00.000Z', duplicateIds: [] }]
                : [];
            return ok({ items, approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
        });
        await mountWith(Inbox, {});
        const button = wrapper.findAll('.ibx__navitem--kind').find((b) => b.text() === 'Inbox.kind_assigned');
        expect(button).toBeTruthy();
        await button.trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.some(([m, url]) => m === 'get' && url.includes('kind=assigned'))).toBe(true);
        expect(button.attributes('aria-pressed')).toBe('true');
        expect(wrapper.find('.ibx__card').text()).toContain('Inbox.assigned_you_comment');
    });
});
