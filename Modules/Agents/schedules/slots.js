const { DateTime, IANAZone } = require('luxon');

// When a schedule fires, in the schedule's own time zone. Three rhythms rather than
// cron: they are what a briefing or a digest needs and what the editor can show.
// Luxon keeps 09:00 at 09:00 local across a daylight-saving change.

const EVERY = Object.freeze(['daily', 'weekdays', 'weekly']);
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_STEPS = 8;

const isValidZone = (zone) => typeof zone === 'string' && zone.length <= 64 && IANAZone.isValidZone(zone);

// Luxon numbers Monday 1 to Sunday 7; a stored weekday is 0 (Sunday) to 6.
const luxonWeekday = (weekday) => (Number(weekday) === 0 ? 7 : Number(weekday));

const firesOn = (schedule, local) => {
    if (schedule.every === 'weekdays') return local.weekday <= 5;
    if (schedule.every === 'weekly') return local.weekday === luxonWeekday(schedule.weekday);
    return true;
};

const validate = (schedule) => {
    const errors = [];
    if (!EVERY.includes(schedule && schedule.every)) errors.push(`every must be one of ${EVERY.join(', ')}`);
    if (!TIME.test(String((schedule && schedule.at) || ''))) errors.push('at must be HH:MM');
    if (!isValidZone(schedule && schedule.timezone)) errors.push('timezone must be an IANA time zone such as Europe/Berlin');
    if (schedule && schedule.every === 'weekly' && !(Number.isInteger(schedule.weekday) && schedule.weekday >= 0 && schedule.weekday <= 6)) {
        errors.push('weekday must be 0 (Sunday) to 6');
    }
    return errors;
};

const slotOn = (schedule, local) => {
    const [hour, minute] = String(schedule.at).split(':').map(Number);
    return local.set({ hour, minute, second: 0, millisecond: 0 });
};

const localNow = (schedule, now) => DateTime.fromJSDate(new Date(now), { zone: schedule.timezone });

/* The most recent moment at or before `now` the schedule names; null for an invalid schedule. */
const latestSlot = (schedule, now = new Date()) => {
    if (validate(schedule).length) return null;
    const local = localNow(schedule, now);
    let slot = slotOn(schedule, local);
    if (slot > local) slot = slotOn(schedule, slot.minus({ days: 1 }));
    for (let i = 0; i < MAX_STEPS && !firesOn(schedule, slot); i += 1) slot = slotOn(schedule, slot.minus({ days: 1 }));
    return slot.toJSDate();
};

/* The first moment strictly after `now` the schedule names. */
const nextSlot = (schedule, now = new Date()) => {
    if (validate(schedule).length) return null;
    const local = localNow(schedule, now);
    let slot = slotOn(schedule, local);
    if (slot <= local) slot = slotOn(schedule, slot.plus({ days: 1 }));
    for (let i = 0; i < MAX_STEPS && !firesOn(schedule, slot); i += 1) slot = slotOn(schedule, slot.plus({ days: 1 }));
    return slot.toJSDate();
};

/* Minutes to add to local time to reach UTC, the browser's getTimezoneOffset() that utils/localDay reads. */
const tzOffsetAt = (timezone, now = new Date()) => (isValidZone(timezone) ? -DateTime.fromJSDate(new Date(now), { zone: timezone }).offset : 0);

module.exports = { EVERY, TIME, isValidZone, validate, latestSlot, nextSlot, tzOffsetAt };
