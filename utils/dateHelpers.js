/**
 * BUG-042 / #96 — small luxon-based date helpers replacing the
 * back-end's last `moment` usages. CLAUDE.md says the project
 * standardised on Luxon; this lets us drop `moment` from the backend.
 *
 * Frontend `moment` usage is NOT touched here — that's hundreds of
 * call sites and a separate, larger migration.
 */

const { DateTime } = require('luxon');

/**
 * Translate moment-style format tokens to luxon-style. Covers only the
 * tokens the backend actually uses (`YYYY`, `MM`, `DD`, `HH`, `mm`,
 * `ss`, `A`, `a`, `ddd`, `dddd`, `Do`, `MMM`). Anything else passes
 * through; in luxon-style strings already, the output is unchanged
 * because none of these tokens collide.
 */
function momentToLuxonFormat(fmt) {
    if (typeof fmt !== 'string' || !fmt) return fmt;
    // Order matters: replace longer tokens first.
    return fmt
        .replace(/dddd/g, 'cccc')
        .replace(/ddd/g, 'ccc')
        .replace(/YYYY/g, 'yyyy')
        .replace(/YY/g, 'yy')
        .replace(/MMMM/g, 'LLLL')
        .replace(/MMM/g, 'LLL')
        .replace(/\bMM\b/g, 'LL')   // bare MM = month
        .replace(/\bDD\b/g, 'dd');  // bare DD = day-of-month
}
exports.momentToLuxonFormat = momentToLuxonFormat;

/**
 * Format a JS Date / numeric millis / Firestore-style {seconds}
 * timestamp using a luxon format token string. Accepts moment-style
 * tokens too (translated via `momentToLuxonFormat`) so callers can be
 * migrated incrementally.
 */
exports.formatDate = (input, fmt = 'yyyy-LL-dd') => {
    if (input == null) return '';
    let dt;
    if (input && typeof input === 'object' && typeof input.seconds === 'number') {
        dt = DateTime.fromMillis(input.seconds * 1000);
    } else if (input instanceof Date) {
        dt = DateTime.fromJSDate(input);
    } else if (typeof input === 'number') {
        dt = DateTime.fromMillis(input);
    } else {
        // Strings — assume ISO; if not parseable luxon returns invalid.
        dt = DateTime.fromISO(String(input));
        if (!dt.isValid) dt = DateTime.fromJSDate(new Date(input));
    }
    return dt.isValid ? dt.toFormat(momentToLuxonFormat(fmt)) : '';
};

/**
 * Reproduce the exact output the notification email helpers used to
 * produce with moment.calendar({...all six keys: 'DD-MM-YYYY HH:MM A [IST]'}).
 *
 * Since every branch in the original code used the SAME format string,
 * the calendar wrapper was effectively a no-op — the output is always
 * the configured fixed format. We preserve the literal output
 * (including the original `MM` token in the time slot, which is
 * actually moment's "month number" rather than minutes — pre-existing
 * behaviour we don't change here).
 */
exports.formatNotificationDate = (input) => {
    if (input == null) return 'N/A';
    let dt;
    if (input instanceof Date) dt = DateTime.fromJSDate(input);
    else if (typeof input === 'number') dt = DateTime.fromMillis(input);
    else if (typeof input === 'object' && typeof input.seconds === 'number') dt = DateTime.fromMillis(input.seconds * 1000);
    else dt = DateTime.fromJSDate(new Date(input));
    if (!dt.isValid) return 'N/A';
    // moment's `A` = uppercase AM/PM. luxon `a` is lowercase; uppercase
    // only the meridiem.
    const meridiem = dt.hour >= 12 ? 'PM' : 'AM';
    // Preserve original `HH:MM` (month-in-time-slot) quirk.
    return `${dt.toFormat('dd-LL-yyyy HH:LL')} ${meridiem} [IST]`;
};
