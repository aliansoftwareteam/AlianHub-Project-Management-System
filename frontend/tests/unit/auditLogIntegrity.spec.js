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

    it('shows no indicator while the chain is off, whatever a row carries', async () => {
        const wrapper = await open([row('a', { integrity: { state: 'broken', brokenAt: 3 }, chain: { seq: 3 } }), row('b')], { on: false });
        expect(indicators(wrapper)).toHaveLength(0);
        expect(wrapper.find('[data-test="actor-id"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(t('Audit.names_not_checked'));
    });

    it('labels a row that is broken on its own, outside the sequence', async () => {
        const wrapper = await open([row('a', { integrity: { state: 'broken', brokenAt: null } })]);
        const [chip] = indicators(wrapper);
        expect(chip.text()).toBe(t('Audit.integrity_broken_row'));
        expect(chip.attributes('title')).toBe(t('Audit.integrity_broken_row_hint'));
    });

    it('shows the hashed actor and entity ids beside the names on chained rows, and says the names are not checked', async () => {
        const wrapper = await open([
            row('a', { actorId: 'u-hashed', entityId: 'e-hashed', entityName: 'Renamed', chain: { seq: 4 }, integrity: { state: 'verified' } }),
            row('b', { actorId: 'u-plain', entityId: 'e-plain', integrity: { state: 'unchained' } }),
        ]);
        const [chained, plain] = wrapper.findAll('.al__row');
        expect(chained.find('[data-test="actor-id"]').text()).toBe('u-hashed');
        expect(chained.find('[data-test="entity-id"]').text()).toBe('e-hashed');
        expect(chained.find('[data-test="actor-id"]').attributes('title')).toBe(t('Audit.names_not_checked'));
        expect(plain.find('[data-test="actor-id"]').exists()).toBe(false);
        expect(wrapper.text()).toContain(t('Audit.names_not_checked'));
    });

    it('does not repeat an entity id that is already the shown name', async () => {
        const wrapper = await open([
            row('r', { action: 'permission.refused', entityId: 'settings.settings_member_list', entityName: 'settings.settings_member_list', chain: { seq: 1 }, integrity: { state: 'verified' } }),
            row('u', { entityId: 'e-only', chain: { seq: 2 }, integrity: { state: 'verified' } }),
        ]);
        const [refusal, unnamed] = wrapper.findAll('.al__row');
        expect(refusal.find('.al__entity').text()).toBe('settings.settings_member_list');
        expect(refusal.find('[data-test="entity-id"]').exists()).toBe(false);
        expect(unnamed.find('.al__entity').text()).toBe('e-only');
        expect(unnamed.find('[data-test="entity-id"]').exists()).toBe(false);
        expect(refusal.find('[data-test="actor-id"]').exists()).toBe(true);
    });
});

describe('an approximate total', () => {
    it('says so when the server could not count a filter exactly', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [row('a', { integrity: { state: 'verified' } })], metadata: { total: 3, page: 1, totalPages: 1, chain: { on: true }, approximate: true } } });
        const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        expect(wrapper.find('[data-test="total-approximate"]').text()).toBe(t('Audit.total_approximate'));
    });

    it('says nothing when the count is exact', async () => {
        const wrapper = await open([row('a', { integrity: { state: 'verified' } })]);
        expect(wrapper.find('[data-test="total-approximate"]').exists()).toBe(false);
    });
});

describe('the integrity labels', () => {
    it('describe the states the server reports', () => {
        expect(t('Audit.integrity_unchained_hint')).toMatch(/before the audit chain started/);
        expect(t('Audit.integrity_unchained_hint')).not.toMatch(/\boff\b/);
        expect(t('Audit.integrity_broken_row_hint')).toMatch(/while the audit chain was off/);
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
