import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AuditLog from '@/views/Settings/Audit/AuditLog.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const CLIENT = 'ahc_0123456789abcdef01234567';

const outsideRow = (id, outsideAgent) => ({
    _id: id, action: 'agent.action_refused', actorId: CLIENT, actorName: `${CLIENT} for Member`, createdAt: new Date().toISOString(),
    meta: { actorType: 'agent', viaAccount: 'external', agentName: CLIENT, clientId: CLIENT, delegatedBy: 'u2' },
    outsideAgent,
});

const serve = (rows) => {
    apiRequest.mockResolvedValue({ data: { status: true, data: rows, metadata: { total: rows.length, page: 1, totalPages: 1 } } });
};

const open = async (rows) => {
    serve(rows);
    const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
});

describe('an outside client in the audit log', () => {
    it('shows the client by name and who delegated it, not the client id', async () => {
        const wrapper = await open([outsideRow('a', { clientId: CLIENT, clientName: 'Coder', delegatedBy: 'u2', delegatedByName: 'Olivia Owner' })]);
        const actor = wrapper.find('.al__actor-name');
        expect(actor.text()).toBe(t('Audit.outside_agent_for', { client: 'Coder', person: 'Olivia Owner' }));
        expect(actor.text()).toBe('Coder (outside agent) for Olivia Owner');
        expect(wrapper.find('.al__row').text()).not.toContain(CLIENT);
    });

    it('falls back to a plain label when the server could not name the client or the person', async () => {
        const wrapper = await open([outsideRow('a', { clientId: CLIENT, clientName: null, delegatedBy: 'u2', delegatedByName: null })]);
        expect(wrapper.find('.al__actor-name').text()).toBe(t('Audit.outside_agent_for', { client: t('Audit.an_outside_agent'), person: t('Audit.a_member') }));
        expect(wrapper.find('.al__row').text()).not.toContain(CLIENT);
    });

    it('renders a client name as text, never as markup', async () => {
        const wrapper = await open([outsideRow('a', { clientId: CLIENT, clientName: '<img src=x onerror=alert(1)>', delegatedBy: 'u2', delegatedByName: 'Olivia Owner' })]);
        expect(wrapper.find('.al__actor-name img').exists()).toBe(false);
        expect(wrapper.find('.al__actor-name').text()).toContain('<img src=x onerror=alert(1)>');
    });

    it('has a filter that asks for outside-client rows only', async () => {
        const wrapper = await open([]);
        serve([]);
        const tab = wrapper.findAll('.ah-tab').find((button) => button.text() === t('Audit.tab_outside_agents'));
        expect(tab).toBeTruthy();
        await tab.trigger('click');
        await flushPromises();
        const [method, url] = apiRequest.mock.calls[apiRequest.mock.calls.length - 1];
        expect(method).toBe('get');
        expect(url).toContain('actorType=outside_agent');
        expect(tab.classes()).toContain('is-active');
    });
});
