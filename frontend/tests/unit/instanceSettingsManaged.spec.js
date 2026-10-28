import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const { get, put, post, restartAndWait, openUpgrade } = vi.hoisted(() => ({
    get: vi.fn(), put: vi.fn(), post: vi.fn(), restartAndWait: vi.fn(), openUpgrade: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k, te: () => false }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/services', () => ({ apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/views/Settings/Instance/useInstanceApi', () => ({
    useInstanceApi: () => ({ get, put, post, message: (e) => e.message, guide: (a) => `#${a}`, env: { INSTANCE_SETTINGS: '/s', INSTANCE_SETTINGS_TEST: '/t' } }),
}));
vi.mock('@/views/Settings/Instance/restartInstance', () => ({ restartAndWait }));
vi.mock('@/composable/upgradeLink', () => ({ openUpgrade }));
vi.mock('@/views/Settings/Instance/InstanceAgents.vue', () => ({ default: { name: 'InstanceAgents', render: () => null } }));

import InstanceSettings from '@/views/Settings/Instance/InstanceSettings.vue';
import { publicConfig } from '@/config/publicConfig';

const row = (key, group, extra = {}) => ({
    key, group, type: 'text', secret: false, label: key, help: '', options: null, default: '', restart: false,
    value: '', source: 'unset', locked: false, readOnly: false, managed: false, ...extra,
});
const managed = (key, group) => row(key, group, { managed: true, locked: true, value: null, default: null });

const SETTINGS = [
    row('APP_NAME', 'general', { value: 'Acme Projects', source: 'saved' }),
    row('CRON_TZ', 'general', { restart: true }),
    managed('WEBURL', 'general'),
    managed('NODEMAILER_HOST', 'mail'),
    managed('RESEND_API_KEY', 'mail'),
    managed('STORAGE_TYPE', 'storage'),
    row('AI_MODEL', 'ai'),
];

const open = async () => {
    get.mockResolvedValue({ groups: ['general', 'mail', 'storage', 'ai'], settings: SETTINGS });
    const wrapper = mount(InstanceSettings, { global: { provide: { $companyId: ref('c1') }, mocks: { $t: (k) => k }, stubs: { ShellIcon: true } } });
    await flushPromises();
    return wrapper;
};

const save = async (wrapper) => {
    await wrapper.findAll('button').find((b) => b.text() === 'Instance.save').trigger('click');
    await flushPromises();
};

beforeEach(() => {
    vi.clearAllMocks();
    publicConfig.hosting = { mode: 'managed', portalUrl: 'https://account.alianhub.com' };
    publicConfig.webUrl = 'https://acme.alianhub.com';
});
afterEach(() => {
    publicConfig.hosting = { mode: 'self', portalUrl: '' };
    publicConfig.webUrl = '';
});

describe('instance settings on a hosted instance', () => {
    it('shows a managed row as managed, with no input, and keeps the customer rows editable', async () => {
        const wrapper = await open();
        const web = wrapper.find('[data-test="instance-managed-WEBURL"]');
        expect(web.text()).toContain('Instance.managed_by_cloud');
        expect(web.text()).toContain('https://acme.alianhub.com');
        expect(wrapper.find('#f-WEBURL').exists()).toBe(false);
        expect(wrapper.find('#f-APP_NAME').element.value).toBe('Acme Projects');
        expect(wrapper.text()).toContain('Instance.managed_lock');
    });

    it('replaces a group we run whole with one card, offering own SMTP only from it', async () => {
        const wrapper = await open();
        await wrapper.findAll('.ah-tab').find((t) => t.text() === 'Instance.group_mail').trigger('click');
        const card = wrapper.find('[data-test="instance-managed-card"]');
        expect(card.text()).toContain('Instance.group_mail · Instance.group_storage');
        expect(wrapper.find('#f-NODEMAILER_HOST').exists()).toBe(false);
        expect(wrapper.find('[data-test="instance-settings-test"]').exists()).toBe(false);
        await wrapper.find('[data-test="instance-own-smtp"]').trigger('click');
        expect(openUpgrade).toHaveBeenCalled();
    });

    it('never sends a managed key in a save', async () => {
        const wrapper = await open();
        put.mockResolvedValue({ settings: SETTINGS, restartRequired: [] });
        await wrapper.find('#f-APP_NAME').setValue('Acme');
        await save(wrapper);
        expect(put).toHaveBeenCalledWith('/s', { APP_NAME: 'Acme' });
    });

    it('offers Restart now after a restart-bound save, and restarts naming the workspace for the audit', async () => {
        const wrapper = await open();
        put.mockResolvedValue({ settings: SETTINGS, restartRequired: ['CRON_TZ'] });
        restartAndWait.mockReturnValue(new Promise(() => {}));
        await wrapper.find('#f-CRON_TZ').setValue('Asia/Kolkata');
        await save(wrapper);
        expect(wrapper.find('[data-test="instance-restart-banner"]').text()).toContain('Instance.managed_restart_needed');
        await wrapper.find('[data-test="instance-restart-now"]').trigger('click');
        expect(restartAndWait).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'c1' }));
        expect(wrapper.find('[data-test="instance-restart-banner"]').text()).toContain('Instance.managed_restarting');
    });
});

describe('instance settings on a self-hosted instance', () => {
    it('keeps the old restart note and offers no Restart now', async () => {
        publicConfig.hosting = { mode: 'self', portalUrl: '' };
        const wrapper = await open();
        put.mockResolvedValue({ settings: SETTINGS, restartRequired: ['CRON_TZ'] });
        await wrapper.find('#f-CRON_TZ').setValue('Asia/Kolkata');
        await save(wrapper);
        expect(wrapper.find('[data-test="instance-restart-now"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Instance.restart_needed');
    });
});
