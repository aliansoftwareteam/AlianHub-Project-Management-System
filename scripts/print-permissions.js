/**
 * Read-only: print the permission matrix for a company and the members'
 * roleTypes — so you can see exactly which role can view public/private
 * projects, create projects, etc.
 *
 * Usage (repo root):
 *   node scripts/print-permissions.js <companyId>
 */
require('dotenv').config();

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../Config/collections');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const KEYS_OF_INTEREST = [
    'public_projects',
    'private_projects',
    'project_create',
    'project_sprint_create',
    'task_create',
    'task_status',
    'task_assignee',
    'task_due_date',
    'task_priority',
    'task_type',
    'task_description',
    'task_estimated_hours',
    'settings_member_list',
    'settings_security_permissions',
];

const perm = (v) => (v === true ? 'WRITE(true)' : v === false ? 'read-only(false)' : v === null || v === undefined ? 'none(null)' : String(v));

const main = async () => {
    const [companyId] = process.argv.slice(2);
    if (!companyId || !/^[a-f0-9]{24}$/i.test(companyId)) {
        console.error('Usage: node scripts/print-permissions.js <companyId>');
        process.exit(1);
    }

    // Members → roleType
    const users = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{}, { userEmail: 1, userId: 1, roleType: 1, _id: 0 }] }, 'find');
    console.log('\n=== Members (email → roleType) ===');
    (users || []).forEach((u) => console.log(`  roleType ${String(u.roleType).padEnd(4)}  ${u.userEmail || '(no email)'}  [${u.userId || ''}]`));
    console.log('  (roleType 1 = owner, 2 = admin — both bypass all permission checks)');

    // Rules
    const rules = await MongoDbCrudOpration(companyId, { type: dbCollections.RULES, data: [] }, 'find');
    const byKey = {};
    (rules || []).forEach((r) => { if (r.key) byKey[r.key] = r; });

    console.log('\n=== Permission matrix (roleType → permission) ===');
    for (const key of KEYS_OF_INTEREST) {
        const rule = byKey[key];
        if (!rule) { console.log(`  ${key.padEnd(32)} : (not defined)`); continue; }
        const roleStr = (rule.roles || []).map((r) => `role${r.key}=${perm(r.permission)}`).join('  ');
        console.log(`  ${key.padEnd(32)} : ${roleStr || '(no roles)'}`);
    }
    console.log('\nTo let a member see ALL public projects: set public_projects = WRITE(true) for their roleType.\n');
    process.exit(0);
};

main().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
