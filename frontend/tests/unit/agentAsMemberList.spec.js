import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';

const { apiRequest, rows } = vi.hoisted(() => ({ apiRequest: vi.fn(), rows: { list: [] } }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => reactive({ name: 'Members', params: { cid: 'company-1' }, query: {} }) }));
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
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/views/Settings/Members/helperMember.js', () => ({ memberData: () => ({ getCompanyUsers: () => rows.list }) }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));

import Members from '@/views/Settings/Members/Members.vue';
import en from '@/locales/en';

const CONNECTED = '/api/v2/agents/connected';
const PEOPLE = [
    { _id: 'u1', userId: 'u1', Employee_Name: 'Asha Rao', userEmail: 'asha@example.com', status: 2, roleType: 3, isDelete: false },
    { _id: 'u2', userId: 'u2', Employee_Name: 'Ben Ortiz', userEmail: 'ben@example.com', status: 2, roleType: 3, isDelete: false },
    { _id: 'u3', userId: 'u3', Employee_Name: 'Cleo Park', userEmail: 'cleo@example.com', status: 2, roleType: 3, isDelete: true },
];
const agentOf = (ownerId, ownerName, over = {}) => ({
    ownerId, name: 'Claude', ownerName, shownAs: `Claude, for ${ownerName}`, lastWorkedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), mine: false, ...over,
});

let wrapper;
let toolbar;
const answer = (agents) => apiRequest.mockImplementation((method, url) => Promise.resolve(
    url === CONNECTED ? { data: { status: true, data: agents } } : { data: { status: false } },
));
const open = async () => {
    wrapper = mount(Members, { attachTo: document.body, global: { stubs: { ShellIcon: true, AppState: true } } });
    await flushPromises();
};
const agentRows = () => wrapper.findAll('[data-test="member-agent"]');
const personRows = () => wrapper.findAll('.mbv__name').map((node) => node.text());

beforeEach(() => {
    rows.list = PEOPLE;
    apiRequest.mockReset();
    toolbar = document.createElement('div');
    toolbar.id = 'top_section';
    document.body.appendChild(toolbar);
});
afterEach(() => {
    wrapper?.unmount();
    toolbar.remove();
});

describe('a connected AI in the member list', () => {
    it('sits under the person who connected it, marked as an agent, with who connected it and when it last worked', async () => {
        answer([agentOf('u1', 'Asha Rao')]);
        await open();
        expect(apiRequest).toHaveBeenCalledWith('get', CONNECTED);
        expect(agentRows()).toHaveLength(1);
        const row = agentRows()[0];
        expect(row.text()).toContain('Claude');
        expect(row.text()).toContain('Members.agent_tag');
        expect(row.text()).toContain('Members.agent_connected_by');
        expect(row.text()).toContain('Members.agent_last_worked');
        expect(row.text()).toContain('Members.agent_no_seat');
        expect(row.element.previousElementSibling.textContent).toContain('Asha Rao');
        expect(row.find('select').exists()).toBe(false);
        expect(row.find('button').exists()).toBe(false);
    });

    it('is not a member: the seat count, the tab counts and the people listed stay as they were', async () => {
        answer([]);
        await open();
        const seats = toolbar.querySelector('.mbv__seats').textContent;
        const tabs = wrapper.findAll('.mbv__tab-n').map((node) => node.text());
        wrapper.unmount();

        answer([agentOf('u1', 'Asha Rao'), agentOf('u2', 'Ben Ortiz')]);
        await open();
        expect(agentRows()).toHaveLength(2);
        expect(toolbar.querySelector('.mbv__seats').textContent).toBe(seats);
        expect(wrapper.findAll('.mbv__tab-n').map((node) => node.text())).toEqual(tabs);
        expect(tabs).toEqual(['2', '1']);
        expect(personRows()).toEqual(['Asha Rao', 'Ben Ortiz']);
    });

    it('follows its person through the search, and is never shown for a removed person or one not listed', async () => {
        answer([agentOf('u1', 'Asha Rao'), agentOf('u3', 'Cleo Park'), agentOf('u9', 'Nobody Here')]);
        await open();
        expect(agentRows()).toHaveLength(1);
        await wrapper.find('.mbv__search-input').setValue('ben');
        expect(personRows()).toEqual(['Ben Ortiz']);
        expect(agentRows()).toHaveLength(0);
        await wrapper.find('.mbv__search-input').setValue('asha');
        expect(agentRows()).toHaveLength(1);
        await wrapper.find('.mbv__search-input').setValue('');
        await wrapper.findAll('.ah-tab')[1].trigger('click');
        expect(personRows()).toEqual(['Cleo Park']);
        expect(agentRows()).toHaveLength(0);
    });

    it('shows the people alone when the list of agents cannot be read', async () => {
        apiRequest.mockImplementation(() => Promise.reject(new Error('network down')));
        await open();
        expect(personRows()).toEqual(['Asha Rao', 'Ben Ortiz']);
        expect(agentRows()).toHaveLength(0);
    });

    it('names the viewer\'s own AI as the assignee picker does, and says where a task can be handed to it', async () => {
        answer([agentOf('u1', 'Asha Rao', { mine: true }), agentOf('u2', 'Ben Ortiz')]);
        await open();
        const [mine, theirs] = agentRows();
        expect(mine.find('.mbv__agent-name').text()).toBe('TaskPanel.my_ai');
        expect(mine.text()).toContain('Members.agent_hand_where');
        expect(theirs.find('.mbv__agent-name').text()).toBe('Claude');
        expect(theirs.text()).not.toContain('Members.agent_hand_where');
        expect(en.Members.agent_hand_where).toMatch(/assignee list/);
        expect(en.Members.agent_hand_where).toMatch(/project manager is on/);
    });

    it('is worded in plain words', () => {
        expect(en.Members.agent_tag).toBe('Agent');
        expect(en.Members.agent_connected_by).toContain('{name}');
        expect(en.Members.agent_no_seat).toMatch(/seat/);
    });
});
