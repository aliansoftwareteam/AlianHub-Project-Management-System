#!/usr/bin/env node
/* node scripts/seat-check.js   (exits 1 when it lists anyone)
 * Read-only. A company header is accepted only while the account holds an active company_users
 * seat in that company, so an account whose users.AssignCompany lists a company it holds no active
 * seat in cannot open that company. Run this before upgrading to see who that is. Nothing is written. */
const path = require('path');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const SEAT_ACTIVE = 2;

const seatState = (row) => {
    if (!row) return 'none';
    if (row.isDelete === true) return 'removed';
    if (Number(row.status) === 1) return 'invited';
    if (Number(row.status) === SEAT_ACTIVE) return 'active';
    return `status ${row.status}`;
};

/* The best row an account holds in a company, so an active seat beside an old cancelled one counts. */
const bestRow = (rows) => rows.find((row) => seatState(row) === 'active') || rows[0];

async function collectSeatless({ findUsers, findSeats }) {
    const users = (await findUsers()) || [];
    const membersOf = new Map();
    users.forEach((user) => {
        (user.AssignCompany || []).map(String).filter((id) => OBJECT_ID.test(id)).forEach((companyId) => {
            if (!membersOf.has(companyId)) membersOf.set(companyId, []);
            membersOf.get(companyId).push(user);
        });
    });

    const seatless = [];
    for (const [companyId, members] of membersOf) {
        const rows = (await findSeats(companyId, members.map((user) => String(user._id)))) || [];
        members.forEach((user) => {
            const seat = seatState(bestRow(rows.filter((row) => String(row.userId) === String(user._id))));
            if (seat !== 'active') seatless.push({ companyId, userId: String(user._id), email: user.Employee_Email || '', seat });
        });
    }
    return { checked: users.length, seatless };
}

async function main() {
    require('../Config/applyEnv').loadDotEnv(path.join(__dirname, '..', '.env'));
    if (!process.env.MONGODB_URL) throw new Error('MONGODB_URL is not set.');
    const { SCHEMA_TYPE } = require('../Config/schemaType');
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');

    const report = await collectSeatless({
        findUsers: () => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ 'AssignCompany.0': { $exists: true } }, { Employee_Email: 1, AssignCompany: 1 }, { lean: true }],
        }, 'find'),
        findSeats: (companyId, userIds) => MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: { $in: userIds } }, { userId: 1, status: 1, isDelete: 1 }, { lean: true }],
        }, 'find'),
    });

    console.log(`Accounts checked: ${report.checked}`);
    console.log(`Company memberships without an active seat: ${report.seatless.length}`);
    report.seatless.forEach((row) => {
        console.log(`  company ${row.companyId}  user ${row.userId}  ${row.email || '-'}  seat=${row.seat}`);
    });
    if (report.seatless.length) {
        console.log('\nThese accounts cannot open the companies listed. Where one should still be a member, an owner or admin');
        console.log('re-invites them from Settings > Members; otherwise nothing needs doing.');
    }
    return report.seatless.length ? 1 : 0;
}

if (require.main === module) {
    main()
        .then((code) => process.exit(code))
        .catch((error) => {
            console.error(`seat-check: ${error.message || error}`);
            process.exit(2);
        });
}

module.exports = { collectSeatless };
