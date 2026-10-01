const NOW = '2026-01-14T10:00:00.000Z';
const SEEDED = '2026-01-14T08:00:00.000Z';
const TIMEZONE = 'UTC';
const LOCALE = 'en-US';

const ISO_STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})/g;
const REAL_MS_PER_FROZEN_MS = 1000;

/* The server stamps the seeded records with the real time of the run, which no clock in the
 * page can change. Every such stamp in a response becomes the seeded moment plus one
 * millisecond for each real second since the run began: the minute on screen is the same on
 * every run, and records still sort in the order they were made. Dates outside the run
 * (due dates, expiries) pass through. Numbers are left alone: an id made from Date.now()
 * would stop being unique. */
function freezeTimestamps(text, { from, to, stamp = SEEDED }) {
    const base = Date.parse(stamp);
    return String(text).replace(ISO_STAMP, (match) => {
        const at = Date.parse(match);
        if (!(at >= from && at <= to)) return match;
        return new Date(base + Math.floor((at - from) / REAL_MS_PER_FROZEN_MS)).toISOString();
    });
}

module.exports = { NOW, SEEDED, TIMEZONE, LOCALE, freezeTimestamps };
