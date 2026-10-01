import { describe, expect, it, vi } from 'vitest';

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/offline', () => ({
    maybeCacheResponse: vi.fn(),
    handleOfflineFailure: vi.fn(async () => null),
    registerReplayer: vi.fn(),
    clearOffline: vi.fn()
}));

describe('importing the request layer', () => {
    it('does not create the i18n instance, so a spec that mocks vue-i18n without createI18n still loads it', async () => {
        const services = await import('@/services');
        expect(services.apiRequest).toBeTypeOf('function');

        const busy = await import('@/services/busy');
        expect(busy.installBusyHandling).toBeTypeOf('function');
    });

    it('holds for the agent feed, which reads the 429 helpers', async () => {
        const feed = await import('@/views/Ai/agentFeed');
        expect(feed.subscribeAgentFeed).toBeTypeOf('function');
    });
});
