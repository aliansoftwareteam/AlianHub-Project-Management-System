export const SNOOZE_PRESETS = Object.freeze(['later_today', 'tomorrow', 'next_week', 'until_change']);

const HOUR_MS = 60 * 60 * 1000;
const MORNING = 9;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const browserZone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
};

export const resolveTimeZone = (timeZone) => {
    if (!timeZone) return browserZone();
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return timeZone;
    } catch (e) {
        return browserZone();
    }
};

const partsIn = (date, timeZone) => {
    const out = {};
    new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', weekday: 'short',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(date).forEach((p) => { out[p.type] = p.value; });
    return {
        year: Number(out.year), month: Number(out.month), day: Number(out.day),
        hour: Number(out.hour) % 24, minute: Number(out.minute), second: Number(out.second),
        weekday: WEEKDAYS.indexOf(out.weekday),
    };
};

const offsetAt = (date, timeZone) => {
    const p = partsIn(date, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (date.getTime() - date.getUTCMilliseconds());
};

// The second pass settles a wall-clock time that sits next to a daylight-saving change.
const wallToUtc = ({ year, month, day, hour, minute }, timeZone) => {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    const first = guess - offsetAt(new Date(guess), timeZone);
    return new Date(guess - offsetAt(new Date(first), timeZone));
};

const plusDays = ({ year, month, day }, n) => {
    const d = new Date(Date.UTC(year, month - 1, day + n));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

export const zonedToUtc = (value, timeZone) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
    if (!m) return null;
    return wallToUtc({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] }, resolveTimeZone(timeZone));
};

const pad = (n) => String(n).padStart(2, '0');

/** A `datetime-local` value for an instant, as the clock reads in the zone. */
export const toZonedInput = (date, timeZone) => {
    const p = partsIn(date, resolveTimeZone(timeZone));
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
};

/** The request body for a preset: `{ until }` as ISO, `{ untilChange: true }`, or null for a time already past. */
export const snoozeTarget = (preset, { now = new Date(), timeZone, value } = {}) => {
    const tz = resolveTimeZone(timeZone);
    if (preset === 'until_change') return { untilChange: true };
    let at = null;
    if (preset === 'later_today') {
        const p = partsIn(new Date(now.getTime() + 3 * HOUR_MS), tz);
        at = wallToUtc({ ...p, hour: p.minute || p.second ? p.hour + 1 : p.hour, minute: 0 }, tz);
    } else if (preset === 'tomorrow') {
        at = wallToUtc({ ...plusDays(partsIn(now, tz), 1), hour: MORNING, minute: 0 }, tz);
    } else if (preset === 'next_week') {
        const today = partsIn(now, tz);
        at = wallToUtc({ ...plusDays(today, ((8 - today.weekday) % 7) || 7), hour: MORNING, minute: 0 }, tz);
    } else if (preset === 'custom') {
        at = zonedToUtc(value, tz);
    }
    if (!at || Number.isNaN(at.getTime()) || at <= now) return null;
    return { until: at.toISOString() };
};

export const formatWhen = (iso, timeZone, locale) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(locale || [], {
        timeZone: resolveTimeZone(timeZone), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
};
