export const WAKE_MARGIN_MS = 1000;
// setTimeout overflows past ~24.8 days; a far-off snooze just re-checks and re-arms.
export const MAX_WAKE_DELAY_MS = 6 * 60 * 60 * 1000;

const timeOf = (v) => (v === null || v === undefined || v === '' ? NaN : new Date(v).getTime());

/** Milliseconds until `nextWakeAt` has passed on the server whose clock read `now`, or null for no wake. */
export const wakeDelay = (nextWakeAt, now = Date.now()) => {
    const at = timeOf(nextWakeAt);
    const from = timeOf(now);
    if (Number.isNaN(at) || Number.isNaN(from)) return null;
    return Math.min(Math.max(at - from, 0) + WAKE_MARGIN_MS, MAX_WAKE_DELAY_MS);
};

/** One pending wake per caller: each counts response replaces the last one's timer. */
export const wakeTimer = (onDue) => {
    let timer = null;
    const clear = () => {
        clearTimeout(timer);
        timer = null;
    };
    const schedule = (counts) => {
        clear();
        const delay = wakeDelay(counts?.nextWakeAt, counts?.now ?? Date.now());
        if (delay !== null) timer = setTimeout(onDue, delay);
    };
    return { schedule, clear };
};
