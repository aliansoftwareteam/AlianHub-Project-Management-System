const RESERVE = 200;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/* The server counts API requests per address and minute (GLOBAL_RATE_LIMIT_PER_MIN) and refuses the rest, which would
 * fail a measurement and anyone else using the same server. `room(n)` waits for the next window unless n requests fit
 * with a reserve left over. A server with the limit switched off sends no RateLimit headers and is never waited on. */
const pacer = ({ base, log = () => {}, wait = sleep, reserve = RESERVE }) => async function room(needed) {
    const response = await fetch(`${base}/health`);
    await response.arrayBuffer();
    const remaining = Number(response.headers.get('ratelimit-remaining'));
    const reset = Number(response.headers.get('ratelimit-reset'));
    if (!response.headers.has('ratelimit-remaining') || !Number.isFinite(remaining)) return 0;
    if (remaining >= needed + reserve) return 0;
    const seconds = (Number.isFinite(reset) ? reset : 60) + 1;
    log(`Waiting ${seconds} s for the server's request limit to reset (${remaining} left, ${needed} needed).`);
    await wait(seconds * 1000);
    return seconds;
};

module.exports = { pacer };
