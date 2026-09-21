import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import StoredSecrets from '@/views/Settings/Integrations/StoredSecrets.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const ROUTE = '/api/v2/secrets';
const KEY_ID = 'k0123456789abcdef';
const OLD_KEY_ID = 'kfedcba9876543210';
const CREATED = '2026-09-01T09:00:00.000Z';
const ROTATED = '2026-09-10T09:00:00.000Z';
const RESOLVED = '2026-09-17T18:30:00.000Z';
const REVOKED = '2026-09-12T09:00:00.000Z';
const when = (iso) => new Date(iso).toLocaleString();

const row = (over) => ({ handle: `sec_${over.name.replace(/\W/g, '').padEnd(24, '0').slice(0, 24)}`, kind: 'integration', keyId: KEY_ID, createdBy: 'u1', createdAt: CREATED, rotatedAt: null, revokedAt: null, lastResolvedAt: null, ...over });

const serve = ({ status = true, code = 200, rows = [] } = {}) => {
    apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get' && url === ROUTE) return Promise.resolve({ status: code, data: status ? { status: true, data: rows, keyId: KEY_ID } : { status: false, statusText: 'The secrets store is off.' } });
        if (method === 'post' && /\/rotate$/.test(url)) return Promise.resolve({ data: { status: true, data: { ...rows[0], rotatedAt: ROTATED } } });
        if (method === 'post' && /\/revoke$/.test(url)) return Promise.resolve({ data: { status: true, data: { ...rows[0], revokedAt: REVOKED } } });
        return Promise.reject(new Error(`unexpected ${method} ${url} ${JSON.stringify(body)}`));
    });
};

const open = async (setup) => {
    serve(setup);
    const wrapper = mount(StoredSecrets, { global: { mocks: { $t: t } } });
    await flushPromises();
    return wrapper;
};

const posts = () => apiRequest.mock.calls.filter(([method]) => method === 'post');

beforeEach(() => {
    apiRequest.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the stored secrets panel', () => {
    it('renders each secret\'s name, kind, key id, created, rotated and last resolved, and never a value', async () => {
        const wrapper = await open({
            rows: [
                row({ name: 'GitHub: Personal access token', kind: 'integration', rotatedAt: ROTATED, lastResolvedAt: RESOLVED }),
                row({ name: 'Webhook: Team Slack', kind: 'webhook', keyId: OLD_KEY_ID, revokedAt: REVOKED }),
            ],
        });
        const panel = wrapper.find('[data-test="secrets-list"]');
        expect(panel.exists()).toBe(true);
        expect(panel.text()).toContain(t('Secrets.title'));
        expect(panel.text()).toContain(t('Secrets.lead'));
        expect(t('Secrets.lead')).toMatch(/never shown/i);

        const rows = panel.findAll('[data-test="secret-row"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].find('[data-test="secret-name"]').text()).toBe('GitHub: Personal access token');
        expect(rows[0].find('[data-test="secret-kind"]').text()).toBe(t('Secrets.kind_integration'));
        expect(rows[0].find('[data-test="secret-key"]').text()).toBe(KEY_ID);
        expect(rows[0].find('[data-test="secret-created"]').text()).toBe(when(CREATED));
        expect(rows[0].find('[data-test="secret-rotated"]').text()).toBe(when(ROTATED));
        expect(rows[0].find('[data-test="secret-resolved"]').text()).toBe(when(RESOLVED));
        expect(rows[0].find('[data-test="secret-status"]').text()).toBe(t('Secrets.status_active'));

        expect(rows[1].find('[data-test="secret-kind"]').text()).toBe(t('Secrets.kind_webhook'));
        expect(rows[1].find('[data-test="secret-key"]').text()).toContain(OLD_KEY_ID);
        expect(rows[1].find('[data-test="secret-key"]').text()).toContain(t('Secrets.key_previous'));
        expect(rows[1].find('[data-test="secret-rotated"]').text()).toBe(t('Secrets.never'));
        expect(rows[1].find('[data-test="secret-resolved"]').text()).toBe(t('Secrets.never'));
        expect(rows[1].find('[data-test="secret-status"]').text()).toBe(t('Secrets.status_revoked'));
        expect(rows[1].find('[data-test="secret-rotate"]').exists()).toBe(false);
        expect(rows[1].find('[data-test="secret-revoke"]').exists()).toBe(false);

        expect(panel.html()).not.toMatch(/ciphertext|value=/);
        expect(panel.findAll('input')).toHaveLength(0);
    });

    it('rotates through the rotate route with the typed value and clears the input afterwards', async () => {
        const wrapper = await open({ rows: [row({ name: 'GitHub: Personal access token' })] });
        const first = wrapper.find('[data-test="secret-row"]');
        await first.find('[data-test="secret-rotate"]').trigger('click');
        const input = wrapper.find('[data-test="rotate-input"]');
        expect(input.attributes('type')).toBe('password');
        await input.setValue('ghp_NewValue');
        await wrapper.find('[data-test="rotate-form"]').trigger('submit');
        await flushPromises();
        expect(posts()).toEqual([['post', `${ROUTE}/${first.attributes('data-handle')}/rotate`, { value: 'ghp_NewValue' }]]);
        expect(wrapper.find('[data-test="rotate-input"]').exists()).toBe(false);
        expect(wrapper.html()).not.toContain('ghp_NewValue');
        expect(wrapper.find('[data-test="secret-rotated"]').text()).toBe(when(ROTATED));
    });

    it('does not rotate with an empty value', async () => {
        const wrapper = await open({ rows: [row({ name: 'GitHub: Personal access token' })] });
        await wrapper.find('[data-test="secret-rotate"]').trigger('click');
        await wrapper.find('[data-test="rotate-form"]').trigger('submit');
        await flushPromises();
        expect(posts()).toEqual([]);
        expect(wrapper.find('[data-test="rotate-error"]').text()).toBe(t('Secrets.err_value'));
    });

    it('revokes through the revoke route after confirming, and shows the secret as revoked', async () => {
        const wrapper = await open({ rows: [row({ name: 'Webhook: Team Slack', kind: 'webhook' })] });
        const first = wrapper.find('[data-test="secret-row"]');
        await first.find('[data-test="secret-revoke"]').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenCalledWith(t('Secrets.confirm_revoke', { name: 'Webhook: Team Slack' }));
        expect(posts()).toEqual([['post', `${ROUTE}/${first.attributes('data-handle')}/revoke`, {}]]);
        expect(wrapper.find('[data-test="secret-status"]').text()).toBe(t('Secrets.status_revoked'));
    });

    it('does nothing when the confirmation is declined', async () => {
        window.confirm.mockReturnValue(false);
        const wrapper = await open({ rows: [row({ name: 'Webhook: Team Slack', kind: 'webhook' })] });
        await wrapper.find('[data-test="secret-revoke"]').trigger('click');
        await flushPromises();
        expect(posts()).toEqual([]);
    });

    it('shows the empty state when the store is on and holds nothing', async () => {
        const wrapper = await open({ rows: [] });
        expect(wrapper.find('[data-test="secrets-empty"]').text()).toBe(t('Secrets.empty'));
    });

    it('renders nothing when the store is off', async () => {
        const wrapper = await open({ status: false, code: 404 });
        expect(wrapper.find('[data-test="secrets-list"]').exists()).toBe(false);
        expect(wrapper.text()).toBe('');
    });
});
