import { describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';

const { translated } = vi.hoisted(() => ({ translated: vi.fn((key) => key) }));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: translated } } }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/offline', () => ({
    maybeCacheResponse: vi.fn(),
    handleOfflineFailure: vi.fn(async () => null),
    registerReplayer: vi.fn(),
    clearOffline: vi.fn()
}));
// The request layer already reached the i18n instance through this import before the 429 handling existed.
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ makeUniqueId: () => 'abort-key' }) }));

const refuse = (config) => Promise.reject(new AxiosError(
    'Request failed with status code 429',
    AxiosError.ERR_BAD_REQUEST,
    config,
    null,
    { status: 429, statusText: 'Too Many Requests', headers: {}, config, data: '' }
));

describe('the 429 handling', () => {
    it('loads without the i18n instance, under a vue-i18n mock that has no createI18n', async () => {
        vi.doUnmock('@/locales/main');
        vi.resetModules();
        const busy = await import('@/services/busy');
        expect(busy.installBusyHandling).toBeTypeOf('function');

        vi.doMock('@/services', () => ({ apiRequest: vi.fn() }));
        const feed = await import('@/views/Ai/agentFeed');
        expect(feed.subscribeAgentFeed).toBeTypeOf('function');
        vi.doUnmock('@/services');
    });

    it('asks for the translator only when a 429 has to be worded', async () => {
        vi.doMock('@/locales/main', () => ({ i18n: { global: { t: translated } } }));
        vi.resetModules();
        const services = await import('@/services');
        expect(services.apiRequest).toBeTypeOf('function');

        const { installBusyHandling } = await import('@/services/busy');
        const instance = axios.create({ adapter: refuse });
        installBusyHandling(instance);
        expect(translated).not.toHaveBeenCalled();

        const error = await instance.post('/x', {}).catch((e) => e);
        expect(translated).toHaveBeenCalledWith('Common.server_busy');
        expect(error.message).toBe('Common.server_busy');
    });
});
