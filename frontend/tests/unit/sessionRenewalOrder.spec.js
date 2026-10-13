/* A session carries the workspaces its person was in when it was issued. A page that renews it after a workspace
   was joined or made needs a renewal that began after that; one already on its way was issued without it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import { flushPromises } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/offline', () => ({
    maybeCacheResponse: vi.fn(),
    handleOfflineFailure: vi.fn(async () => null),
    registerReplayer: vi.fn(),
    clearOffline: vi.fn()
}));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ makeUniqueId: () => `abort-${Math.random()}` }) }));

import { GENERATETOKEN_V2 } from '@/config/env';

const USER = 'user-1';
let services;
let renewals;
let events;

const expiredOnce = () => {
    const seen = new Set();
    return (config) => {
        if (seen.has(config.url)) return Promise.resolve({ data: { status: true, url: config.url }, status: 200, statusText: 'OK', headers: {}, config });
        seen.add(config.url);
        return Promise.reject(new AxiosError('Request failed with status code 401', AxiosError.ERR_BAD_REQUEST, config, null,
            { status: 401, statusText: 'Unauthorized', headers: {}, config, data: { isJwtError: true } }));
    };
};

beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem('userId', USER);
    renewals = [];
    events = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(axios, 'post').mockImplementation((url) => {
        if (!String(url).endsWith(GENERATETOKEN_V2)) return Promise.resolve({ data: {} });
        return new Promise((resolve, reject) => {
            const n = renewals.length + 1;
            events.push(`renewal ${n} begins`);
            renewals.push({
                lands: async () => { resolve({ data: { status: true, issue: n } }); await flushPromises(); },
                fails: async () => { reject({ response: { status: 500, data: { status: false } } }); await flushPromises(); },
            });
        });
    });
    services = await import('@/services');
    services.axiosInstance.defaults.adapter = expiredOnce();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('a session renewal that is asked for', () => {
    it('is not answered by a renewal that began before it was asked for', async () => {
        const refusedForExpiry = services.apiRequest('get', '/api/v1/inbox/counts');
        await flushPromises();
        expect(events).toEqual(['renewal 1 begins']);

        events.push('the workspace is joined');
        const asked = services.getAuth(USER);
        await renewals[0].lands();

        expect(events).toEqual(['renewal 1 begins', 'the workspace is joined', 'renewal 2 begins']);
        await renewals[1].lands();
        expect(await asked).toEqual({ status: true, issue: 2 });
        expect((await refusedForExpiry).data.status).toBe(true);
    });

    it('starts at once when no renewal is on its way', async () => {
        const asked = services.getAuth(USER);
        expect(renewals).toHaveLength(1);
        await renewals[0].lands();
        expect(await asked).toEqual({ status: true, issue: 1 });
    });

    it('shares the renewal that follows with everyone who asked while one was on its way', async () => {
        const first = services.getAuth(USER);
        const others = [services.getAuth(USER), services.getAuth(USER), services.getAuth(USER)];
        await renewals[0].lands();
        expect(renewals).toHaveLength(2);
        await renewals[1].lands();

        expect(await first).toEqual({ status: true, issue: 1 });
        expect(await Promise.all(others)).toEqual(Array(3).fill({ status: true, issue: 2 }));
        expect(renewals).toHaveLength(2);
    });

    it('is asked again after the one that followed has begun', async () => {
        services.getAuth(USER);
        const second = services.getAuth(USER);
        await renewals[0].lands();
        const third = services.getAuth(USER);
        await renewals[1].lands();
        expect(renewals).toHaveLength(3);
        await renewals[2].lands();

        expect(await second).toEqual({ status: true, issue: 2 });
        expect(await third).toEqual({ status: true, issue: 3 });
    });

    it('still gets its own renewal when the one before it fails', async () => {
        const before = services.getAuth(USER).catch((reason) => reason);
        const asked = services.getAuth(USER);
        await renewals[0].fails();
        await renewals[1].lands();

        expect(await before).toEqual({ status: false });
        expect(await asked).toEqual({ status: true, issue: 2 });
    });
});

describe('requests refused because the session ran out', () => {
    it('share one renewal, and each is sent again once it lands', async () => {
        const refused = ['/a', '/b', '/c'].map((url) => services.apiRequest('get', url));
        await flushPromises();
        expect(renewals).toHaveLength(1);

        await renewals[0].lands();

        expect((await Promise.all(refused)).map((answer) => answer.data.url)).toEqual(['/a', '/b', '/c']);
        expect(renewals).toHaveLength(1);
    });

    it('take the renewal a page asked for when it is already on its way', async () => {
        const asked = services.getAuth(USER);
        const refused = services.apiRequest('get', '/a');
        await flushPromises();
        expect(renewals).toHaveLength(1);

        await renewals[0].lands();
        expect(await asked).toEqual({ status: true, issue: 1 });
        expect((await refused).data.status).toBe(true);
    });
});
