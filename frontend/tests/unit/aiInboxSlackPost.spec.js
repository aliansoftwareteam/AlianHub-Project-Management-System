import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiInbox from '@/views/Ai/AiInbox.vue';

const TEXT = 'Version 14.36 is out.\nThanks all.';
const POST = 'slack.message.post';
const botPost = (text = TEXT) => ({ action: POST, label: 'Post to #releases in Slack', reversible: false, params: { channelId: 'C0RELEASES1', channelName: 'releases', text } });
const ownPost = (text = TEXT) => ({
    action: POST, label: '#releases', reversible: false, params: { channel: 'releases', text, connectionId: 'c1' },
    card: { provider: 'slack', tool: POST, label: 'Connectors.tool.slackMessagePost', target: '#releases', title: '', text, attachments: [], fields: [{ param: 'text', label: 'Connectors.card.text', long: true }] },
});
const comment = { action: 'task.comment', label: 'Comment on T-1', reversible: true, params: { taskId: 't1', body: 'Done' } };
const proposal = (over = {}) => ({ _id: 'pr1', agentName: 'Release notes', what: 'Tell the team', why: 'The release closed', status: 'pending', gate: 'connection_owner', connectionOwner: 'u1', changes: [comment, ownPost()], createdAt: new Date().toISOString(), ...over });

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const openCard = async (row, { tab, approved } = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (type === 'post' && url.endsWith('/approve')) return Promise.resolve({ data: { status: true, data: approved } });
        if (url.includes('/proposals')) return Promise.resolve({ data: { status: true, data: [row], counts: { waiting: 1, doneByAi: 1 } } });
        return Promise.resolve({ data: { status: true, data: {} } });
    });
    const wrapper = mount(AiInbox, { global: { plugins: [storeFor(1)] } });
    await flushPromises();
    if (tab !== undefined) {
        await wrapper.findAll('.ah-tab')[tab].trigger('click');
        await flushPromises();
    }
    await wrapper.find('.ai-item').trigger('click');
    return wrapper;
};

const DONE_TAB = 3;
const DECLINED_TAB = 4;

describe('a Slack message on the AI Inbox card', () => {
    beforeEach(() => { apiRequest.mockReset(); toast.success.mockReset(); toast.error.mockReset(); });

    it('shows a message on the person\'s own connection once, on its connector card', async () => {
        const wrapper = await openCard(proposal());
        expect(wrapper.findAll('[data-test="connector-card"]')).toHaveLength(1);
        expect(wrapper.find('[data-test="connector-card-target"]').text()).toBe('#releases');
        expect(wrapper.find('[data-test="slack-post"]').exists()).toBe(false);
    });

    it('still shows the channel and exact text of a message the retired bot was asked to post, under that change only', async () => {
        const wrapper = await openCard(proposal({ status: 'declined', gate: 'owner_admin', changes: [comment, botPost()] }), { tab: DECLINED_TAB });
        const previews = wrapper.findAll('[data-test="slack-post"]');
        expect(previews).toHaveLength(1);
        expect(previews[0].find('[data-test="slack-post-channel"]').text()).toBe('#releases C0RELEASES1');
        expect(previews[0].find('[data-test="slack-post-text"]').element.textContent).toBe(TEXT);
        expect(previews[0].find('[data-test="slack-post-result"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="connector-card"]').exists()).toBe(false);
    });

    it('shows each message the bot posted its own result', async () => {
        const wrapper = await openCard(proposal({
            status: 'approved',
            gate: 'owner_admin',
            changes: [botPost('One'), comment, botPost('Two')],
            delivery: [{ action: POST, ok: true, ts: '1727780000.000100' }, { action: POST, ok: false, error: 'slack: rate_limited, retry after 30s' }],
        }), { tab: DONE_TAB });
        const previews = wrapper.findAll('[data-test="slack-post"]');
        expect(previews.map((p) => p.find('[data-test="slack-post-text"]').text())).toEqual(['One', 'Two']);
        expect(previews.map((p) => p.find('[data-test="slack-post-result"]').classes().includes('ah-field__error'))).toEqual([false, true]);
    });

    it('says so at once when an approved message could not be posted, instead of reporting success', async () => {
        const wrapper = await openCard(proposal({ changes: [ownPost()] }), { approved: { applied: [{ action: POST, ok: false, error: 'slack: invalid_auth' }] } });
        await wrapper.find('.ai-actions .ah-btn--primary').trigger('click');
        await flushPromises();
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error.mock.calls[0][0]).toContain('applied_with_failures');
    });

    it('reports success when every change was applied', async () => {
        const wrapper = await openCard(proposal({ changes: [ownPost()] }), { approved: { applied: [{ action: POST, ok: true, result: 'Posted to #releases (message 1727780000.000100).' }] } });
        await wrapper.find('.ai-actions .ah-btn--primary').trigger('click');
        await flushPromises();
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledTimes(1);
    });
});
