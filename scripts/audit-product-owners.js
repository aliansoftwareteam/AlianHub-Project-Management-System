#!/usr/bin/env node
/* node scripts/audit-product-owners.js
 * Read-only. Lists every account holding users.isProductOwner, the flag the Instance console
 * trusts. Signup used to copy it from the request body, so any account here other than the one
 * that ran the setup wizard needs a manual review. Nothing is written. */
const path = require('path');

require('../Config/applyEnv').loadDotEnv(path.join(__dirname, '..', '.env'));

const { SCHEMA_TYPE } = require('../Config/schemaType');

const createdAt = (id) => new Date(parseInt(String(id).slice(0, 8), 16) * 1000).toISOString();

async function main() {
    if (!process.env.MONGODB_URL) throw new Error('MONGODB_URL is not set.');
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const findUsers = (filter, projection, options) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [filter, projection, { lean: true, ...options }],
    }, 'find');

    const [firstAccount] = await findUsers({}, { _id: 1 }, { sort: { _id: 1 }, limit: 1 });
    const owners = await findUsers(
        { isProductOwner: true },
        { Employee_Email: 1, Employee_Name: 1, isEmailVerified: 1, isActive: 1, isDeleted: 1, AssignCompany: 1 },
        { sort: { _id: 1 } },
    );
    const isFirst = (user) => Boolean(firstAccount) && String(firstAccount._id) === String(user._id);

    console.log(`Accounts with isProductOwner: ${owners.length}`);
    owners.forEach((user) => {
        const active = user.isActive !== false && user.isDeleted !== true;
        const note = isFirst(user) ? '  (first account on this instance: the setup wizard)' : '  REVIEW';
        console.log(`  ${user._id}  created ${createdAt(user._id)}  ${user.Employee_Email || '-'}  verified=${Boolean(user.isEmailVerified)}  active=${active}  companies=${(user.AssignCompany || []).length}${note}`);
    });

    const toReview = owners.filter((user) => !isFirst(user)).length;
    if (toReview) {
        console.log(`\n${toReview} account(s) marked REVIEW did not run the setup wizard. If one is not a legitimate instance owner,`);
        console.log('remove the flag in the "global" database and end its sessions, e.g. in mongosh:');
        console.log('  db.users.updateOne({ _id: ObjectId("<id>") }, { $unset: { isProductOwner: "" } })');
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(`audit-product-owners: ${error.message || error}`);
        process.exit(1);
    });
