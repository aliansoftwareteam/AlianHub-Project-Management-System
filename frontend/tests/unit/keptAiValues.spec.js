import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => services);

import { readKept } from '@/views/Projects/TableView/keptAiValues';

const flushBurst = async () => {
    await vi.advanceTimersByTimeAsync(30);
};

beforeEach(() => {
    vi.useFakeTimers();
    services.apiRequest.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('readKept', () => {
    it('sends the asks of one burst as a single read', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { values: { t1: { summary: 'S1' }, t2: { summary: 'S2' } } } } });
        const first = readKept('summary', 't1');
        const second = readKept('summary', 't2');
        await flushBurst();
        expect(services.apiRequest).toHaveBeenCalledTimes(1);
        expect(services.apiRequest.mock.calls[0][2]).toEqual({ taskIds: ['t1', 't2'], kinds: ['summary'] });
        expect(await first).toBe('S1');
        expect(await second).toBe('S2');
    });

    it('waits for the burst to end before asking', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { values: {} } } });
        readKept('summary', 't1');
        await vi.advanceTimersByTimeAsync(10);
        expect(services.apiRequest).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(25);
        expect(services.apiRequest).toHaveBeenCalledTimes(1);
    });

    it('asks once for each kind even when several rows want it', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { values: {} } } });
        readKept('summary', 't1');
        readKept('summary', 't2');
        readKept('risk', 't2');
        await flushBurst();
        expect(services.apiRequest.mock.calls[0][2].kinds).toEqual(['summary', 'risk']);
    });

    it('answers each kind of one task from its own value', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { values: { t1: { summary: 'S', risk: 'High' } } } } });
        const summary = readKept('summary', 't1');
        const risk = readKept('risk', 't1');
        await flushBurst();
        expect(await summary).toBe('S');
        expect(await risk).toBe('High');
    });

    it('answers null for a task that keeps nothing', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { values: { t1: {} } } } });
        const none = readKept('summary', 't1');
        const absent = readKept('summary', 't9');
        await flushBurst();
        expect(await none).toBeNull();
        expect(await absent).toBeNull();
    });

    it('answers null for every ask when the server sends no values', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: {} } });
        const answer = readKept('summary', 't1');
        await flushBurst();
        expect(await answer).toBeNull();
    });

    it('answers undefined when the read is refused', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: false } });
        const answer = readKept('summary', 't1');
        await flushBurst();
        expect(await answer).toBeUndefined();
    });

    it('answers undefined when the read fails', async () => {
        services.apiRequest.mockImplementation(() => Promise.reject(new Error('offline')));
        const answer = readKept('summary', 't1');
        await flushBurst();
        expect(await answer).toBeUndefined();
    });

    it('reads a numeric task id as the text the server keys by', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { values: { 42: { summary: 'Forty-two' } } } } });
        const answer = readKept('summary', 42);
        await flushBurst();
        expect(services.apiRequest.mock.calls[0][2].taskIds).toEqual(['42']);
        expect(await answer).toBe('Forty-two');
    });

    it('splits a burst of 250 tasks into reads of at most 100', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { values: {} } } });
        const asks = Array.from({ length: 250 }, (_, index) => readKept('summary', `t${index}`));
        await flushBurst();
        await Promise.all(asks);
        const sizes = services.apiRequest.mock.calls.map((call) => call[2].taskIds.length);
        expect(sizes).toEqual([100, 100, 50]);
    });

    it('starts a new read for asks that come after the burst was sent', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { values: {} } } });
        const early = readKept('summary', 't1');
        await flushBurst();
        await early;
        const late = readKept('summary', 't2');
        await flushBurst();
        await late;
        expect(services.apiRequest).toHaveBeenCalledTimes(2);
    });
});
