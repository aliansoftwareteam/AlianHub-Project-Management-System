import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import en from '@/locales/en';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiInbox from '@/views/Ai/AiInbox.vue';
import ConnectorWriteCard from '@/views/Inbox/ConnectorWriteCard.vue';

config.global.plugins[0].global.setLocaleMessage('en', en);

const KEY = 'fake.notes.create';
const cardOf = (title) => ({ provider: 'fake', tool: KEY, label: 'Connectors.tool.fakeNotesCreate', target: 'Board', title, text: 'Approved.', attachments: [], fields: [{ param: 'title', label: 'Connectors.card.title' }] });
const write = (title = 'Minutes') => ({ action: KEY, label: title, reversible: false, params: { title, connectionId: 'c1' }, card: cardOf(title) });
const proposal = (over = {}) => ({ _id: 'pr1', agentName: 'Digest', what: 'Save the minutes', why: 'The meeting ended', status: 'pending', gate: 'connection_owner', connectionOwner: 'u1', changes: [write()], createdAt: new Date().toISOString(), ...over });
const storeFor = () => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });

const DONE_TAB = 3;
const approvals = () => apiRequest.mock.calls.filter(([type, url]) => type === 'post' && url.endsWith('/approve'));

const openCard = async (row, { tab, approved } = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (type === 'post' && url.endsWith('/approve')) return Promise.resolve({ data: { status: true, data: approved } });
        if (url.includes('/proposals')) return Promise.resolve({ data: { status: true, data: [row], counts: { waiting: 1, doneByAi: 1 } } });
        return Promise.resolve({ data: { status: true, data: {} } });
    });
    const wrapper = mount(AiInbox, { global: { plugins: [storeFor()] } });
    await flushPromises();
    if (tab !== undefined) {
        await wrapper.findAll('.ah-tab')[tab].trigger('click');
        await flushPromises();
    }
    await wrapper.find('.ai-item').trigger('click');
    return wrapper;
};

describe('a write to a connected app on the AI Inbox card', () => {
    beforeEach(() => { apiRequest.mockReset(); Object.values(toast).forEach((fn) => fn.mockReset()); });

    it('shows the card, and not the owner-or-admin note its gate is not about', async () => {
        const wrapper = await openCard(proposal());
        expect(wrapper.find('[data-test="connector-card-text"]').text()).toBe('Approved.');
        expect(wrapper.text()).not.toContain(en.Ai.gate_note);
        expect(wrapper.text()).not.toContain(en.Ai.gate_locked);
    });

    it('for anyone else says it is the owner\'s, with no Approve', async () => {
        const wrapper = await openCard(proposal({ locked: true, lockedWhy: 'connection_owner', mayDecline: true }));
        expect(wrapper.find('[data-test="owner-locked"]').exists()).toBe(true);
        expect(wrapper.find('.ai-actions .ah-btn--primary').exists()).toBe(false);
        expect(wrapper.find('[data-test="decline"]').exists()).toBe(true);
    });

    it('shows each sent write its own result', async () => {
        const wrapper = await openCard(proposal({
            status: 'approved',
            changes: [write('One'), write('Two')],
            delivery: [{ action: KEY, ok: true, answer: 'Saved as note 1' }, { action: KEY, ok: false, error: 'the provider said no' }],
        }), { tab: DONE_TAB });
        const results = wrapper.findAll('[data-test="connector-card-result"]');
        expect(results.map((r) => r.classes().includes('ah-field__error'))).toEqual([false, true]);
        expect(results[0].text()).toContain('Saved as note 1');
        expect(results[1].text()).toContain('the provider said no');
    });

    it('offers no edit on a write an MCP client filed, which the server would refuse', async () => {
        const wrapper = await openCard(proposal({ source: 'mcp' }));
        expect(wrapper.find('[data-test="edit-then-approve"]').exists()).toBe(false);
    });

    it('promises nothing about sending on a card no longer waiting', () => {
        const card = mount(ConnectorWriteCard, { props: { change: write(), waiting: false } });
        expect(card.text()).not.toContain(en.Connectors.approval.note);
    });

    it('names the revision it read when approving', async () => {
        const wrapper = await openCard(proposal({ revision: 2 }), { approved: { applied: [{ action: KEY, ok: true }] } });
        await wrapper.find('.ai-actions .ah-btn--primary').trigger('click');
        await flushPromises();
        expect(approvals()[0][2]).toMatchObject({ revision: 2 });
    });

    it('checks the edit on Done instead of leaving the old card up', async () => {
        const wrapper = await openCard(proposal(), { approved: { applied: [], reshown: true, proposal: { changes: [write('Moved')], revision: 1 } } });
        await wrapper.find('[data-test="edit-then-approve"]').trigger('click');
        await wrapper.find('[data-test="connector-field-title"]').setValue('Moved');
        await wrapper.find('[data-test="edit-then-approve"]').trigger('click');
        await flushPromises();
        expect(approvals()).toHaveLength(1);
        expect(wrapper.find('[data-test="connector-card-title"]').text()).toBe('Moved');
    });

    it('checks an edit and shows the new card, with nothing reported as sent', async () => {
        const wrapper = await openCard(proposal(), { approved: { applied: [], reshown: true, proposal: { changes: [write('Moved')] } } });
        await wrapper.find('[data-test="edit-then-approve"]').trigger('click');
        await wrapper.find('[data-test="connector-field-title"]').setValue('Moved');
        await wrapper.find('.ai-actions .ah-btn--primary').trigger('click');
        await flushPromises();
        const body = approvals()[0][2];
        expect(body.changes[0].params).toEqual({ title: 'Moved', connectionId: 'c1' });
        expect(body.changes[0].card).toBeUndefined();
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.info).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[data-test="connector-card-title"]').text()).toBe('Moved');
    });
});
