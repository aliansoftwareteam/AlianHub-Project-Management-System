import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { api } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() } }));
vi.mock('@/services', () => api);

const DIRECTORY = { u1: 'Asha Rao', u2: 'Ben Ortiz' };
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({
        getUser: (id) => (DIRECTORY[id] ? { Employee_Name: DIRECTORY[id], Employee_profileImageURL: `${id}.png` } : { Employee_Name: '' }),
    }),
}));

import WhoCanSeeModal from '@/components/molecules/WhoCanSee/WhoCanSeeModal.vue';

const answer = (data) => ({ data: { status: true, data } });
const EXPLANATION = {
    kind: 'project',
    id: 'p1',
    title: 'Launch',
    groups: [
        { reason: 'admin', can: 'manage', userIds: ['u1'], teamNames: [] },
        { reason: 'team', can: 'edit', userIds: ['u2', 'gone'], teamNames: ['Design', 'QA'] },
    ],
    links: [{ kind: 'client_view', fromParent: false, hasPassword: true, expiresAt: null }],
};

let wrapper;
const open = async (props = {}) => {
    wrapper = mount(WhoCanSeeModal, {
        props: { modelValue: true, kind: 'project', itemId: 'p1', title: 'Launch', ...props },
        global: { stubs: { UserProfile: true, ShellIcon: true } },
    });
    await flushPromises();
    return wrapper;
};
const dialog = () => document.body.querySelector('.wcs');
const texts = (selector) => [...dialog().querySelectorAll(selector)].map((el) => el.textContent.trim());

// Braces matter: vitest runs a function returned from beforeEach as a cleanup, and mockReset returns the mock.
beforeEach(() => { api.apiRequest.mockReset(); });
afterEach(() => wrapper?.unmount());

describe('who can see this', () => {
    it('says it is loading until the server answers', async () => {
        let resolve;
        api.apiRequest.mockReturnValue(new Promise((done) => { resolve = done; }));
        await open();
        expect(api.apiRequest).toHaveBeenCalledWith('get', '/api/v2/who-can-see/project/p1');
        expect(dialog().querySelector('.wcs__state').textContent).toContain('WhoCanSee.loading');
        expect(dialog().querySelector('.wcs__group')).toBeNull();

        resolve(answer(EXPLANATION));
        await flushPromises();
        expect(dialog().querySelector('.wcs__state')).toBeNull();
    });

    it('renders each group with its reason, what it can do, and names from the member directory', async () => {
        api.apiRequest.mockResolvedValue(answer(EXPLANATION));
        await open();
        expect(texts('.wcs__group-title')).toEqual(['WhoCanSee.link_client_view', 'WhoCanSee.reason_admin', 'WhoCanSee.reason_team']);
        expect(texts('.wcs__can')).toEqual(['WhoCanSee.can_view', 'WhoCanSee.can_manage', 'WhoCanSee.can_edit']);
        expect(texts('.wcs__name')).toEqual(['Asha Rao', 'Ben Ortiz', 'WhoCanSee.unknown_person']);
        expect(dialog().textContent).toContain('WhoCanSee.link_password');
        expect(dialog().textContent).toContain('WhoCanSee.can_project_edit');
    });

    it('shows the first people of a long group and the rest on request', async () => {
        const userIds = Array.from({ length: 15 }, (_, index) => `m${index}`);
        api.apiRequest.mockResolvedValue(answer({ ...EXPLANATION, links: [], groups: [{ reason: 'everyone', can: 'view', userIds, teamNames: [] }] }));
        await open();
        expect(dialog().querySelectorAll('.wcs__person')).toHaveLength(12);
        dialog().querySelector('.wcs__more').click();
        await flushPromises();
        expect(dialog().querySelectorAll('.wcs__person')).toHaveLength(15);
    });

    it('says so when the answer is refused or the request fails', async () => {
        api.apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Not found.' } });
        await open();
        expect(dialog().querySelector('.wcs__state').textContent).toContain('WhoCanSee.failed');
        wrapper.unmount();

        api.apiRequest.mockRejectedValue(new Error('network'));
        await open();
        expect(dialog().querySelector('.wcs__state').textContent).toContain('WhoCanSee.failed');
        expect(dialog().querySelector('.wcs__group')).toBeNull();
    });

    it('closes from the close button and on Escape, and asks nothing while closed', async () => {
        api.apiRequest.mockResolvedValue(answer(EXPLANATION));
        await open({ modelValue: false });
        expect(dialog()).toBeNull();
        expect(api.apiRequest).not.toHaveBeenCalled();

        await wrapper.setProps({ modelValue: true });
        await flushPromises();
        dialog().querySelector('.wcs__icon').click();
        dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(wrapper.emitted('update:modelValue')).toEqual([[false], [false]]);
    });
});
