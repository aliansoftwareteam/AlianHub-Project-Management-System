import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';

const { apiRequest, rows, routeRef, perms } = vi.hoisted(() => ({ apiRequest: vi.fn(), rows: { list: [] }, routeRef: { current: null }, perms: { invite: true } }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => routeRef.current }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({
        commit: vi.fn(),
        getters: {
            'settings/companies': [{ _id: 'company-1', Cst_CompanyName: 'Acme' }],
            'settings/selectedCompany': { planFeature: { users: 10 } },
            'settings/roles': [{ key: 1, name: 'Owner' }, { key: 3, name: 'Member' }],
            'settings/withoutOwnerRoles': [{ key: 3, name: 'Member' }],
            'settings/designations': [],
            'settings/companyUsers': [],
        },
    }),
}));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: (key) => (key === 'settings.settings_invite_member' ? perms.invite : true) }) }));
vi.mock('@/views/Settings/Members/helperMember.js', () => ({ memberData: () => ({ getCompanyUsers: () => rows.list }) }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));

import Members from '@/views/Settings/Members/Members.vue';

const PEOPLE = [
    { _id: 'u1', Employee_Name: 'Asha Rao', userEmail: 'asha@example.com', status: 2, roleType: 3, isDelete: false },
    { _id: 'u2', Employee_Name: 'Ben Ortiz', userEmail: 'ben@example.com', status: 2, roleType: 3, isDelete: false },
];

let wrapper;
let toolbar;
const names = () => wrapper.findAll('.mbv__name').map((node) => node.text());
const searchBox = () => wrapper.find('.mbv__search-input').element;

async function openMembers(query) {
    routeRef.current = reactive({ name: 'Members', params: { cid: 'company-1' }, query });
    wrapper = mount(Members, { attachTo: document.body, global: { stubs: { ShellIcon: true, AppState: true } } });
    await flushPromises();
}

beforeEach(() => {
    rows.list = PEOPLE;
    perms.invite = true;
    apiRequest.mockResolvedValue({ data: { status: false } });
    toolbar = document.createElement('div');
    toolbar.id = 'top_section';
    document.body.appendChild(toolbar);
});
afterEach(() => {
    wrapper?.unmount();
    toolbar.remove();
});

describe('Members opened from a person in the command palette', () => {
    it('searches for the person the link names', async () => {
        await openMembers({ q: 'ben@example.com' });
        expect(searchBox().value).toBe('ben@example.com');
        expect(names()).toEqual(['Ben Ortiz']);
    });

    it('follows the link when Members is already open', async () => {
        await openMembers({});
        expect(names()).toEqual(['Asha Rao', 'Ben Ortiz']);
        routeRef.current.query = { q: 'asha@example.com' };
        await flushPromises();
        expect(searchBox().value).toBe('asha@example.com');
        expect(names()).toEqual(['Asha Rao']);
    });

    it('lists everyone when the link names nobody', async () => {
        await openMembers({ q: ['a', 'b'] });
        expect(searchBox().value).toBe('');
        expect(names()).toEqual(['Asha Rao', 'Ben Ortiz']);
    });
});

describe('Members with nobody to list', () => {
    it('offers to clear a search that matches nobody', async () => {
        await openMembers({ q: 'nobody@example.com' });
        const none = wrapper.find('[data-test="members-no-match"]');
        expect(none.find('svg').attributes('data-illustration')).toBe('search');
        expect(none.find('.empty-state__btn').text()).toBe('Members.clear_search');
        await none.find('.empty-state__btn').trigger('click');
        expect(searchBox().value).toBe('');
        expect(names()).toHaveLength(2);
    });

    it('offers the invite to someone who may invite, and opens the invite form', async () => {
        rows.list = [];
        await openMembers({});
        const empty = () => wrapper.find('[data-test="members-empty"]');
        expect(empty().find('.empty-state__btn').text()).toBe('Members.invite');
        await empty().find('.empty-state__btn').trigger('click');
        expect(wrapper.find('.mbv__invite').exists()).toBe(true);
        expect(empty().find('.empty-state__btn').exists()).toBe(false);
    });

    it('hides the invite from someone who may not', async () => {
        perms.invite = false;
        rows.list = [];
        await openMembers({});
        const empty = wrapper.find('[data-test="members-empty"]');
        expect(empty.text()).toContain('Members.empty_all');
        expect(empty.find('button').exists()).toBe(false);
    });
});
