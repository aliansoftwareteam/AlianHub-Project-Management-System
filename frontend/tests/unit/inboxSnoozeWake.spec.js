import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({
    useRoute: () => ({ query: { tab: 'primary' }, params: {} }),
    useRouter: () => ({ replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => false }),
}));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import { MAX_WAKE_DELAY_MS, WAKE_MARGIN_MS, wakeDelay, wakeTimer } from '@/views/Inbox/snoozeWake';
import Inbox from '@/views/Inbox/Inbox.vue';

const NOW = '2026-09-26T12:00:00.000Z';
const HOUR = 60 * 60 * 1000;
const inMs = (ms) => new Date(Date.parse(NOW) + ms).toISOString();

describe('how long to wait before re-checking a snooze', () => {
    it('waits until the snooze is due, plus a margin so the server already counts it due', () => {
        expect(WAKE_MARGIN_MS).toBeGreaterThan(0);
        expect(wakeDelay(inMs(90 * 1000), NOW)).toBe(90 * 1000 + WAKE_MARGIN_MS);
    });

    it('re-checks straight after the margin when the time has already passed', () => {
        expect(wakeDelay(inMs(-5 * 60 * 1000), NOW)).toBe(WAKE_MARGIN_MS);
    });

    it('caps a far-off snooze, which setTimeout would overflow past ~24.8 days', () => {
        expect(MAX_WAKE_DELAY_MS).toBeLessThanOrEqual(24 * HOUR);
        expect(wakeDelay(inMs(3 * 24 * HOUR), NOW)).toBe(MAX_WAKE_DELAY_MS);
        expect(wakeDelay(inMs(300 * 24 * HOUR), NOW)).toBe(MAX_WAKE_DELAY_MS);
    });

    it('has nothing to wait for when no snooze is timed, or the time cannot be read', () => {
        expect(wakeDelay(null, NOW)).toBeNull();
        expect(wakeDelay(undefined, NOW)).toBeNull();
        expect(wakeDelay('soon', NOW)).toBeNull();
    });

    it('measures from the server\'s clock, not the browser\'s', () => {
        vi.useFakeTimers({ now: Date.parse(NOW) + 10 * 60 * 1000 });
        expect(wakeDelay(inMs(HOUR), NOW)).toBe(HOUR + WAKE_MARGIN_MS);
        vi.useRealTimers();
    });
});

describe('the snooze wake timer', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('calls back once when the next snooze falls due', () => {
        vi.useFakeTimers({ now: Date.parse(NOW) });
        const onDue = vi.fn();
        wakeTimer(onDue).schedule({ nextWakeAt: inMs(HOUR), now: NOW });
        vi.advanceTimersByTime(HOUR);
        expect(onDue).not.toHaveBeenCalled();
        vi.advanceTimersByTime(WAKE_MARGIN_MS);
        expect(onDue).toHaveBeenCalledTimes(1);
    });

    it('keeps one timer: a newer count replaces the one before it', () => {
        vi.useFakeTimers({ now: Date.parse(NOW) });
        const onDue = vi.fn();
        const timer = wakeTimer(onDue);
        timer.schedule({ nextWakeAt: inMs(HOUR), now: NOW });
        timer.schedule({ nextWakeAt: inMs(2 * HOUR), now: NOW });
        vi.advanceTimersByTime(HOUR + WAKE_MARGIN_MS);
        expect(onDue).not.toHaveBeenCalled();
        vi.advanceTimersByTime(HOUR);
        expect(onDue).toHaveBeenCalledTimes(1);
    });

    it('drops the pending timer when nothing is left snoozed to a time', () => {
        vi.useFakeTimers({ now: Date.parse(NOW) });
        const onDue = vi.fn();
        const timer = wakeTimer(onDue);
        timer.schedule({ nextWakeAt: inMs(HOUR), now: NOW });
        timer.schedule({ nextWakeAt: null, now: NOW });
        vi.advanceTimersByTime(MAX_WAKE_DELAY_MS);
        expect(onDue).not.toHaveBeenCalled();
    });

    it('never fires after it is cleared', () => {
        vi.useFakeTimers({ now: Date.parse(NOW) });
        const onDue = vi.fn();
        const timer = wakeTimer(onDue);
        timer.schedule({ nextWakeAt: inMs(HOUR), now: NOW });
        timer.clear();
        vi.advanceTimersByTime(MAX_WAKE_DELAY_MS);
        expect(onDue).not.toHaveBeenCalled();
    });

    it('falls back to the browser clock when the counts carry no server time', () => {
        vi.useFakeTimers({ now: Date.parse(NOW) });
        const onDue = vi.fn();
        wakeTimer(onDue).schedule({ nextWakeAt: inMs(HOUR) });
        vi.advanceTimersByTime(HOUR + WAKE_MARGIN_MS);
        expect(onDue).toHaveBeenCalledTimes(1);
    });
});

describe('the Inbox page when a snooze falls due while it is open', () => {
    let wrapper;
    afterEach(() => {
        if (wrapper) wrapper.unmount();
        wrapper = null;
        vi.useRealTimers();
    });

    const mountWith = async (nextWakeAt) => {
        vi.useFakeTimers({ now: Date.parse(NOW), toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        window.localStorage.clear();
        apiRequest.mockReset();
        apiRequest.mockImplementation((method, url) => {
            const data = url.endsWith('/counts')
                ? { primary: 0, other: 0, later: 1, nextWakeAt, now: new Date().toISOString() }
                : { items: [], approvals: [], proposals: [], hasMore: false, nextSkip: 0 };
            return Promise.resolve({ data: { status: true, data } });
        });
        wrapper = mount(Inbox, { attachTo: document.body, global: { stubs: { UserProfile: true, ShellIcon: true } } });
        await flushPromises();
    };
    const listReads = () => apiRequest.mock.calls.filter(([method, url]) => method === 'get' && !url.endsWith('/counts')).length;

    it('reloads the list once the snooze is due', async () => {
        await mountWith(inMs(HOUR));
        const before = listReads();
        vi.advanceTimersByTime(HOUR);
        await flushPromises();
        expect(listReads()).toBe(before);
        vi.advanceTimersByTime(WAKE_MARGIN_MS);
        await flushPromises();
        expect(listReads()).toBe(before + 1);
    });

    it('stops waiting once the page is left', async () => {
        await mountWith(inMs(HOUR));
        const before = apiRequest.mock.calls.length;
        wrapper.unmount();
        wrapper = null;
        vi.advanceTimersByTime(MAX_WAKE_DELAY_MS);
        await flushPromises();
        expect(apiRequest.mock.calls.length).toBe(before);
    });
});
