const hostingMode = require('../../Config/hostingMode');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { SEAT_ACTIVE, SEAT_PENDING, INVITED_SEAT } = require('../../Config/seatStatus');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const { canAddSeats, unlimited } = require('./checks');
const { limits } = require('./entitlements');

const CACHE_MS = 30 * 1000;

const lower = (value) => String(value || '').trim().toLowerCase();
const isGuest = (role) => Number(role) === ROLE_GUEST;

function mongoSource() {
    const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
    const globalDb = (type, data) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type, data }, 'find').then((rows) => rows || []);
    return {
        companyIds: () => globalDb(SCHEMA_TYPE.COMPANIES, [{ deletingAt: { $exists: false } }, { _id: 1 }]).then((rows) => rows.map((row) => String(row._id))),
        supportUserIds: () => globalDb(SCHEMA_TYPE.USERS, [{ isSupportUser: true }, { _id: 1 }]).then((rows) => rows.map((row) => String(row._id))),
        seatsIn: (companyId) => MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ ...INVITED_SEAT, isSupportUser: { $ne: true } }, { userId: 1, userEmail: 1, status: 1, roleType: 1, isTrackerUser: 1 }],
        }, 'find').then((rows) => rows || []).catch(() => []),
    };
}

let source = mongoSource();
let cached = null;

/* Pure: who holds a seat across the whole instance, one entry per person whatever the number of
 * workspaces. A guest is someone whose every live seat is a guest's. Pending invitations are
 * addresses holding no live seat anywhere. */
function seatHolders(rowsByCompany, excludedUserIds = []) {
    const excluded = new Set(excludedUserIds.map(String));
    const holders = new Map();
    const emails = new Map();
    const pending = new Map();
    const trackerUsers = new Set();
    for (const rows of rowsByCompany) {
        for (const row of rows || []) {
            const userId = row.userId ? String(row.userId) : '';
            if (userId && excluded.has(userId)) continue;
            const email = lower(row.userEmail);
            if (Number(row.status) === SEAT_ACTIVE && userId) {
                const holder = holders.get(userId) || { guestOnly: true };
                holder.guestOnly = holder.guestOnly && isGuest(row.roleType);
                holders.set(userId, holder);
                if (email) emails.set(email, userId);
                if (row.isTrackerUser === true) trackerUsers.add(userId);
            } else if (Number(row.status) === SEAT_PENDING && email) {
                const invite = pending.get(email) || { guestOnly: true };
                invite.guestOnly = invite.guestOnly && isGuest(row.roleType);
                pending.set(email, invite);
            }
        }
    }
    for (const email of [...pending.keys()]) if (emails.has(email)) pending.delete(email);
    const values = [...holders.values()];
    const invites = [...pending.values()];
    return {
        holders,
        emails,
        pending,
        members: values.filter((holder) => !holder.guestOnly).length,
        guests: values.filter((holder) => holder.guestOnly).length,
        pendingMembers: invites.filter((invite) => !invite.guestOnly).length,
        pendingGuests: invites.filter((invite) => invite.guestOnly).length,
        trackerUsers: trackerUsers.size,
        trackerIds: trackerUsers,
    };
}

async function countNow() {
    const [companyIds, supportUserIds] = await Promise.all([source.companyIds(), source.supportUserIds()]);
    const rows = await Promise.all(companyIds.map((companyId) => source.seatsIn(companyId)));
    return seatHolders(rows, supportUserIds);
}

async function seatSnapshot({ fresh = false, now = Date.now() } = {}) {
    if (!fresh && cached && now - cached.at < CACHE_MS) return cached.snapshot;
    const snapshot = await countNow();
    cached = { at: now, snapshot };
    return snapshot;
}

const forgetSeats = () => { cached = null; };

const holdsSeat = (snapshot, person) => (person.userId && snapshot.holders.has(String(person.userId)))
    || (person.email && snapshot.emails.has(lower(person.email)));

/* Pure: people who would take a new seat, split into members and guests. Someone already holding
 * a seat in any workspace takes none; with invitations counted, neither does an address already
 * invited somewhere. */
function newcomers(snapshot, people, { includePending = false } = {}) {
    const seen = new Set();
    const fresh = { members: 0, guests: 0 };
    for (const person of people || []) {
        const key = person.userId ? `u:${person.userId}` : `e:${lower(person.email)}`;
        if (seen.has(key) || key === 'e:') continue;
        seen.add(key);
        if (holdsSeat(snapshot, person)) continue;
        if (includePending && person.email && snapshot.pending.has(lower(person.email))) continue;
        if (person.guest) fresh.guests += 1;
        else fresh.members += 1;
    }
    return fresh;
}

/* Pure. Guests count against `guests` when it is a number and never take a member's seat; a null
 * `guests` is unlimited. */
function judgeSeats(snapshot, people, planLimits, { includePending = false } = {}) {
    const fresh = newcomers(snapshot, people, { includePending });
    const memberUse = snapshot.members + (includePending ? snapshot.pendingMembers : 0);
    const members = canAddSeats({ activeSeats: memberUse, adding: fresh.members, limit: planLimits.seats });
    if (!members.ok) return members;
    const guestUse = snapshot.guests + (includePending ? snapshot.pendingGuests : 0);
    const guests = canAddSeats({ activeSeats: guestUse, adding: fresh.guests, limit: planLimits.guests });
    return guests.ok ? guests : { ...guests, guests: true };
}

const nearLimit = (snapshot, planLimits) => [['seats', snapshot.members + snapshot.pendingMembers], ['guests', snapshot.guests + snapshot.pendingGuests]]
    .some(([key, used]) => !unlimited(planLimits[key]) && used + 5 >= Number(planLimits[key]));

/* null when the people may take their seats. Hosted only: self-hosted keeps its per-workspace
 * planFeature checks and nothing else. */
async function seatRefusal(people, { includePending = false } = {}) {
    if (!hostingMode.isManaged()) return null;
    const planLimits = limits();
    if (unlimited(planLimits.seats) && unlimited(planLimits.guests)) return null;
    let snapshot = await seatSnapshot();
    if ((people || []).length > 1 || nearLimit(snapshot, planLimits)) snapshot = await seatSnapshot({ fresh: true });
    const verdict = judgeSeats(snapshot, people, planLimits, { includePending });
    return verdict.ok ? null : verdict;
}

module.exports = {
    CACHE_MS, seatHolders, seatSnapshot, forgetSeats, newcomers, judgeSeats, seatRefusal,
    _useSourceForTests: (next) => { source = next || mongoSource(); cached = null; },
};
