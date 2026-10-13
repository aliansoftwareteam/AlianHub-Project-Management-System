import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';

vi.mock('@/locales/main', async () => {
    const { createI18n } = await import('vue-i18n');
    const en = (await import('@/locales/en')).default;
    return { i18n: createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false }) };
});

import { installBusyHandling, isBusy, retryAfterMs, RETRY_WAIT_CAP_MS, MAX_WAITING_READS } from '@/services/busy';

const RAW = 'Request failed with status code 429';
const MOMENT = 'The server is busy. Try again in a moment.';

const refuse = ({ retryAfter, data = 'Too many requests, please try again later.' } = {}) => (config) => Promise.reject(new AxiosError(
    RAW,
    AxiosError.ERR_BAD_REQUEST,
    config,
    null,
    { status: 429, statusText: 'Too Many Requests', headers: retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) }, config, data }
));
const fail = (status) => (config) => Promise.reject(new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    config,
    null,
    { status, statusText: 'Error', headers: {}, config, data: { status: false, statusText: 'It broke.' } }
));
const answerWith = (data) => (config) => Promise.resolve({ status: 200, statusText: 'OK', headers: {}, config, data });

const client = (answers) => {
    const queue = [...answers];
    const adapter = vi.fn((config) => queue.shift()(config));
    const instance = axios.create({ adapter });
    installBusyHandling(instance);
    return { instance, adapter };
};

const outcome = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('what a 429 says', () => {
    it('is the busy message with the wait the server named, never the raw axios text', async () => {
        const { instance, adapter } = client([refuse({ retryAfter: 23 })]);
        const { error } = await outcome(instance.post('/api/v2/tasks/bulk', { action: 'bulkUpdateStatus' }));

        expect(adapter).toHaveBeenCalledTimes(1);
        expect(error.message).toBe('The server is busy. Try again in 23 seconds.');
        expect(error.message).not.toContain('Request failed');
        expect(error.response.status).toBe(429);
        expect(error.response.data).toMatchObject({ status: false, statusText: error.message, message: error.message });
    });

    it('counts one second in the singular', async () => {
        const { instance } = client([refuse({ retryAfter: 1 })]);
        const { error } = await outcome(instance.post('/x', {}));
        expect(error.message).toBe('The server is busy. Try again in 1 second.');
    });

    it('names no time when the answer carries no Retry-After', async () => {
        const { instance } = client([refuse()]);
        const { error } = await outcome(instance.post('/x', {}));
        expect(error.message).toBe(MOMENT);
    });

    it('reads a Retry-After given as a date', () => {
        const at = new Date(Date.now() + 5000).toUTCString();
        expect(retryAfterMs({ response: { status: 429, headers: { 'retry-after': at } } })).toBeGreaterThan(3000);
        expect(retryAfterMs({ response: { status: 429, headers: { 'retry-after': 'soon' } } })).toBeNull();
        expect(retryAfterMs({ response: { status: 429, headers: {} } })).toBeNull();
    });

    it('translates the limiter\'s own English, and keeps a reason another route gave', async () => {
        const limiter = { status: false, code: 'server_busy', statusText: MOMENT, message: MOMENT, retryAfter: 40 };
        const own = { status: false, message: 'Auth.too_many_request' };
        const { instance } = client([refuse({ retryAfter: 40, data: limiter }), refuse({ data: own })]);

        const first = await outcome(instance.post('/x', {}));
        expect(first.error.response.data.statusText).toBe('The server is busy. Try again in 40 seconds.');

        const second = await outcome(instance.post('/y', {}));
        expect(second.error.response.data).toEqual(own);
        expect(second.error.message).toBe(MOMENT);
    });

    it('leaves every other failure as it was', async () => {
        const { instance, adapter } = client([fail(500)]);
        const { error } = await outcome(instance.get('/x'));
        expect(adapter).toHaveBeenCalledTimes(1);
        expect(isBusy(error)).toBe(false);
        expect(error.message).toBe('Request failed with status code 500');
        expect(error.response.data).toEqual({ status: false, statusText: 'It broke.' });
    });
});

