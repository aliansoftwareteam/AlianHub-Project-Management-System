/**
 * BUG-045 bootstrap test — exercises `utils/dateHelpers.js` (introduced
 * in BUG-042 / #96) covering moment-token translation, formatDate
 * input shapes, and the notification-date formatter.
 *
 * Skips when the helper module isn't on this branch yet (e.g. before
 * the BUG-042 PR has merged to staging).
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '../..');

let helpers;
try {
    helpers = require(path.resolve(ROOT, 'utils/dateHelpers.js'));
} catch (_) {
    helpers = null;
}

const d = helpers ? describe : describe.skip;
const { momentToLuxonFormat = null, formatDate = null, formatNotificationDate = null } = helpers || {};

d('utils/dateHelpers.momentToLuxonFormat', () => {
    test('translates the common moment tokens', () => {
        expect(momentToLuxonFormat('YYYY-MM-DD')).toBe('yyyy-LL-dd');
        expect(momentToLuxonFormat('DD/MM/YYYY HH:mm:ss')).toBe('dd/LL/yyyy HH:mm:ss');
        expect(momentToLuxonFormat('MMM ddd YYYY')).toBe('LLL ccc yyyy');
    });

    test('passes luxon-style strings through unchanged', () => {
        expect(momentToLuxonFormat('yyyy-LL-dd')).toBe('yyyy-LL-dd');
        expect(momentToLuxonFormat('cccc')).toBe('cccc');
    });

    test('handles empty / non-string input', () => {
        expect(momentToLuxonFormat('')).toBe('');
        expect(momentToLuxonFormat(undefined)).toBe(undefined);
    });
});

d('utils/dateHelpers.formatDate', () => {
    const sample = new Date(Date.UTC(2024, 0, 15, 10, 30, 0));

    test('formats a JS Date with moment-style tokens', () => {
        expect(formatDate(sample, 'YYYY-MM-DD')).toBe('2024-01-15');
    });

    test('formats a JS Date with luxon-style tokens', () => {
        expect(formatDate(sample, 'yyyy-LL-dd')).toBe('2024-01-15');
    });

    test('accepts a {seconds} timestamp shape', () => {
        const result = formatDate({ seconds: sample.getTime() / 1000 }, 'YYYY-MM-DD');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('returns empty string for null/undefined input', () => {
        expect(formatDate(null)).toBe('');
        expect(formatDate(undefined)).toBe('');
    });
});

d('utils/dateHelpers.formatNotificationDate', () => {
    test('produces a fixed DD-MM-YYYY HH:MM A [IST] shape', () => {
        const date = new Date(Date.UTC(2024, 0, 15, 10, 30, 0));
        const out = formatNotificationDate(date);
        expect(out).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2} (AM|PM) \[IST\]$/);
    });

    test('returns N/A for nullish input', () => {
        expect(formatNotificationDate(null)).toBe('N/A');
        expect(formatNotificationDate(undefined)).toBe('N/A');
    });
});
