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

const row = (id, over = {}) => ({ _id: id, action: 'member.update', actorId: 'u1', actorName: 'Olivia Owner', createdAt: new Date().toISOString(), meta: {}, ...over });

const serve = (rows, chain) => {
    apiRequest.mockResolvedValue({ data: { status: true, data: rows, metadata: { total: rows.length, page: 1, totalPages: 1, chain } } });
};

const open = async (rows, chain = { on: true }) => {
    serve(rows, chain);
    const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
    await flushPromises();
    return wrapper;
};

const indicators = (wrapper) => wrapper.findAll('[data-test^="integrity-"]');

beforeEach(() => {
    apiRequest.mockReset();
});

describe('the audit log integrity indicator', () => {
    it('marks each row verified, broken from its first broken seq, not yet verified or unchained while the chain is on', async () => {
        const wrapper = await open([
            row('a', { integrity: { state: 'verified' } }),
            row('b', { integrity: { state: 'broken', brokenAt: 12 } }),
            row('c', { integrity: { state: 'unverified' } }),
            row('d', { integrity: { state: 'unchained' } }),
        ]);

        const shown = indicators(wrapper);
        expect(shown.map((chip) => chip.attributes('data-test'))).toEqual(['integrity-verified', 'integrity-broken', 'integrity-unverified', 'integrity-unchained']);
        expect(shown[0].text()).toBe(t('Audit.integrity_verified'));
        expect(shown[0].classes()).toContain('ah-chip--ok');
        expect(shown[1].text()).toBe(t('Audit.integrity_broken', { seq: 12 }));
        expect(shown[1].classes()).toContain('ah-chip--danger');
        expect(shown[2].text()).toBe(t('Audit.integrity_unverified'));
        expect(shown[2].classes()).toContain('ah-chip--warn');
        expect(shown[3].text()).toBe(t('Audit.integrity_unchained'));
        expect(shown[1].attributes('title')).toBe(t('Audit.integrity_broken_hint', { seq: 12 }));
    });

    it('shows nothing while the chain is off and every row is unchained', async () => {
        const wrapper = await open([row('a', { integrity: { state: 'unchained' } }), row('b', { integrity: { state: 'unchained' } })], { on: false });
        expect(indicators(wrapper)).toHaveLength(0);
    });

    it('still flags rows chained earlier once the chain is off', async () => {
        const wrapper = await open([row('a', { integrity: { state: 'broken', brokenAt: 3 } }), row('b', { integrity: { state: 'unchained' } })], { on: false });
        expect(indicators(wrapper).map((chip) => chip.attributes('data-test'))).toEqual(['integrity-broken']);
    });
});

describe('the refusals filter', () => {
    it('asks for permission refusals only and marks them as refused', async () => {
        const wrapper = await open([row('a')]);
        serve([row('r', { action: 'permission.refused', entityName: 'task.task_priority', meta: { reason: 'denied', mode: 'enforce' }, integrity: { state: 'verified' } })], { on: true });

        const tab = wrapper.findAll('.ah-tab').find((button) => button.text() === t('Audit.tab_refusals'));
        expect(tab).toBeTruthy();
        await tab.trigger('click');
        await flushPromises();

        const [method, url] = apiRequest.mock.calls[apiRequest.mock.calls.length - 1];
        expect(method).toBe('get');
        expect(url).toContain('refused=true');
        expect(url).not.toContain('gated=true');
        expect(tab.classes()).toContain('is-active');
        const refused = wrapper.find('.al__row');
        expect(refused.classes()).toContain('al__row--refused');
        expect(refused.text()).toContain('task.task_priority');
    });
});
