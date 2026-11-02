import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));

import ConnectorQuotas from '@/views/Integrations/ConnectorQuotas.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const BASE = '/api/v2/connectors/admin/quotas';
const OWNER = 1;
const MEMBER_ROLE = 3;
const PRIYA = '6f0000000000000000000001';
const AGENT = '6f0000000000000000000a01';
const CEILINGS = { reads: 600, writeProposals: 500, agentReads: 2000 };
const DEFAULTS = { reads: 500, writeProposals: 50, agentReads: 200 };

const overviewOf = (over = {}) => ({ workspace: { reads: null, writeProposals: null, agentReads: null }, members: [], agents: [], defaults: DEFAULTS, ceilings: CEILINGS, ...over });

const storeFor = (roleType) => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), companyUsers: () => [] } },
        users: { namespaced: true, getters: { users: () => [{ _id: PRIYA, Employee_Name: 'Priya' }] } },
    },
});

let overview;
const puts = () => apiRequest.mock.calls.filter(([method]) => method === 'put');

const mountQuotas = async (roleType = OWNER) => {
    const wrapper = mount(ConnectorQuotas, { global: { plugins: [storeFor(roleType)], mocks: { $t: i18n.global.t } } });
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    overview = overviewOf();
    apiRequest.mockReset();
    apiRequest.mockImplementation((method, url, body) => {
        if (url === BASE && method === 'put') {
            if (body.scope === 'workspace') overview = overviewOf({ workspace: { ...overview.workspace, ...body } });
            return Promise.resolve({ data: { status: true, data: {} } });
        }
        if (url === BASE) return Promise.resolve({ data: { status: true, data: overview } });
        return Promise.resolve({ data: { status: true, data: [{ _id: AGENT, name: 'Digest' }] } });
    });
});

