import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';

vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/offline', () => ({
    maybeCacheResponse: vi.fn(),
    handleOfflineFailure: vi.fn(async () => null),
    registerReplayer: vi.fn(),
    clearOffline: vi.fn()
}));
vi.mock('@/locales/main', async () => {
    const { createI18n } = await import('vue-i18n');
    const en = (await import('@/locales/en')).default;
    return { i18n: createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false }) };
});

import { apiRequest, apiRequestWithoutCompnay, axiosInstance, axiosInstanceWithoutCompany } from '@/services';

const refuse = (retryAfter) => (config) => Promise.reject(new AxiosError(
    'Request failed with status code 429',
    AxiosError.ERR_BAD_REQUEST,
    config,
    null,
    { status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': String(retryAfter) }, config, data: 'Too many requests, please try again later.' }
));
const answer = (config) => Promise.resolve({ status: 200, statusText: 'OK', headers: {}, config, data: { status: true } });

const scripted = (instance, answers) => {
    const queue = [...answers];
    const adapter = vi.fn((config) => queue.shift()(config));
    instance.defaults.adapter = adapter;
    return adapter;
};

const outcome = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('apiRequest against a busy server', () => {
    it('fails a bulk edit once, with the message the toast shows', async () => {
        const adapter = scripted(axiosInstance, [refuse(23), answer]);
        const { error } = await outcome(apiRequest('post', '/api/v2/tasks/bulk', { action: 'bulkUpdateStatus', taskIds: ['t1'] }));
        await vi.advanceTimersByTimeAsync(60000);

        expect(adapter).toHaveBeenCalledTimes(1);
        expect(error.message).toBe('The server is busy. Try again in 23 seconds.');
    });

    it('asks a read once more, and a background read not at all', async () => {
        const adapter = scripted(axiosInstance, [refuse(2), answer, refuse(2), answer]);
        const pending = outcome(apiRequest('get', '/api/v2/projects'));
        await vi.advanceTimersByTimeAsync(2000);
        expect((await pending).value.data).toEqual({ status: true });
        expect(adapter).toHaveBeenCalledTimes(2);

        const quiet = await outcome(apiRequest('get', '/api/v2/agents/team', undefined, undefined, { background: true }));
        await vi.advanceTimersByTimeAsync(60000);
        expect(quiet.error.response.status).toBe(429);
        expect(adapter).toHaveBeenCalledTimes(3);
    });

    it('covers the requests made without a company too', async () => {
        const adapter = scripted(axiosInstanceWithoutCompany, [refuse(5)]);
        const { error } = await outcome(apiRequestWithoutCompnay('post', '/api/v2/anything', {}));
        expect(adapter).toHaveBeenCalledTimes(1);
        expect(error.message).toBe('The server is busy. Try again in 5 seconds.');
    });
});
