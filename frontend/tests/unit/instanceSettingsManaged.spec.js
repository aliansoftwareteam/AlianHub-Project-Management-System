import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const { get, put, post, restartAndWait } = vi.hoisted(() => ({
    get: vi.fn(), put: vi.fn(), post: vi.fn(), restartAndWait: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k, te: (k) => /\.(sec_|choice_|when_on|when_off|od_)/.test(k) }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/services', () => ({ apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/views/Settings/Instance/useInstanceApi', () => ({
    useInstanceApi: () => ({ get, put, post, message: (e) => e.message, guide: (a) => `#${a}`, env: { INSTANCE_SETTINGS: '/s', INSTANCE_SETTINGS_TEST: '/t' } }),
}));
vi.mock('@/views/Settings/Instance/restartInstance', () => ({ restartAndWait }));
vi.mock('@/views/Settings/Instance/InstanceAgents.vue', () => ({ default: { name: 'InstanceAgents', render: () => null } }));

import InstanceSettings from '@/views/Settings/Instance/InstanceSettings.vue';
import { publicConfig } from '@/config/publicConfig';

const row = (key, group, extra = {}) => ({
    key, group, type: 'text', secret: false, label: key, help: '', options: null, default: '', restart: false,
    value: '', source: 'unset', locked: false, readOnly: false, managed: false, ...extra,
});
const secret = (key, group, set = false) => row(key, group, { type: 'secret', secret: true, value: { set } });
const managed = (key, group) => row(key, group, { managed: true, locked: true, value: null, default: null });
const toggle = (key, group, value = 'false') => row(key, group, { type: 'boolean', value });

const SETTINGS = [
    row('APP_NAME', 'general', { value: 'Acme Projects', source: 'saved' }),
    row('CRON_TZ', 'general', { type: 'timezone', value: 'UTC', restart: true }),
    managed('WEBURL', 'general'),
    managed('NODEMAILER_HOST', 'mail'),
    managed('RESEND_API_KEY', 'mail'),
    managed('STORAGE_TYPE', 'storage'),
    row('LLM_PROVIDER', 'ai', { type: 'select', options: ['openai', 'anthropic'], value: 'openai' }),
    secret('AI_API_KEY', 'ai'),
    row('AI_MODEL', 'ai'),
    secret('ANTHROPIC_API_KEY', 'ai'),
    row('ANTHROPIC_MODEL', 'ai'),
    toggle('GOOGLE_LOGIN_ENABLED', 'auth'),
    row('GOOGLE_CLIENT_ID', 'auth'),
    row('TURN_URLS', 'calling', { value: 'turn:t.example.com:3478' }),
    secret('TURN_STATIC_AUTH_SECRET', 'calling', true),
    row('TURN_USERNAME', 'calling'),
    secret('TURN_PASSWORD', 'calling'),
    managed('HELMET_ENABLED', 'security'),
    row('AGENT_TAINT_ROUTING', 'security', { type: 'boolean', value: 'true', readOnly: true, locked: true }),
    row('PERMISSION_ENFORCEMENT_MODE', 'security', { type: 'select', options: ['off', 'report', 'enforce'], value: 'off' }),
];

const open = async () => {
    get.mockResolvedValue({ groups: ['general', 'mail', 'storage', 'ai', 'auth', 'calling', 'security'], settings: SETTINGS });
    const wrapper = mount(InstanceSettings, { global: { provide: { $companyId: ref('c1') }, mocks: { $t: (k) => k }, stubs: { ShellIcon: true } } });
    await flushPromises();
    return wrapper;
};
const tab = (wrapper, group) => wrapper.findAll('.ah-tab').find((t) => t.text() === `Instance.group_${group}`);
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
    it('leaves out what AlianHub Cloud sets, and the tabs it runs whole', async () => {
        const wrapper = await open();
        expect(wrapper.find('#f-WEBURL').exists()).toBe(false);
        expect(wrapper.find('#f-APP_NAME').element.value).toBe('Acme Projects');
        expect(tab(wrapper, 'mail')).toBeUndefined();
        expect(tab(wrapper, 'storage')).toBeUndefined();
        expect(tab(wrapper, 'calling')).toBeDefined();
        expect(wrapper.text()).not.toContain('WEBURL');
        expect(wrapper.find('label[for="f-APP_NAME"]').attributes('title')).toBeUndefined();
    });

    it('offers the scheduler time zone as a list, not free text', async () => {
        const wrapper = await open();
        const select = wrapper.find('select#f-CRON_TZ');
        expect(select.exists()).toBe(true);
        expect(select.findAll('option').map((o) => o.element.value)).toContain('UTC');
    });

    it('shows only the chosen AI provider, with where to get its key', async () => {
        const wrapper = await open();
        await tab(wrapper, 'ai').trigger('click');
        expect(wrapper.find('#f-AI_API_KEY').exists()).toBe(true);
        expect(wrapper.find('#f-ANTHROPIC_API_KEY').exists()).toBe(false);
        await wrapper.find('#f-LLM_PROVIDER').setValue('anthropic');
        expect(wrapper.find('#f-AI_API_KEY').exists()).toBe(false);
        expect(wrapper.find('#f-ANTHROPIC_API_KEY').exists()).toBe(true);
        expect(wrapper.find('[data-test="instance-section-provider"] a').attributes('href')).toBe('https://console.anthropic.com/settings/keys');
    });

    it('asks for a sign-in provider\'s credentials once it is switched on, with the address to paste', async () => {
        const wrapper = await open();
        await tab(wrapper, 'auth').trigger('click');
        expect(wrapper.find('#f-GOOGLE_CLIENT_ID').exists()).toBe(false);
        await wrapper.find('#f-GOOGLE_LOGIN_ENABLED').setValue(true);
        expect(wrapper.find('#f-GOOGLE_CLIENT_ID').exists()).toBe(true);
        expect(wrapper.find('[data-test="instance-paste-google"]').text()).toContain('https://acme.alianhub.com');
    });

    it('lets the owner set the TURN relay and clears the login method they move away from', async () => {
        const wrapper = await open();
        await tab(wrapper, 'calling').trigger('click');
        expect(wrapper.find('#f-TURN_STATIC_AUTH_SECRET').exists()).toBe(true);
        expect(wrapper.find('#f-TURN_USERNAME').exists()).toBe(false);
        await wrapper.find('[data-test="instance-choice-password"]').setValue(true);
        await wrapper.find('#f-TURN_USERNAME').setValue('relay');
        put.mockResolvedValue({ settings: SETTINGS, restartRequired: [] });
        await save(wrapper);
        expect(put).toHaveBeenCalledWith('/s', { TURN_STATIC_AUTH_SECRET: '', TURN_USERNAME: 'relay' });
    });

    it('says what each security choice does, and hides what only the environment sets', async () => {
        const wrapper = await open();
        await tab(wrapper, 'security').trigger('click');
        expect(wrapper.find('#f-AGENT_TAINT_ROUTING').exists()).toBe(false);
        expect(wrapper.find('#f-HELMET_ENABLED').exists()).toBe(false);
        const effects = wrapper.find('[data-test="instance-effects-PERMISSION_ENFORCEMENT_MODE"]');
        expect(effects.findAll('li')).toHaveLength(3);
        expect(effects.find('li.is-current').text()).toContain('Instance.od_PERMISSION_ENFORCEMENT_MODE_off');
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
        expect(put).toHaveBeenCalledWith('/s', { CRON_TZ: 'Asia/Kolkata' });
        expect(wrapper.find('[data-test="instance-restart-banner"]').text()).toContain('Instance.managed_restart_needed');
        await wrapper.find('[data-test="instance-restart-now"]').trigger('click');
        expect(restartAndWait).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'c1' }));
        expect(wrapper.find('[data-test="instance-restart-banner"]').text()).toContain('Instance.managed_restarting');
    });
});

describe('instance settings on a self-hosted instance', () => {
    beforeEach(() => { publicConfig.hosting = { mode: 'self', portalUrl: '' }; });

    it('keeps an environment-set setting visible as locked, with its variable on hover', async () => {
        const wrapper = await open();
        await tab(wrapper, 'security').trigger('click');
        expect(wrapper.find('#f-AGENT_TAINT_ROUTING').attributes('disabled')).toBeDefined();
        expect(wrapper.find('label[for="f-AGENT_TAINT_ROUTING"]').attributes('title')).toBe('AGENT_TAINT_ROUTING');
    });

    it('keeps the old restart note and offers no Restart now', async () => {
        const wrapper = await open();
        put.mockResolvedValue({ settings: SETTINGS, restartRequired: ['CRON_TZ'] });
        await wrapper.find('#f-CRON_TZ').setValue('Asia/Kolkata');
        await save(wrapper);
        expect(wrapper.find('[data-test="instance-restart-now"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Instance.restart_needed');
    });
});
