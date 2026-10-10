const { DateTime, IANAZone } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { oid } = require('../Automations/engine/tools');

// A due or start day is stored as the instant that day began where the person who set it was, so read as UTC it can
// fall on the day before. An agent is given the day itself, as the web app shows it, in the caller's own time zone.

const UTC = 'UTC';
const DAY_KEYS = new Set(['dueDate', 'DueDate', 'startDate', 'StartDate', 'endDate', 'EndDate']);
const TIMER_KEYS = new Set(['startedAt', 'endedAt', 'stoppedAt']);
const MOMENT_KEY = /(At|Until)$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEPTH_MAX = 12;

const zones = new WeakMap();

const zoneOfUser = async (companyId, userId) => {
    const id = oid(String(userId || ''));
    if (!id) return UTC;
    const user = await Promise.resolve(MongoDbCrudOpration(dbCollections.GLOBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: id }, { Time_Zone: 1 }] }, 'findOne')).catch(() => null);
    const zone = String((user && user.Time_Zone) || '').trim();
    return zone && IANAZone.isValidZone(zone) ? zone : UTC;
};

const zoneOf = (ctx) => {
    if (!ctx || typeof ctx !== 'object') return Promise.resolve(UTC);
    if (!zones.has(ctx)) zones.set(ctx, zoneOfUser(ctx.companyId, ctx.userId));
    return zones.get(ctx);
};

const instantOf = (value) => {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : DateTime.fromJSDate(value);
    if (typeof value !== 'string' || !STAMP.test(value)) return null;
    const at = DateTime.fromISO(value, { setZone: true });
    return at.isValid ? at : null;
};

const weekdayOf = (at) => at.setLocale('en').toFormat('cccc');

const dayIn = (value, zone) => {
    if (typeof value === 'string' && DAY.test(value)) {
        const day = DateTime.fromISO(value, { zone: UTC });
        return day.isValid ? { day: value, weekday: weekdayOf(day) } : null;
    }
    const at = instantOf(value);
    if (!at) return null;
    const local = at.setZone(zone);
    return { day: local.toISODate(), weekday: weekdayOf(local) };
};

const isPlain = (value) => {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

const shown = (value, zone, depth = 0) => {
    if (value === null || typeof value !== 'object' || depth > DEPTH_MAX) return value;
    if (Array.isArray(value)) return value.map((entry) => shown(entry, zone, depth + 1));
    if (!isPlain(value)) return value;
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
        if (DAY_KEYS.has(key)) {
            const read = dayIn(entry, zone);
            if (read) {
                out[key] = read.day;
                out[`${key}Weekday`] = read.weekday;
                continue;
            }
        } else if (MOMENT_KEY.test(key)) {
            const at = instantOf(entry);
            if (at) {
                const local = at.setZone(zone);
                out[key] = zone === UTC ? entry : local.toISO();
                if (TIMER_KEYS.has(key)) out[`${key}Weekday`] = weekdayOf(local);
                continue;
            }
        }
        out[key] = shown(entry, zone, depth + 1);
    }
    return out;
};

/* A tool's answer with its days as the caller's calendar days and its moments at the caller's offset. */
const inZone = async (ctx, answer) => shown(answer, await zoneOf(ctx));

module.exports = { inZone, shown, zoneOf, dayIn, UTC };
