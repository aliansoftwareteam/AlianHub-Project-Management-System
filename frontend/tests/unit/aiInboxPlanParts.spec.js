import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import en from '@/locales/en';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiInbox from '@/views/Ai/AiInbox.vue';

const MEMBER = 3;
const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const plan = (over = {}) => ({
    kind: 'setup',
    title: 'Website',
    lines: [
        { kind: 'place', project: 'Website', list: '' },
        { kind: 'newStatuses', names: ['In Review', 'Blocked'], picks: ['statuses:0', 'statuses:1'] },
        { kind: 'newLists', names: ['Backlog'], picks: ['lists:0'] },
        { kind: 'planTask', name: 'Write the brief', list: 'Backlog', status: '', assignee: '', hidden: 0, due: '', pick: 'tasks:0' },
    ],
    needs: { 'tasks:0': ['lists:0'] },
    ...over,
});
const forMember = () => plan({ locked: ['statuses:1'], lockedWhy: { 'statuses:1': 'owner_admin' } });
const setup = (preview) => ({ action: 'project.setup', params: { projectId: 'p-web' }, label: 'Set up the project', reversible: true, ...(preview ? { preview } : {}) });
const proposal = (over = {}) => ({
    _id: 'pr1', agentName: 'Claude', what: 'Set up the project', why: 'Asked for in chat', status: 'pending', locked: false, mayDecline: true,
    changes: [setup(plan())], createdAt: new Date().toISOString(), ...over,
});

let wrapper;
const open = async (row, answer = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (type === 'post') return Promise.resolve({ data: { status: true, data: { applied: [{ ok: true }], ...answer } } });
        if (url.includes('/proposals')) return Promise.resolve({ data: { status: true, data: [row], counts: { waiting: row.locked ? 0 : 1 } } });
        return Promise.resolve({ data: { status: true, data: {} } });
    });
    wrapper = mount(AiInbox, { attachTo: document.body, global: { plugins: [storeFor(MEMBER), i18n()] } });
    await flushPromises();
    await wrapper.find('.ai-item').trigger('click');
    return wrapper;
};
const sent = () => apiRequest.mock.calls.filter(([type]) => type === 'post').map(([, url, body]) => [url.split('/').pop(), body]);
const box = (key) => wrapper.find(`[data-test="intent-pick"][data-pick="${key}"]`);
const approve = async () => { await wrapper.findAll('.ai-actions .ah-btn--primary')[0].trigger('click'); await flushPromises(); };