describe('a refused read', () => {
    it('is asked once more after the Retry-After wait', async () => {
        const { instance, adapter } = client([refuse({ retryAfter: 2 }), answerWith({ status: true, data: [1] })]);
        const pending = outcome(instance.get('/api/v2/agents/team'));

        await vi.advanceTimersByTimeAsync(1999);
        expect(adapter).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(adapter).toHaveBeenCalledTimes(2);
        expect(adapter.mock.calls[1][0].url).toBe('/api/v2/agents/team');
        expect((await pending).value.data).toEqual({ status: true, data: [1] });
    });

    it('is not asked a third time', async () => {
        const { instance, adapter } = client([refuse({ retryAfter: 2 }), refuse({ retryAfter: 2 }), answerWith({ status: true })]);
        const pending = outcome(instance.get('/x'));
        await vi.advanceTimersByTimeAsync(60000);

        expect(adapter).toHaveBeenCalledTimes(2);
        expect((await pending).error.message).toBe('The server is busy. Try again in 2 seconds.');
    });

    it('is not retried when the server names no time, or a longer one than the cap', async () => {
        const tooLong = Math.ceil(RETRY_WAIT_CAP_MS / 1000) + 1;
        const { instance, adapter } = client([refuse(), refuse({ retryAfter: tooLong })]);

        expect((await outcome(instance.get('/x'))).error.message).toBe(MOMENT);
        expect((await outcome(instance.get('/y'))).error.message).toBe(`The server is busy. Try again in ${tooLong} seconds.`);
        await vi.advanceTimersByTimeAsync(120000);
        expect(adapter).toHaveBeenCalledTimes(2);
    });

    it('is not retried when it was a background refresh', async () => {
        const { instance, adapter } = client([refuse({ retryAfter: 2 }), answerWith({ status: true })]);
        const { error } = await outcome(instance.get('/api/v2/agents/team', { background: true }));
        await vi.advanceTimersByTimeAsync(60000);

        expect(adapter).toHaveBeenCalledTimes(1);
        expect(isBusy(error)).toBe(true);
        expect(retryAfterMs(error)).toBe(2000);
    });

    it('does not stack: only a few reads wait at once, the rest fail straight away', async () => {
        const extra = 4;
        const total = MAX_WAITING_READS + extra;
        const answers = [
            ...Array.from({ length: total }, () => refuse({ retryAfter: 2 })),
            ...Array.from({ length: MAX_WAITING_READS }, () => answerWith({ status: true }))
        ];
        const { instance, adapter } = client(answers);
        const all = Array.from({ length: total }, (_, i) => outcome(instance.get(`/read/${i}`)));

        await vi.advanceTimersByTimeAsync(0);
        expect(adapter).toHaveBeenCalledTimes(total);
        await vi.advanceTimersByTimeAsync(2000);
        expect(adapter).toHaveBeenCalledTimes(total + MAX_WAITING_READS);

        const results = await Promise.all(all);
        expect(results.filter((r) => r.value)).toHaveLength(MAX_WAITING_READS);
        expect(results.filter((r) => r.error)).toHaveLength(extra);
    });
});

describe('a refused write', () => {
    it.each(['post', 'put', 'patch', 'delete'])('%s is never sent again', async (method) => {
        const { instance, adapter } = client([refuse({ retryAfter: 1 }), answerWith({ status: true })]);
        const { error } = await outcome(method === 'delete' ? instance.delete('/x') : instance[method]('/x', {}));
        await vi.advanceTimersByTimeAsync(60000);

        expect(adapter).toHaveBeenCalledTimes(1);
        expect(error.message).toBe('The server is busy. Try again in 1 second.');
    });
});
