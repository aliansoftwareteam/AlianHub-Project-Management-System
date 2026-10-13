import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay, toast } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import InstanceStats from '@/views/Settings/Instance/InstanceStats.vue';

const CID_A = '6f00000000000000000000a1';
const CID_B = '6f00000000000000000000b1';
const ALICE = '6f0000000000000000000011';
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (status, code) => Promise.reject({ response: { status, data: { status: false, statusText: 'Refused.', code } } });

const companies = [{ _id: CID_A, Cst_CompanyName: 'Acme', createdAt: '2026-09-01T00:00:00Z' }, { _id: CID_B, Cst_CompanyName: 'Bolt', createdAt: '2026-09-02T00:00:00Z' }];

const mountStats = async (onPost = () => ok({ rows: 3, fields: 5, pseudonym: 'erased-user-0123456789abcdef' })) => {
    apiRequestWithoutCompnay.mockImplementation((type, url, body) => {
        if (type === 'post') return onPost(url, body);
        if (url.endsWith('/stats')) return ok({ version: '14.36.0', companies: 2, users: 3 });
        return ok(companies);
    });
    const wrapper = mount(InstanceStats);
    await flushPromises();
    return wrapper;
};
const find = (wrapper, test) => wrapper.find(`[data-test="${test}"]`);
const posts = () => apiRequestWithoutCompnay.mock.calls.filter(([type]) => type === 'post');

const openFor = async (wrapper, companyId, userId) => {
    await find(wrapper, `redact-open-${companyId}`).trigger('click');
    await find(wrapper, 'redact-user').setValue(userId);
    await find(wrapper, 'redact-form').trigger('submit');
};

describe('redacting a person in a workspace\'s audit rows from the instance console', () => {
    beforeEach(() => {
        apiRequestWithoutCompnay.mockReset();
        toast.success.mockReset();
    });

    it('offers the action on each workspace, next to its audit CSV', async () => {
        const wrapper = await mountStats();
        expect(find(wrapper, `redact-open-${CID_A}`).exists()).toBe(true);
        expect(find(wrapper, `redact-open-${CID_B}`).exists()).toBe(true);
        expect(find(wrapper, 'redact-panel').exists()).toBe(false);
    });

    it('warns plainly and needs the person\'s id typed back before it runs', async () => {
        const wrapper = await mountStats();
        await openFor(wrapper, CID_A, ALICE.toUpperCase());

        const confirm = find(wrapper, 'redact-confirm');
        expect(confirm.text()).toContain('Instance.redact_confirm');
        const button = find(wrapper, 'redact-confirm-button');
        expect(button.attributes('disabled')).toBeDefined();
        await find(wrapper, 'redact-confirm-input').setValue('Acme');
        expect(button.attributes('disabled')).toBeDefined();
        await find(wrapper, 'redact-confirm-input').setValue(ALICE);
        expect(button.attributes('disabled')).toBeUndefined();

        await button.trigger('click');
        await flushPromises();

        expect(posts()).toEqual([['post', `/api/v2/instance/audit/${CID_A}/redact-person`, { userId: ALICE, confirm: ALICE }]]);
        expect(toast.success).toHaveBeenCalledWith('Instance.redact_done');
        expect(find(wrapper, 'redact-confirm').exists()).toBe(false);
    });

    it('refuses an id that is not a user id before asking the server', async () => {
        const wrapper = await mountStats();
        await openFor(wrapper, CID_A, 'someone');
        expect(find(wrapper, 'redact-input-error').text()).toBe('Instance.redact_code_invalid_user_id');
        expect(find(wrapper, 'redact-confirm').exists()).toBe(false);
        expect(posts()).toEqual([]);
    });

    it('says so when another run is already redacting that person', async () => {
        const wrapper = await mountStats(() => refused(409, 'redaction_running'));
        await openFor(wrapper, CID_B, ALICE);
        await find(wrapper, 'redact-confirm-input').setValue(ALICE);
        await find(wrapper, 'redact-confirm-button').trigger('click');
        await flushPromises();
        expect(find(wrapper, 'redact-error').text()).toBe('Instance.redact_code_redaction_running');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('can be cancelled without asking the server', async () => {
        const wrapper = await mountStats();
        await openFor(wrapper, CID_A, ALICE);
        await find(wrapper, 'redact-cancel').trigger('click');
        expect(find(wrapper, 'redact-panel').exists()).toBe(false);
        expect(posts()).toEqual([]);
    });
});
