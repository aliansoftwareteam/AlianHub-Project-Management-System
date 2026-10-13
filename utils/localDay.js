const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TZ_OFFSET = 14 * 60;

/* The offset is the browser's getTimezoneOffset(): minutes to add to local time to reach UTC. */
const normaliseTzOffset = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && Math.abs(n) <= MAX_TZ_OFFSET ? n : 0;
};

const localDayStart = (at, tzOffset = 0) => {
    const offsetMs = normaliseTzOffset(tzOffset) * 60000;
    const local = new Date(new Date(at).getTime() - offsetMs);
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offsetMs);
};

const localWeekday = (at, tzOffset = 0) => new Date(new Date(at).getTime() - normaliseTzOffset(tzOffset) * 60000).getUTCDay();

module.exports = { DAY_MS, normaliseTzOffset, localDayStart, localWeekday };
