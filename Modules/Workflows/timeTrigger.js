// A schedule as a trigger, in the catalogue the automation builder already has.
//
// Everything a rule can start from lives in one manifest, and this joins it
// rather than starting a second list: `schedule.due` is an entry in
// Modules/Automations/engine/registry, and a rule that uses it is validated,
// described and rendered by the same code every other rule is. What it does not
// have is an event to match against — nothing publishes it — so it is offered
// only while WORKFLOW_ENGINE is on, and what turns a due schedule into a run is
// the workflow queue in sprint 5 step 3.
//
// The vocabulary is deliberately not cron. A cron string is a small programming
// language a builder cannot render and a person reads wrong; four shapes cover
// what a monitoring cycle actually asks for, and a fifth can be added the day
// somebody needs it.

const EVENT = 'schedule.due';

const EVERY = Object.freeze(['minute', 'hour', 'day', 'week']);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const validateSchedule = (schedule, path = 'trigger.schedule') => {
    const errors = [];
    if (!isPlainObject(schedule)) return [`${path}: required`];
    if (!EVERY.includes(schedule.every)) errors.push(`${path}.every: must be one of ${EVERY.join(', ')}`);
    if (schedule.timezone && String(schedule.timezone).toUpperCase() !== 'UTC') errors.push(`${path}.timezone: only UTC is supported`);

    if (schedule.every === 'hour' || schedule.every === 'minute') {
        if (schedule.minute !== undefined && !(Number.isInteger(schedule.minute) && schedule.minute >= 0 && schedule.minute <= 59)) {
            errors.push(`${path}.minute: must be 0 to 59`);
        }
    }
    if (schedule.every === 'day' || schedule.every === 'week') {
        if (!TIME.test(String(schedule.at || ''))) errors.push(`${path}.at: must be HH:MM`);
    }
    if (schedule.every === 'week' && !(Number.isInteger(schedule.weekday) && schedule.weekday >= 0 && schedule.weekday <= 6)) {
        errors.push(`${path}.weekday: must be 0 (Sunday) to 6`);
    }
    return errors;
};

const atOf = (schedule) => {
    const [hours, minutes] = String(schedule.at || '00:00').split(':').map(Number);
    return { hours, minutes };
};

/* The first moment strictly after `from` that the schedule names. Strictly, so
 * that asking again with the moment it just fired moves on rather than handing
 * back the same one forever. */
const nextOccurrence = (schedule, from = new Date()) => {
    const errors = validateSchedule(schedule);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { name: 'ValidationError', deterministic: true });

    const after = from instanceof Date ? from : new Date(from);
    const next = new Date(after.getTime());
    next.setUTCSeconds(0, 0);

    if (schedule.every === 'minute') {
        next.setTime(next.getTime() + MINUTE_MS);
        return next;
    }
    if (schedule.every === 'hour') {
        next.setUTCMinutes(Number.isInteger(schedule.minute) ? schedule.minute : 0);
        while (next <= after) next.setTime(next.getTime() + HOUR_MS);
        return next;
    }

    const { hours, minutes } = atOf(schedule);
    next.setUTCHours(hours, minutes, 0, 0);
    if (schedule.every === 'day') {
        while (next <= after) next.setTime(next.getTime() + DAY_MS);
        return next;
    }

    const shift = (schedule.weekday - next.getUTCDay() + 7) % 7;
    next.setTime(next.getTime() + shift * DAY_MS);
    while (next <= after) next.setTime(next.getTime() + WEEK_MS);
    return next;
};

/* Due when the occurrence that follows the last firing has arrived. A schedule
 * that has never fired is due from the moment it was saved, not from the epoch,
 * so turning one on does not immediately fire for every hour it did not exist. */
const isDue = (schedule, { lastFiredAt = null, since = null, now = new Date() } = {}) => {
    const from = lastFiredAt || since;
    if (!from) return false;
    return nextOccurrence(schedule, new Date(from)) <= now;
};

const describe = (schedule) => {
    if (validateSchedule(schedule).length) return 'an invalid schedule';
    if (schedule.every === 'minute') return 'every minute';
    if (schedule.every === 'hour') return `every hour at :${String(Number.isInteger(schedule.minute) ? schedule.minute : 0).padStart(2, '0')}`;
    if (schedule.every === 'day') return `every day at ${schedule.at} UTC`;
    return `every week on day ${schedule.weekday} at ${schedule.at} UTC`;
};

module.exports = { EVENT, EVERY, validateSchedule, nextOccurrence, isDue, describe };
