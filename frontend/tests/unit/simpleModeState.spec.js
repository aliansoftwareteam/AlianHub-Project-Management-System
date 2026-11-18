/* Task 047, slice S-1: the Simple or Full choice lives on the person's record, is remembered in
   this browser for that person only, and a record without one means Full. */
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

const navPuts = () => apiRequestWithoutCompnay.mock.calls.filter(([method, url]) => method === 'put' && url === ROUTE).map(([, , body]) => body);
const settle = async () => {
    await nextTick();
    await vi.runAllTimersAsync();
};
const stored = () => JSON.parse(localStorage.getItem(NAV_KEY));

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('userId', 'user-1');
    apiRequestWithoutCompnay.mockReset();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { pinned: [] } } });
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('which mode an account starts in', () => {
    it('is Full before anything is known', async () => {
        const { shellState } = await load();
        expect(shellState.nav.mode).toBe('full');
    });

    it('is Simple for a record that carries the choice a new account is given', async () => {
        const { shellState, syncNavPreferences } = await load();
        syncNavPreferences('user-1', { mode: 'simple' });
        await settle();
        expect(shellState.nav.mode).toBe('simple');
        expect(shellState.nav.pinned).toEqual([]);
        expect(navPuts()).toEqual([]);
    });

    it.each([
        ['no preferences at all', undefined],
        ['only kept places', { pinned: ['chat'] }],
        ['a value this version does not know', { mode: 'expert' }],
    ])('is Full for an account with %s', async (_name, record) => {
        const { shellState, syncNavPreferences } = await load();
        syncNavPreferences('user-1', record);
        await settle();
        expect(shellState.nav.mode).toBe('full');
        expect(navPuts()).toEqual([]);
    });

    it('takes the record over what this browser remembered', async () => {
        localStorage.setItem(NAV_KEY, JSON.stringify({ pinned: [], mode: 'simple', uid: 'user-1' }));
        const { shellState, syncNavPreferences } = await load();
        expect(shellState.nav.mode).toBe('simple');
        syncNavPreferences('user-1', { mode: 'full' });
        await settle();
        expect(shellState.nav.mode).toBe('full');
    });
});

describe('switching', () => {
    it('takes effect at once and saves only the mode', async () => {
        const { shellState, syncNavPreferences, applyNavMode } = await load();
        syncNavPreferences('user-1', { pinned: ['planner'] });
        await settle();

        const saved = applyNavMode('simple');
        expect(shellState.nav.mode).toBe('simple');
        expect(await saved).toBe(true);
        await settle();
        expect(navPuts()).toEqual([{ mode: 'simple' }]);
        expect(shellState.nav.pinned).toEqual(['planner']);
    });

    it('survives a reload in this browser, for this person only', async () => {
        const first = await load();
        first.syncNavPreferences('user-1', undefined);
        await first.applyNavMode('simple');
        await settle();
        expect(stored()).toMatchObject({ mode: 'simple', uid: 'user-1' });

        const again = await load();
        expect(again.shellState.nav.mode).toBe('simple');

        localStorage.setItem('userId', 'user-2');
        const other = await load();
        expect(other.shellState.nav.mode).toBe('full');
    });

    it('asks nothing of the server when the mode is already the one chosen, or is not a mode', async () => {
        const { shellState, syncNavPreferences, applyNavMode } = await load();
        syncNavPreferences('user-1', { mode: 'simple' });
        expect(await applyNavMode('simple')).toBe(true);
        expect(await applyNavMode('expert')).toBe(false);
        await settle();
        expect(shellState.nav.mode).toBe('simple');
        expect(navPuts()).toEqual([]);
    });

    it('goes back when the server refuses or cannot be reached', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { shellState, syncNavPreferences, applyNavMode } = await load();
        syncNavPreferences('user-1', undefined);

        apiRequestWithoutCompnay.mockRejectedValueOnce(new Error('offline'));
        expect(await applyNavMode('simple')).toBe(false);
        expect(shellState.nav.mode).toBe('full');

        apiRequestWithoutCompnay.mockResolvedValueOnce({ data: { status: false } });
        expect(await applyNavMode('simple')).toBe(false);
        expect(shellState.nav.mode).toBe('full');
        await settle();
        expect(stored().mode).toBe('full');
    });
});

describe('keeping a place on the rail', () => {
    it('saves the place with the others, once', async () => {
        const { shellState, syncNavPreferences, keepOnRail } = await load();
        syncNavPreferences('user-1', { mode: 'simple', pinned: ['planner'] });
        await settle();

        keepOnRail('dash');
        keepOnRail('dash');
        keepOnRail('planner');
        await settle();
        expect(shellState.nav.pinned).toEqual(['planner', 'dash']);
        expect(navPuts()).toEqual([{ pinned: ['planner', 'dash'] }]);
    });

    it('keeps nothing for one of the five places, or in Full', async () => {
        const { shellState, syncNavPreferences, keepOnRail, applyNavMode } = await load();
        syncNavPreferences('user-1', { mode: 'simple' });
        await settle();
        keepOnRail('home');
        keepOnRail('ai');
        await applyNavMode('full');
        keepOnRail('planner');
        await settle();
        expect(shellState.nav.pinned).toEqual([]);
        expect(navPuts()).toEqual([{ mode: 'full' }]);
    });
});
