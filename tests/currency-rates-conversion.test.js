jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const HOURS = 60 * 60 * 1000;
let axios;
let rates;
let now;

beforeEach(() => {
    jest.resetModules();
    axios = require('axios');
    axios.get.mockReset();
    rates = require('../utils/currencyRates');
    now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => jest.restoreAllMocks());

const live = (table) => ({ data: { result: 'success', rates: { USD: 1, ...table } } });

describe('toUsd', () => {
    const table = { EUR: 0.5, INR: 80 };

    it('divides by the rate: 1 USD = N units', () => {
        expect(rates.toUsd(100, 'EUR', table)).toBe(200);
        expect(rates.toUsd(800, 'INR', table)).toBe(10);
    });

    it('leaves USD and a blank currency as they are', () => {
        expect(rates.toUsd(42, 'USD', table)).toBe(42);
        expect(rates.toUsd(42, 'usd', table)).toBe(42);
        expect(rates.toUsd(42, '', table)).toBe(42);
        expect(rates.toUsd(42, undefined, table)).toBe(42);
    });

    it('reads the currency code in any letter case', () => {
        expect(rates.toUsd(100, 'eur', table)).toBe(200);
    });

    it('passes the amount through when the currency is unknown, so totals are not understated', () => {
        expect(rates.toUsd(100, 'XYZ', table)).toBe(100);
        expect(rates.toUsd(100, 'EUR', undefined)).toBe(100);
        expect(rates.toUsd(100, 'EUR', null)).toBe(100);
    });

    it('does not divide by a zero or negative rate', () => {
        expect(rates.toUsd(100, 'EUR', { EUR: 0 })).toBe(100);
        expect(rates.toUsd(100, 'EUR', { EUR: -2 })).toBe(100);
        expect(rates.toUsd(100, 'EUR', { EUR: 'abc' })).toBe(100);
    });

    it('turns missing or non-numeric amounts into zero', () => {
        expect(rates.toUsd(undefined, 'EUR', table)).toBe(0);
        expect(rates.toUsd('abc', 'EUR', table)).toBe(0);
        expect(rates.toUsd(null, 'EUR', table)).toBe(0);
        expect(rates.toUsd(0, 'EUR', table)).toBe(0);
    });

    it('accepts numeric text and negative amounts', () => {
        expect(rates.toUsd('100', 'EUR', table)).toBe(200);
        expect(rates.toUsd(-100, 'EUR', table)).toBe(-200);
    });
});

describe('getUsdRates', () => {
    it('returns the live table when the service answers', async () => {
        axios.get.mockResolvedValue(live({ EUR: 0.9 }));
        const result = await rates.getUsdRates();
        expect(result.live).toBe(true);
        expect(result.rates.EUR).toBe(0.9);
    });

    it('serves the cached table for 12 hours without asking again', async () => {
        axios.get.mockResolvedValue(live({ EUR: 0.9 }));
        await rates.getUsdRates();
        now += 11 * HOURS;
        const again = await rates.getUsdRates();
        expect(again.rates.EUR).toBe(0.9);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('asks again once the cache is 12 hours old', async () => {
        axios.get.mockResolvedValueOnce(live({ EUR: 0.9 })).mockResolvedValueOnce(live({ EUR: 0.8 }));
        await rates.getUsdRates();
        now += 12 * HOURS;
        const fresh = await rates.getUsdRates();
        expect(fresh.rates.EUR).toBe(0.8);
    });

    it('falls back to the built-in table when the service is down and nothing is cached', async () => {
        axios.get.mockRejectedValue(new Error('offline'));
        const result = await rates.getUsdRates();
        expect(result.live).toBe(false);
        expect(result.rates).toBe(rates.FALLBACK_RATES);
        expect(result.rates.USD).toBe(1);
    });

    it('falls back when the service answers with an error payload', async () => {
        axios.get.mockResolvedValue({ data: { result: 'error' } });
        const result = await rates.getUsdRates();
        expect(result.live).toBe(false);
        expect(result.rates.EUR).toBe(rates.FALLBACK_RATES.EUR);
    });

    it('falls back when the payload has no USD rate', async () => {
        axios.get.mockResolvedValue({ data: { result: 'success', rates: { EUR: 0.9 } } });
        expect((await rates.getUsdRates()).live).toBe(false);
    });

    it('keeps the last good live rates, marked as not live, when a refresh fails', async () => {
        axios.get.mockResolvedValueOnce(live({ EUR: 0.9 })).mockRejectedValueOnce(new Error('offline'));
        await rates.getUsdRates();
        now += 13 * HOURS;
        const stale = await rates.getUsdRates();
        expect(stale.rates.EUR).toBe(0.9);
        expect(stale.live).toBe(false);
    });

    it('never throws', async () => {
        axios.get.mockImplementation(() => { throw new Error('sync failure'); });
        await expect(rates.getUsdRates()).resolves.toMatchObject({ live: false });
    });
});
