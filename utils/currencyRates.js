// Live USD foreign-exchange rates for the milestone report.
//
// AlianHub stores each milestone's amount in its parent project's currency, but
// the management dashboard shows a single consolidated figure — so we normalise
// everything to USD. Rates come from open.er-api.com (free, keyless). Its
// response is keyed by ISO code as "1 USD = N units", therefore:
//
//     usdAmount = amountInLocalCurrency / rates[localCode]
//
// The table is cached in-process for 12h and falls back to a static table so
// the card still renders on an offline / air-gapped self-hosted box, or when
// the upstream API is unreachable. getUsdRates() never throws.

const axios = require("axios");
const logger = require("../Config/loggerConfig");

const RATES_URL = "https://open.er-api.com/v6/latest/USD";
const TTL_MS = 12 * 60 * 60 * 1000; // refresh at most twice a day

// Approximate static fallback (rough 2026 levels). Only used when the live API
// is unreachable AND nothing has been cached yet. Extend as needed — any code
// missing here (and from the live feed) is left unconverted.
const FALLBACK_RATES = {
    USD: 1, EUR: 0.92, GBP: 0.79, INR: 83, AUD: 1.52, CAD: 1.36,
    AED: 3.67, SGD: 1.35, JPY: 157, CNY: 7.2, NZD: 1.64, CHF: 0.88,
    ZAR: 18.5, BRL: 5.4, MXN: 18, HKD: 7.8, SEK: 10.5, NOK: 10.7,
    DKK: 6.9, PLN: 4, THB: 36, MYR: 4.7, PHP: 58, IDR: 16200, RUB: 90,
};

let cache = { rates: null, fetchedAt: 0, live: false };

// Resolve the current USD rate table: live if fresh & reachable, else the last
// good cache, else the static fallback. Returns { rates, fetchedAt, live }.
async function getUsdRates() {
    const now = Date.now();
    if (cache.rates && now - cache.fetchedAt < TTL_MS) return cache;

    try {
        const { data } = await axios.get(RATES_URL, { timeout: 5000 });
        if (data && data.result === "success" && data.rates && data.rates.USD) {
            cache = { rates: data.rates, fetchedAt: now, live: true };
            return cache;
        }
        logger.warn("currencyRates: unexpected FX API payload; using fallback/cached rates");
    } catch (err) {
        logger.warn(`currencyRates: live FX fetch failed (${err && err.message ? err.message : err}); using fallback/cached rates`);
    }

    // Keep the last successful rates if we have them; otherwise the static table.
    if (cache.rates) return { ...cache, live: false };
    cache = { rates: FALLBACK_RATES, fetchedAt: now, live: false };
    return cache;
}

// Convert `amount` (in ISO `code`) to USD using a rates table from getUsdRates.
// Unknown / missing code → pass the amount through unconverted (we can't guess
// a rate, and dropping it would understate totals).
function toUsd(amount, code, rates) {
    const n = Number(amount) || 0;
    if (!n) return 0;
    const c = String(code || "").toUpperCase();
    if (!c || c === "USD") return n;
    const rate = rates && Number(rates[c]);
    if (!rate || rate <= 0) return n; // unknown currency — leave as-is
    return n / rate;
}

module.exports = { getUsdRates, toUsd, FALLBACK_RATES };