describe('the limits for connected apps', () => {
    it('is not shown or read for a member', async () => {
        const wrapper = await mountQuotas(MEMBER_ROLE);
        expect(wrapper.find('[data-test="connector-quotas"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('says what a blank field uses and what the server allows', async () => {
        const wrapper = await mountQuotas();
        expect(wrapper.text()).toContain(en.Connectors.quota.ceiling.replace('{n}', '600'));
        expect(wrapper.text()).toContain(en.Connectors.quota.blank_uses.replace('{n}', '500'));
    });

    it('refuses a limit above the ceiling on the screen, with the reason, and sends nothing', async () => {
        const wrapper = await mountQuotas();
        await wrapper.find('[data-test="quota-reads"]').setValue('601');
        await wrapper.find('[data-test="quota-form"]').trigger('submit');
        await flushPromises();
        const said = wrapper.find('[data-test="quota-reads-error"]').text();
        expect(said).toContain(en.Connectors.quota.reads);
        expect(said).toContain('600');
        expect(puts()).toHaveLength(0);
    });

    it('refuses what is not a whole number', async () => {
        const wrapper = await mountQuotas();
        await wrapper.find('[data-test="quota-reads"]').setValue('-1');
        await wrapper.find('[data-test="quota-form"]').trigger('submit');
        await flushPromises();
        expect(wrapper.find('[data-test="quota-reads-error"]').exists()).toBe(true);
        expect(puts()).toHaveLength(0);
    });

    it('saves only the field that changed, then reads the limits again', async () => {
        const wrapper = await mountQuotas();
        await wrapper.find('[data-test="quota-writeProposals"]').setValue('20');
        await wrapper.find('[data-test="quota-form"]').trigger('submit');
        await flushPromises();
        expect(puts()[0][2]).toEqual({ scope: 'workspace', writeProposals: 20 });
        expect(wrapper.find('[data-test="quota-saved"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="quota-writeProposals"]').element.value).toBe('20');
        expect(wrapper.find('[data-test="quota-save"]').element.disabled).toBe(true);
    });

    it('takes a saved limit away when its field is emptied', async () => {
        overview = overviewOf({ workspace: { reads: 100, writeProposals: null, agentReads: null } });
        const wrapper = await mountQuotas();
        await wrapper.find('[data-test="quota-reads"]').setValue('');
        await wrapper.find('[data-test="quota-form"]').trigger('submit');
        await flushPromises();
        expect(puts()[0][2]).toEqual({ scope: 'workspace', reads: null });
    });

    it('sets a limit for one member, with only the fields a member has', async () => {
        const wrapper = await mountQuotas();
        await wrapper.find('[data-test="quota-scope"]').setValue('member');
        expect(wrapper.find('[data-test="quota-reads"]').exists()).toBe(false);
        await wrapper.find('[data-test="quota-target"]').setValue(PRIYA);
        expect(wrapper.find('[data-test="quota-agentReads"]').exists()).toBe(false);
        await wrapper.find('[data-test="quota-reads"]').setValue('9');
        await wrapper.find('[data-test="quota-form"]').trigger('submit');
        await flushPromises();
        expect(puts()[0][2]).toEqual({ scope: 'member', targetId: PRIYA, reads: 9 });
    });

    it('names each saved override and opens it to change', async () => {
        overview = overviewOf({ agents: [{ targetId: AGENT, limits: { agentReads: 7 } }] });
        const wrapper = await mountQuotas();
        const row = wrapper.find('[data-test="quota-override"]');
        expect(row.text()).toContain('Digest');
        expect(row.text()).toContain('7');
        await row.find('[data-test="quota-override-change"]').trigger('click');
        expect(wrapper.find('[data-test="quota-agentReads"]').element.value).toBe('7');
    });

    it('refuses what the browser cannot read as a number, rather than taking the limit away', async () => {
        overview = overviewOf({ workspace: { reads: 100, writeProposals: null, agentReads: null } });
        const wrapper = await mountQuotas();
        const input = wrapper.find('[data-test="quota-reads"]');
        Object.defineProperty(input.element, 'validity', { value: { badInput: true } });
        await input.setValue('');
        await wrapper.find('[data-test="quota-form"]').trigger('submit');
        await flushPromises();
        expect(wrapper.find('[data-test="quota-reads-error"]').exists()).toBe(true);
        expect(puts()).toHaveLength(0);
    });

    it('says when a lowered ceiling holds a saved limit, and lists the limit in force', async () => {
        overview = overviewOf({ workspace: { reads: 1000, writeProposals: null, agentReads: null }, members: [{ targetId: PRIYA, limits: { reads: 900, writeProposals: null } }] });
        const wrapper = await mountQuotas();
        expect(wrapper.find('[data-test="quota-reads-held"]').text()).toContain('1000');
        expect(wrapper.find('[data-test="quota-override"]').text()).toContain('600');
    });

    it('opens the limit of someone who has gone, so it can be taken away', async () => {
        const GONE = '6f0000000000000000000a09';
        overview = overviewOf({ members: [{ targetId: GONE, limits: { reads: 9, writeProposals: null } }] });
        const wrapper = await mountQuotas();
        await wrapper.find('[data-test="quota-override-change"]').trigger('click');
        expect(wrapper.find('[data-test="quota-target"]').element.value).toBe(GONE);
        await wrapper.find('[data-test="quota-reads"]').setValue('');
        await wrapper.find('[data-test="quota-form"]').trigger('submit');
        await flushPromises();
        expect(puts()[0][2]).toEqual({ scope: 'member', targetId: GONE, reads: null });
    });

    it('shows the server\'s refusal', async () => {
        const wrapper = await mountQuotas();
        apiRequest.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('x'), { response: { data: { statusText: 'That member is not in this workspace.' } } })));
        await wrapper.find('[data-test="quota-reads"]').setValue('9');
        await wrapper.find('[data-test="quota-form"]').trigger('submit');
        await flushPromises();
        expect(wrapper.find('[data-test="quota-save-error"]').text()).toBe('That member is not in this workspace.');
    });
});
