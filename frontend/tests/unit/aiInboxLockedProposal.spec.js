import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiInbox from '@/views/Ai/AiInbox.vue';

const REFUSAL = 'You cannot approve this: you do not hold the right to make this change yourself. It stays waiting for someone who can.';
const OWNER = 1;
const MEMBER = 3;

const proposal = (over = {}) => ({
    _id: 'pr1', agentName: 'QA', what: 'Raise the priority', why: 'It blocks the launch', status: 'pending',
    changes: [{ label: 'Raise the priority of T-1', reversible: true }], createdAt: new Date().toISOString(), ...over,
});

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed with status code 403'), { response: { data: { status: false, statusText } } }));

const open = async (row, { roleType = MEMBER, onPost = () => Promise.resolve({ data: { status: true, data: {} } }) } = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (type === 'post') return onPost(url);
        if (url.includes('/proposals')) return Promise.resolve({ data: { status: true, data: [row], counts: { waiting: row.locked ? 0 : 1 } } });
        return Promise.resolve({ data: { status: true, data: {} } });
    });
    const wrapper = mount(AiInbox, { global: { plugins: [storeFor(roleType)] } });
    await flushPromises();
    await wrapper.find('.ai-item').trigger('click');
    return wrapper;
};

const posts = () => apiRequest.mock.calls.filter(([type]) => type === 'post').map(([, url]) => url.split('/').pop());
const approveButton = (wrapper) => wrapper.findAll('.ai-actions .ah-btn--primary')[0];

describe('a waiting proposal in the AI Inbox', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    /* [what the row is, the reader's role, the fields the server sends, Approve offered, Decline offered, the note shown] */
    it.each([
        ['one that is the reader\'s to decide', MEMBER, { locked: false, mayDecline: true }, true, true, false],
        ['one whose change the reader may not make by hand', MEMBER, { locked: true, lockedWhy: 'own_rights', mayDecline: false }, false, false, true],
        ['one the reader\'s own agent asked for', MEMBER, { locked: true, lockedWhy: 'own_rights', mayDecline: true }, false, true, true],
        ['one that needs an owner or admin, read by a member', MEMBER, { gate: 'owner_admin', locked: true, lockedWhy: 'owner_admin', mayDecline: false }, false, false, false],
        ['one from a server that sends no word, read by an owner', OWNER, { gate: 'owner_admin' }, true, true, false],
        ['one from a server that sends no word, read by a member', MEMBER, { gate: 'owner_admin' }, false, false, false],
    ])('%s', async (_what, roleType, fields, approves, declines, noted) => {
        const wrapper = await open(proposal(fields), { roleType });
        expect(Boolean(approveButton(wrapper))).toBe(approves);
        expect(wrapper.find('[data-test="decline"]').exists()).toBe(declines);
        expect(wrapper.find('[data-test="rights-locked"]').exists()).toBe(noted);
    });

    it('takes back a proposal the reader may only decline', async () => {
        const wrapper = await open(proposal({ locked: true, lockedWhy: 'own_rights', mayDecline: true }));
        await wrapper.find('[data-test="decline"]').trigger('click');
        await wrapper.find('[data-test="decline-skip"]').trigger('click');
        await flushPromises();
        expect(posts()).toEqual(['decline']);
    });

    it('shows the server\'s reason and keeps the proposal open when an approval is refused', async () => {
        const wrapper = await open(proposal({ locked: false, mayDecline: true }), { onPost: () => refused(REFUSAL) });
        await approveButton(wrapper).trigger('click');
        await flushPromises();
        expect(wrapper.find('.ah-field__error').text()).toBe(REFUSAL);
        expect(Boolean(approveButton(wrapper))).toBe(true);
        expect(wrapper.text()).toContain('Raise the priority');
    });
});
