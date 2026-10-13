const { newBudget, noteBudget, waitNeeded, roomToLoad, RESERVE } = require('../scripts/atlas/pace');
const { createReader } = require('../scripts/atlas/params');

const NOW = 1_000_000;

describe('atlas pacing against the server rate limit', () => {
    test('with no limiter there is nothing to wait for', () => {
        const budget = noteBudget(newBudget(), { 'content-type': 'application/json' }, NOW);
        expect(waitNeeded(budget, NOW)).toBe(0);
    });

    test('plenty left: carry on', () => {
        const budget = noteBudget(newBudget(), { 'ratelimit-remaining': '900', 'ratelimit-reset': '30' }, NOW);
        expect(waitNeeded(budget, NOW)).toBe(0);
    });

    test('close to the limit: wait for the window to reset, leaving the rest for everyone else', () => {
        const budget = noteBudget(newBudget(), { 'ratelimit-remaining': String(RESERVE - 1), 'ratelimit-reset': '30' }, NOW);
        expect(waitNeeded(budget, NOW)).toBe(30500);
        expect(waitNeeded(budget, NOW + 31000)).toBe(0);
    });

    test('a count without a reset time assumes a one-minute window', () => {
        const budget = noteBudget(newBudget(), { 'ratelimit-remaining': '0' }, NOW);
        expect(budget.resetAt).toBe(NOW + 60000);
    });

    test('after waiting the count starts over', async () => {
        const budget = noteBudget(newBudget(), { 'ratelimit-remaining': '0', 'ratelimit-reset': '5' });
        const pause = jest.fn(async () => {});
        expect(await roomToLoad(budget, { pause })).toBeGreaterThan(0);
        expect(pause).toHaveBeenCalledTimes(1);
        expect(await roomToLoad(budget, { pause })).toBe(0);
    });

    test('a lookup that is rate limited waits and asks again', async () => {
        const limited = { ok: false, status: 429, headers: new Map([['ratelimit-remaining', '0'], ['ratelimit-reset', '7']]) };
        const fine = { ok: true, status: 200, headers: new Map(), json: async () => ({ fine: true }) };
        const fetchImpl = jest.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(fine);
        const pause = jest.fn(async () => {});
        const read = createReader({ baseUrl: 'http://localhost:4000', token: 't', fetchImpl, pause });
        await expect(read('GET', '/api/v1/project')).resolves.toEqual({ fine: true });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(pause.mock.calls[0][0]).toBeGreaterThan(6000);
    });

    test('a lookup that stays rate limited gives up and says so', async () => {
        const limited = { ok: false, status: 429, headers: new Map([['ratelimit-remaining', '0'], ['ratelimit-reset', '1']]) };
        const fetchImpl = jest.fn(async () => limited);
        const read = createReader({ baseUrl: 'http://localhost:4000', token: 't', fetchImpl, pause: async () => {} });
        await expect(read('GET', '/api/v1/project')).rejects.toThrow('answered 429');
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });
});