beforeEach(() => { apiRequest.mockReset(); Object.values(toast).forEach((spy) => spy.mockReset()); });
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('a waiting plan in the AI Inbox', () => {
    it('is drawn with the card the Inbox draws it with, a ticked box on each part', async () => {
        await open(proposal());
        expect(wrapper.findAll('[data-test="change-card"]')).toHaveLength(1);
        expect(wrapper.find('.ai-change__label').exists()).toBe(false);
        const boxes = wrapper.findAll('[data-test="intent-pick"]');
        expect(boxes.map((el) => el.attributes('data-pick'))).toEqual(['statuses:0', 'statuses:1', 'lists:0', 'tasks:0']);
        expect(boxes.every((el) => el.element.checked && !el.element.disabled)).toBe(true);
    });

    it('is approved whole while every part is ticked', async () => {
        await open(proposal());
        await approve();
        expect(sent()).toEqual([['approve', {}]]);
    });

    it('is approved with the places of the parts that stayed ticked, and with them what each one needs', async () => {
        await open(proposal());
        await box('lists:0').trigger('change');
        expect(box('tasks:0').element.checked).toBe(false);
        await approve();
        expect(sent()).toEqual([['approve', { parts: { 0: { statuses: [0, 1], lists: [], tasks: [] } } }]]);
    });

    it('marks a part the reader may not approve, holds it unticked and leaves it out of what is sent', async () => {
        await open(proposal({ changes: [setup(forMember())] }), { left: { waiting: ['pr2'], retry: [] } });
        expect(box('statuses:1').element.checked).toBe(false);
        expect(box('statuses:1').element.disabled).toBe(true);
        expect(wrapper.find('[data-test="intent-pick-locked"]').text()).toBe('An owner or admin approves this part');
        await approve();
        expect(sent()).toEqual([['approve', { parts: { 0: { statuses: [0], lists: [0], tasks: [0] } } }]]);
        expect(toast.info).toHaveBeenCalledWith('What you may not approve stays waiting for someone who may.', expect.anything());
    });

    it('says nothing more after an approval that left nothing behind', async () => {
        await open(proposal());
        await approve();
        expect(toast.info).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it('offers no box on a plan the reader may not approve', async () => {
        await open(proposal({ locked: true, lockedWhy: 'owner_admin', mayDecline: false }));
        expect(wrapper.findAll('[data-test="change-card"]')).toHaveLength(1);
        expect(wrapper.findAll('[data-test="intent-pick"]')).toHaveLength(0);
        expect(wrapper.text()).toContain('In Review, Blocked');
    });

    it('offers no box while changes are being dropped, and sends the changes kept as they were filed', async () => {
        await open(proposal({ changes: [setup(plan()), { action: 'task.comment', params: { taskId: 't1', body: 'Started' }, label: 'Comment on T-1', reversible: true }] }));
        expect(wrapper.findAll('[data-test="intent-pick"]')).toHaveLength(4);
        await wrapper.find('[data-test="edit-then-approve"]').trigger('click');
        expect(wrapper.findAll('[data-test="intent-pick"]')).toHaveLength(0);
        await wrapper.findAll('.ai-change .ah-btn--ghost')[1].trigger('click');
        await wrapper.find('[data-test="edit-then-approve"]').trigger('click');
        expect(wrapper.findAll('[data-test="intent-pick"]')).toHaveLength(0);
        await approve();
        expect(sent()).toEqual([['approve', { changes: [{ action: 'project.setup', params: { projectId: 'p-web' }, label: 'Set up the project', reversible: true }] }]]);
    });

    it('keeps a change that came without a card as one line', async () => {
        await open(proposal({ changes: [setup()] }));
        expect(wrapper.find('[data-test="change-card"]').exists()).toBe(false);
        expect(wrapper.find('.ai-change__label').exists()).toBe(true);
        await approve();
        expect(sent()).toEqual([['approve', {}]]);
    });
});

describe('parts of a plan that were not made the first time', () => {
    const again = (over = {}) => proposal({ retryBy: 'user-1', retryWhy: 'The server was busy.', changes: [setup(plan({ lines: [{ kind: 'newLists', names: ['Backlog'], picks: ['lists:0'] }], needs: {} }))], ...over });

    it('are offered to the person who approved, with why they were not made', async () => {
        await open(again());
        expect(wrapper.find('[data-test="retry-note"]').text()).toBe('This was not made the first time, so you can try it once more. Why it was not made: The server was busy.');
        expect(wrapper.find('[data-test="retry-locked"]').exists()).toBe(false);
        await approve();
        expect(sent()).toEqual([['approve', {}]]);
    });

    it('are shown to anyone else as waiting for that person, with no Approve', async () => {
        await open(again({ locked: true, lockedWhy: 'first_approver', mayDecline: true }));
        expect(wrapper.find('[data-test="retry-locked"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="retry-note"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="rights-locked"]').exists()).toBe(false);
        expect(wrapper.findAll('.ai-actions .ah-btn--primary')).toHaveLength(0);
        expect(wrapper.find('[data-test="decline"]').exists()).toBe(true);
    });

    it('are named after an approval that left some, beside what could not be carried out', async () => {
        await open(proposal(), { applied: [{ ok: true, result: { notMade: [{ part: 'lists', name: 'Backlog', error: 'The server was busy.' }] } }], left: { waiting: [], retry: ['pr3'] } });
        await approve();
        expect(toast.error).toHaveBeenCalledWith('Approved, but 1 change(s) could not be carried out: Backlog: The server was busy.', expect.anything());
        expect(toast.info).toHaveBeenCalledWith('What was not made is listed again, so you can try it once more.', expect.anything());
        expect(toast.success).not.toHaveBeenCalled();
    });
});
