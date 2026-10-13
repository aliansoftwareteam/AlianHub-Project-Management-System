const mongoose = require('mongoose');
const { ACTIVE_SEAT, INVITED_SEAT } = require('../Config/seatStatus');
const { ROLE_OWNER } = require('../Config/roleTypes');
const { NEW_COMPANY_PLAN, companyRowFor } = require('../Modules/Company/helpers/companyRow');

/* Every workspace made on the sign-up page opened without its row in the global companies collection: the page
 * sent an empty country, the schema requires one, the save failed and the handler answered success. Such a
 * workspace is complete in every other way (a prepared company that was taken, the owner's active seat in its own
 * database, the company on the owner's account), so those three are what find it. Each gets the row sign-up writes
 * now. The name the person typed was only ever in the row that failed, so the row is named after its owner and the
 * owner renames it under Settings.
 *
 * Only adds rows: a row that exists is never read back or changed, and a taken company with no active owner is an
 * unfinished creation and is left alone. Reads everything before the first write, so `up --dry-run` shows the plan. */

const ID = '071-workspace-company-rows';
const LOG_TIME_DAYS_SIGN_UP_SENDS = 8;
const DOWN_REFUSAL = `${ID}: down deletes the company rows this migration wrote, and those workspaces stop opening again. Re-run with --confirm.`;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
// The row appeared after the plan was read: someone else's row wins.
const DUPLICATE_KEY = 11000;

const objectId = (id) => new mongoose.Types.ObjectId(String(id));

async function takenWithoutRow(ctx) {
    const { PRECOMPANIES, COMPANIES } = ctx.SCHEMA_TYPE;
    const taken = await ctx.global({ type: PRECOMPANIES, data: [{ isAvailable: false }, { _id: 1 }] }, 'find') || [];
    const ids = taken.map((row) => String(row._id)).filter((id) => OBJECT_ID.test(id));
    if (!ids.length) return [];
    const rows = await ctx.global({ type: COMPANIES, data: [{ _id: { $in: ids.map(objectId) } }, { _id: 1 }] }, 'find') || [];
    const withRow = new Set(rows.map((row) => String(row._id)));
    return ids.filter((id) => !withRow.has(id));
}

async function ownerOf(ctx, companyId) {
    const { COMPANY_USERS, USERS } = ctx.SCHEMA_TYPE;
    const seats = await ctx.company(companyId, {
        type: COMPANY_USERS,
        data: [{ ...ACTIVE_SEAT, roleType: ROLE_OWNER }, { userId: 1, createdAt: 1 }, { sort: { createdAt: 1 } }],
    }, 'find') || [];
    for (const seat of seats) {
        if (!OBJECT_ID.test(String(seat.userId || ''))) continue;
        const account = await ctx.global({
            type: USERS,
            data: [{ _id: objectId(seat.userId) }, { Employee_FName: 1, AssignCompany: 1 }],
        }, 'findOne');
        if (account && (account.AssignCompany || []).map(String).includes(companyId)) return account;
    }
    return null;
}

const peopleIn = (ctx, companyId) => ctx.company(companyId, { type: ctx.SCHEMA_TYPE.COMPANY_USERS, data: [INVITED_SEAT] }, 'countDocuments');

async function namesOwnedBy(ctx, ownerId) {
    const owned = await ctx.global({ type: ctx.SCHEMA_TYPE.COMPANIES, data: [{ userId: objectId(ownerId) }, { Cst_CompanyName: 1 }] }, 'find') || [];
    return new Set(owned.map((row) => String(row.Cst_CompanyName || '').trim().toLowerCase()));
}

const freeName = (firstName, takenNames) => {
    const first = String(firstName || '').trim();
    const base = first ? `${first}'s workspace` : 'My workspace';
    for (let count = 1; ; count += 1) {
        const name = count === 1 ? base : `${base} ${count}`;
        if (!takenNames.has(name.toLowerCase())) {
            takenNames.add(name.toLowerCase());
            return name;
        }
    }
};

async function planRows(ctx) {
    const rows = [];
    const withoutOwner = [];
    const namesByOwner = new Map();
    for (const companyId of await takenWithoutRow(ctx)) {
        const owner = await ownerOf(ctx, companyId);
        if (!owner) {
            withoutOwner.push(companyId);
            continue;
        }
        const ownerId = String(owner._id);
        if (!namesByOwner.has(ownerId)) namesByOwner.set(ownerId, await namesOwnedBy(ctx, ownerId));
        const row = companyRowFor(objectId(companyId), {
            ...NEW_COMPANY_PLAN(),
            userId: ownerId,
            companyName: freeName(owner.Employee_FName, namesByOwner.get(ownerId)),
            logtimeDays: LOG_TIME_DAYS_SIGN_UP_SENDS,
        }).data;
        rows.push({ ...row, companyData: [{ users: Math.max(1, await peopleIn(ctx, companyId) || 0) }], rowRepairedBy: ID });
    }
    return { rows, withoutOwner };
}

module.exports = {
    id: ID,
    scope: 'global',
    async up(ctx) {
        const { rows, withoutOwner } = await planRows(ctx);
        const failed = [];
        let written = 0;
        for (const row of rows) {
            const companyId = String(row._id);
            try {
                await ctx.global({ type: ctx.SCHEMA_TYPE.COMPANIES, data: row }, 'save');
                ctx.companies[companyId] = { ok: true, name: row.Cst_CompanyName };
                written += 1;
            } catch (error) {
                if (error?.code === DUPLICATE_KEY) continue;
                ctx.companies[companyId] = { ok: false, error: String(error?.message || error) };
                failed.push(companyId);
            }
        }
        ctx.logger.info(`[migrations] ${ID} wrote ${written} company row(s); ${withoutOwner.length} taken company(ies) have no active owner and were left alone`);
        if (failed.length) throw new Error(`${failed.length} of ${rows.length} company rows could not be written: ${failed.join(', ')}`);
        return { written, withoutOwner: withoutOwner.length };
    },
    async verify(ctx) {
        const { rows } = await planRows(ctx);
        return rows.map((row) => `workspace ${row._id} of owner ${row.userId} has no company row`);
    },
    async down(ctx, { confirmed } = {}) {
        if (confirmed !== true) throw new Error(DOWN_REFUSAL);
        const result = await ctx.global({ type: ctx.SCHEMA_TYPE.COMPANIES, data: [{ rowRepairedBy: ID }] }, 'deleteMany');
        ctx.logger.info(`[migrations] ${ID} removed ${(result && result.deletedCount) || 0} company row(s) it had written`);
    },
};
