import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as env from '@/config/env';

const { apiRequest, commit, rows } = vi.hoisted(() => ({ apiRequest: vi.fn(), commit: vi.fn(), rows: { list: [] } }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({
        commit,
        getters: {
            'settings/companies': [{ _id: 'company-1', Cst_CompanyName: 'Acme' }],
            'settings/selectedCompany': { planFeature: { users: 10 } },
            'settings/roles': [{ key: 0, name: 'Guest' }, { key: 1, name: 'Owner' }, { key: 2, name: 'Admin' }, { key: 3, name: 'Member' }],
            'settings/withoutOwnerRoles': [{ key: 0, name: 'Guest' }, { key: 2, name: 'Admin' }, { key: 3, name: 'Member' }],
            'settings/designations': [{ key: 0, name: 'None' }, { key: 7, name: 'Engineer' }, { key: 8, name: 'Designer' }],
            'settings/companyUsers': [],
        },
    }),
}));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/views/Settings/Members/helperMember.js', () => ({ memberData: () => ({ getCompanyUsers: () => rows.list }) }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));

import Members from '@/views/Settings/Members/Members.vue';

const RAW = 'connect ECONNREFUSED 127.0.0.1:9';
const writeText = vi.fn(() => Promise.resolve());
let wrapper;
let toolbar;

const answer = (sendReply) => apiRequest.mockImplementation((method, url) => {
    if (url === env.CHECKSENDINVITATION) return Promise.resolve({ data: { status: true, furtherProceed: true } });
    if (url === env.SEND_INVITATION_EMAIL) return Promise.resolve({ data: sendReply });
    return Promise.resolve({ data: { status: false } });
});

const mountMembers = async () => {
    wrapper = mount(Members, { attachTo: document.body, global: { stubs: { ShellIcon: true, AppState: true } } });
    await flushPromises();
    toolbar.querySelector('button').click();
    await flushPromises();
    return wrapper;
};
const sendButton = () => wrapper.findAll('.mbv__invite button').find((b) => ['Members.invite_send', 'Members.invite_sending'].includes(b.text()));
const typeEmail = async (value) => {
    const input = wrapper.find('.mbv__chip-input');
    await input.setValue(value);
    await input.trigger('input');
};
const sendCalls = () => apiRequest.mock.calls.filter(([, url]) => url === env.SEND_INVITATION_EMAIL);

beforeEach(() => {
    rows.list = [];
    apiRequest.mockReset();
    commit.mockReset();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    toolbar = document.createElement('div');
    toolbar.id = 'top_section';
    document.body.appendChild(toolbar);
});
afterEach(() => {
    if (wrapper) wrapper.unmount();
    wrapper = null;
    toolbar.remove();
});

describe('invite form', () => {
    it('starts with Member picked and the designation optional', async () => {
        answer({ status: true, statusText: 'Invitation_mail_sent_sucessfully', data: { _id: 'row-1', linkId: 'tok', status: 1 } });
        await mountMembers();
        const [roleSelect, designationSelect] = wrapper.findAll('.mbv__invite select');
        expect(roleSelect.element.selectedOptions[0].textContent.trim()).toBe('Member');
        const placeholder = designationSelect.element.selectedOptions[0];
        expect(placeholder.disabled).toBe(false);
        expect(placeholder.textContent).toContain('Members.invite_designation_optional');
    });

    it('keeps Send disabled until an email is valid', async () => {
        answer({ status: true, statusText: 'Invitation_mail_sent_sucessfully', data: { _id: 'row-1', linkId: 'tok', status: 1 } });
        await mountMembers();
        expect(sendButton().attributes('disabled')).toBeDefined();
        await typeEmail('not-an-email');
        expect(sendButton().attributes('disabled')).toBeDefined();
        await typeEmail('sam@acme.test');
        expect(sendButton().attributes('disabled')).toBeUndefined();
    });

    it('sends as Member with no designation when none is picked', async () => {
        answer({ status: true, statusText: 'Invitation_mail_sent_sucessfully', data: { _id: 'row-1', linkId: 'tok', status: 1 } });
        await mountMembers();
        await typeEmail('sam@acme.test');
        await sendButton().trigger('click');
        await flushPromises();
        expect(sendCalls()).toHaveLength(1);
        expect(sendCalls()[0][2]).toEqual(expect.objectContaining({ email: 'sam@acme.test', role: 3, designation: 0 }));
    });

    it('keeps the role meaning and the link hint apart', async () => {
        answer({ status: true, statusText: 'Invitation_mail_sent_sucessfully', data: { _id: 'row-1', linkId: 'tok', status: 1 } });
        await mountMembers();
        const meaning = wrapper.find('.mbv__meaning');
        expect(meaning.text()).not.toMatch(/day to day\.\S/);
        expect(wrapper.findAll('.mbv__meaning > *').length).toBeGreaterThan(1);
    });
});

describe('when invite mail fails', () => {
    const joinLink = 'http://app.test/#/invitation?companyId=company-1-row-9&token=tok-9';

    it('shows a plain message with a Copy link action, never the transport error', async () => {
        answer({ status: false, statusText: RAW, data: { _id: 'row-9', linkId: 'tok-9', userEmail: 'sam@acme.test', status: 1 }, joinLink });
        await mountMembers();
        await typeEmail('sam@acme.test');
        await sendButton().trigger('click');
        await flushPromises();

        expect(document.body.textContent).not.toContain('ECONNREFUSED');
        const notice = wrapper.find('[data-test="invite-mail-failed"]');
        expect(notice.exists()).toBe(true);
        expect(notice.attributes('role')).toBe('alert');
        expect(notice.text()).toContain('Members.invite_mail_failed');
        await notice.findAll('button').find((b) => b.text() === 'Members.copy_link').trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith(joinLink);
    });

    it('builds the join link from the row when the answer has none', async () => {
        answer({ status: false, statusText: 'Invitation_mail_failed', data: { _id: 'row-9', linkId: 'tok-9', userEmail: 'sam@acme.test', status: 1 } });
        await mountMembers();
        await typeEmail('sam@acme.test');
        await sendButton().trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="invite-mail-failed"]').findAll('button').find((b) => b.text() === 'Members.copy_link').trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/#/invitation?companyId=company-1-row-9&token=tok-9`);
    });
});

describe('pending row Copy link', () => {
    it('copies the link with its token', async () => {
        answer({ status: true });
        rows.list = [{ requestId: 'row-5', _id: 'row-5', userEmail: 'kim@acme.test', status: 1, roleType: 3, linkId: 'tok-5' }];
        await mountMembers();
        await wrapper.find('.mbv__dots').trigger('click');
        await wrapper.findAll('.mbv__pop button').find((b) => b.text() === 'Members.copy_link').trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/#/invitation?companyId=company-1-row-5&token=tok-5`);
    });

    it('offers no Copy link for a row without a token', async () => {
        answer({ status: true });
        rows.list = [{ requestId: 'row-6', _id: 'row-6', userEmail: 'lee@acme.test', status: 1, roleType: 3 }];
        await mountMembers();
        await wrapper.find('.mbv__dots').trigger('click');
        expect(wrapper.findAll('.mbv__pop button').map((b) => b.text())).not.toContain('Members.copy_link');
    });
});
