import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));

const ROUTE = '/api/v2/users/nav-preferences';
const NAV_KEY = 'ah.nav';

async function load() {
    vi.resetModules();
    return import('@/components/organisms/Shell/shellState');
}

const navPuts = () => apiRequestWithoutCompnay.mock.calls.filter(([method, url]) => method === 'put' && url === ROUTE);
const settle = async () => {
    await nextTick();
    await vi.runAllTimersAsync();
};

beforeEach(() => {
    localStorage.clear();
    apiRequestWithoutCompnay.mockReset();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { pinned: [] } } });
    vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('pinned nav items follow the user across devices', () => {
    it('takes the pins stored on the user over the ones in this browser', async () => {
        localStorage.setItem(NAV_KEY, JSON.stringify({ pinned: ['docs'] }));
        const { shellState, syncNavPreferences } = await load();

        syncNavPreferences('user-1', { pinned: ['chat', 'time'] });
        await settle();

        expect(shellState.nav.pinned).toEqual(['chat', 'time']);
        expect(JSON.parse(localStorage.getItem(NAV_KEY)).pinned).toEqual(['chat', 'time']);
        expect(navPuts()).toHaveLength(0);
    });

    it('uploads pins kept only in this browser once', async () => {
        localStorage.setItem(NAV_KEY, JSON.stringify({ pinned: ['docs'] }));
        const { shellState, syncNavPreferences } = await load();

        syncNavPreferences('user-1', undefined);
        await settle();
        syncNavPreferences('user-1', undefined);
        await settle();

        expect(navPuts()).toHaveLength(1);
        expect(navPuts()[0][2]).toEqual({ pinned: ['docs'] });
        expect(shellState.nav.pinned).toEqual(['docs']);
    });

    it('uploads nothing when neither side has pins', async () => {
        const { syncNavPreferences } = await load();

        syncNavPreferences('user-1', undefined);
        await settle();

        expect(navPuts()).toHaveLength(0);
    });

    it('saves a change to the user once the edits settle, and mirrors it locally at once', async () => {
        const { shellState, syncNavPreferences } = await load();
        syncNavPreferences('user-1', { pinned: [] });
        await settle();

        shellState.nav.pinned.push('chat');
        await nextTick();
        shellState.nav.pinned.push('time');
        await nextTick();

        expect(JSON.parse(localStorage.getItem(NAV_KEY)).pinned).toEqual(['chat', 'time']);
        expect(navPuts()).toHaveLength(0);

        await vi.runAllTimersAsync();
        expect(navPuts()).toHaveLength(1);
        expect(navPuts()[0][2]).toEqual({ pinned: ['chat', 'time'] });
    });

    it('does not save to the server before the user record is known', async () => {
        const { shellState } = await load();

        shellState.nav.pinned.push('chat');
        await settle();

        expect(JSON.parse(localStorage.getItem(NAV_KEY)).pinned).toEqual(['chat']);
        expect(navPuts()).toHaveLength(0);
    });

    it('keeps the local change and does not retry in a loop when the save fails', async () => {
        const errors = vi.spyOn(console, 'warn').mockImplementation(() => {});
        apiRequestWithoutCompnay.mockRejectedValue(new Error('offline'));
        const { shellState, syncNavPreferences } = await load();
        syncNavPreferences('user-1', { pinned: [] });
        await settle();

        shellState.nav.pinned.push('chat');
        await settle();
        await vi.advanceTimersByTimeAsync(60000);

        expect(navPuts()).toHaveLength(1);
        expect(shellState.nav.pinned).toEqual(['chat']);
        expect(JSON.parse(localStorage.getItem(NAV_KEY)).pinned).toEqual(['chat']);

        shellState.nav.pinned.push('time');
        await settle();
        expect(navPuts()).toHaveLength(2);
        expect(navPuts()[1][2]).toEqual({ pinned: ['chat', 'time'] });
        errors.mockRestore();
    });
});
