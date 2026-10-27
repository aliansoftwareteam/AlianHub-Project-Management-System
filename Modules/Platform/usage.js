const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { SEAT_ACTIVE, SEAT_PENDING, INVITED_SEAT } = require('../../Config/seatStatus');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const { state: instanceState } = require('../../Config/instanceState');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { instanceStorageUsage } = require('../../common-storage/storageUsage');
const { currentEntitlements } = require('./entitlements');
const { STATE_IDS, readState } = require('./platformState');
const { storageLevel } = require('../Entitlements/checks');

const CACHE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

const globalDb = (type, data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type, data }, method);
const lower = (value) => String(value || '').trim().toLowerCase();

/* `version` is the release a build leads to (14.40.0), `build` the exact one (14.40.0-beta.12). */
function runningVersion(info = require('../../Config/buildInfo').get()) {
    const build = String(info.version || info.release || '');
    return { version: info.channel === 'release' ? build : String(info.next || info.release || build), build };
}

const seatsIn = (companyId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: [{ ...INVITED_SEAT, isSupportUser: { $ne: true } }, { userId: 1, userEmail: 1, status: 1, roleType: 1, isTrackerUser: 1 }],
}, 'find').then((rows) => rows || []);

/* Pure: seats are counted across the whole instance, one per person whatever the number of
 * workspaces. A guest is someone whose every live seat is a guest's; pending invitations are
 * addresses not already holding a live seat anywhere. */
function countSeats(rowsByCompany, excludedUserIds = []) {
    const excluded = new Set(excludedUserIds.map(String));
    const active = new Map();
    const activeEmails = new Set();
    const pending = new Set();
    const tracker = new Set();
    for (const row of rowsByCompany.flat()) {
        const userId = row.userId ? String(row.userId) : '';
        if (userId && excluded.has(userId)) continue;
        if (row.status === SEAT_ACTIVE && userId) {
            const seat = active.get(userId) || { guestOnly: true };
            seat.guestOnly = seat.guestOnly && row.roleType === ROLE_GUEST;
            active.set(userId, seat);
            if (row.userEmail) activeEmails.add(lower(row.userEmail));
            if (row.isTrackerUser === true) tracker.add(userId);
        } else if (row.status === SEAT_PENDING) {
            pending.add(lower(row.userEmail) || userId);
        }
    }
    const stillPending = [...pending].filter((key) => key && !activeEmails.has(key) && !active.has(key));
    return {
        active: active.size,
        pending: stillPending.length,
        guests: [...active.values()].filter((seat) => seat.guestOnly).length,
        trackerSeats: tracker.size,
    };
}

const todayUtc = (now) => new Date(now).toISOString().slice(0, 10);

async function activityOf(excludedUserIds, now) {
    const notExcluded = { isSupportUser: { $ne: true } };
    const [recent, last] = await Promise.all([
        globalDb(SCHEMA_TYPE.USERS, [{ ...notExcluded, lastSeenAt: { $gte: new Date(now - MONTH_MS) } }, { lastSeenAt: 1 }], 'find'),
        globalDb(SCHEMA_TYPE.USERS, [{ ...notExcluded, lastSeenAt: { $exists: true } }, { lastSeenAt: 1 }, { sort: { lastSeenAt: -1 }, limit: 1 }], 'find'),
    ]);
    const excluded = new Set(excludedUserIds.map(String));
    const seen = (recent || []).filter((row) => !excluded.has(String(row._id))).map((row) => new Date(row.lastSeenAt).getTime());
    const lastRow = (last || [])[0];
    return {
        lastActiveAt: lastRow && lastRow.lastSeenAt ? new Date(lastRow.lastSeenAt) : null,
        dau: seen.filter((at) => now - at < DAY_MS).length,
        mau: seen.length,
    };
}

async function buildUsage(now = Date.now()) {
    await require('../../Config/lastSeen').flushSeen();
    const entitlements = currentEntitlements();
    const limits = entitlements.limits || {};
    const timeTracker = (entitlements.features && entitlements.features.timeTracker) || {};
    const [companies, supportUsers, storage, mail] = await Promise.all([
        globalDb(SCHEMA_TYPE.COMPANIES, [{ deletingAt: { $exists: false } }, { Cst_CompanyName: 1 }], 'find').then((rows) => rows || []),
        globalDb(SCHEMA_TYPE.USERS, [{ isSupportUser: true }, { _id: 1 }], 'find').then((rows) => (rows || []).map((row) => String(row._id))),
        instanceStorageUsage(),
        readState(STATE_IDS.MAIL),
    ]);
    const names = new Map(companies.map((company) => [String(company._id), company.Cst_CompanyName || '']));
    const [rows, activity] = await Promise.all([
        Promise.all([...names.keys()].map((companyId) => seatsIn(companyId).catch(() => []))),
        activityOf(supportUsers, now),
    ]);
    const seats = countSeats(rows, supportUsers);
    return {
        instanceId: process.env.INSTANCE_ID || '',
        at: new Date(now),
        version: runningVersion().version,
        seats: { active: seats.active, pending: seats.pending, guests: seats.guests, limit: limits.seats ?? null },
        workspaces: { count: companies.length, limit: limits.workspaces ?? null },
        storage: {
            bytes: storage.bytes,
            limit: limits.storageBytes ?? null,
            level: storageLevel({ usedBytes: storage.bytes, limit: limits.storageBytes }),
            byWorkspace: storage.byWorkspace.map((row) => ({ companyId: row.companyId, name: names.get(row.companyId) || '', bytes: row.bytes })),
        },
        timeTracker: { seatsUsed: seats.trackerSeats, limit: timeTracker.enabled === false ? 0 : (timeTracker.seats ?? null) },
        mail: { sentToday: mail && mail.day === todayUtc(now) ? Number(mail.sent) || 0 : 0, limit: limits.emailsPerDay ?? null },
        activity,
        migrations: { pending: instanceState.migrationsPending, error: instanceState.migrationError },
    };
}

let cached = null;

/* The orchestrator polls every 15 minutes; the cache keeps a burst of retries from recounting. */
async function usageReport(now = Date.now()) {
    if (cached && now - cached.at < CACHE_MS) return cached.report;
    const report = await buildUsage(now);
    cached = { at: now, report };
    return report;
}

module.exports = { countSeats, buildUsage, usageReport, runningVersion, CACHE_MS, _resetForTests: () => { cached = null; } };
