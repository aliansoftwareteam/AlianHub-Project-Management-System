/* The server counts API requests per address per minute (GLOBAL_RATE_LIMIT_PER_MIN), and on a
 * developer machine the atlas shares that count with every browser tab and script pointed at
 * localhost. It reads the count the server reports and waits out the minute before it would
 * take the last of it. */

const RESERVE = 300;
const DEFAULT_WINDOW_SECONDS = 60;
const SLACK_MS = 500;

const newBudget = () => ({ remaining: Infinity, resetAt: 0 });

function noteBudget(budget, headers, now = Date.now()) {
    const remaining = Number(headers['ratelimit-remaining']);
    if (headers['ratelimit-remaining'] === undefined || !Number.isFinite(remaining)) return budget;
    const reset = Number(headers['ratelimit-reset'] ?? headers['retry-after']);
    budget.remaining = remaining;
    budget.resetAt = now + (Number.isFinite(reset) && reset >= 0 ? reset : DEFAULT_WINDOW_SECONDS) * 1000;
    return budget;
}

function waitNeeded(budget, now = Date.now(), reserve = RESERVE) {
    if (budget.remaining >= reserve || now >= budget.resetAt) return 0;
    return budget.resetAt - now + SLACK_MS;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function roomToLoad(budget, { reserve = RESERVE, pause = sleep } = {}) {
    const wait = waitNeeded(budget, Date.now(), reserve);
    if (!wait) return 0;
    await pause(wait);
    budget.remaining = Infinity;
    return wait;
}

module.exports = { RESERVE, newBudget, noteBudget, waitNeeded, roomToLoad, sleep };
