/**
 * Repair helper — restores the `mainChat: true` flag on one-to-one chat
 * conversations that lost it.
 *
 * WHY THIS IS NEEDED
 * One-to-one chats are stored as TASKS inside the hidden `default` chat project
 * and are identified only by `mainChat: true`. The task schema is built with
 * `strict: true` (P1-SEC-11, utils/mongo-handler/createSchema.js), which
 * silently drops undeclared fields on save — and `mainChat` was never declared
 * in utils/mongo-handler/schema.js. So every DM created after that hardening
 * was written WITHOUT the flag, and the chat list (which filters on
 * `{ mainChat: true, AssigneeUserId }` in Modules/MainChats/controller.js)
 * could no longer find it: the conversation worked in-session but disappeared
 * from the list on reload. Channels were unaffected because they are sprints,
 * not tasks.
 *
 * The schema now declares `mainChat`, so NEW conversations persist correctly.
 * This script repairs the ones already written without it.
 *
 * IMPORTANT: run this only AFTER the schema fix is deployed. While `mainChat`
 * is undeclared, strict mode strips it from the $set too and the update is a
 * no-op.
 *
 * Every task inside a `default` chat project is a DM conversation by
 * construction, so that is the scope. Deleted conversations
 * (`deletedStatusKey !== 0`) are intentionally skipped — the chat list does not
 * filter them out, so flagging them would resurrect deleted chats.
 *
 * Usage (dry run first — reports what WOULD change and writes nothing):
 *     node scripts/backfill-main-chat-flag.js <companyId>
 *     node scripts/backfill-main-chat-flag.js <companyId> --apply
 *
 * Run once per company (each company has its own database).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');

(async () => {
    const args = process.argv.slice(2);
    const companyId = args.find((a) => !a.startsWith('--'));
    const apply = args.includes('--apply');

    if (!companyId || !/^[a-f0-9]{24}$/i.test(companyId)) {
        console.error('Usage: node scripts/backfill-main-chat-flag.js <companyId> [--apply]');
        process.exit(1);
    }

    try {
        // 1) Locate the company's one-to-one ("default") chat project(s).
        const chatProjects = await MongoDbCrudOpration(
            companyId,
            { type: SCHEMA_TYPE.MAIN_CHATS, data: [{ default: true }] },
            'find'
        );

        if (!chatProjects || !chatProjects.length) {
            console.log('No default (one-to-one) chat project found for this company — nothing to do.');
            process.exit(0);
        }

        console.log(`${apply ? 'APPLY' : 'DRY RUN'} — company ${companyId}`);
        console.log(`Found ${chatProjects.length} default chat project(s).\n`);

        let totalCandidates = 0;
        let totalUpdated = 0;

        for (const project of chatProjects) {
            const projectId = new mongoose.Types.ObjectId(String(project._id));
            const filter = {
                ProjectID: projectId,
                mainChat: { $ne: true },
                deletedStatusKey: 0,
            };

            const candidates = await MongoDbCrudOpration(
                companyId,
                { type: SCHEMA_TYPE.TASKS, data: [filter, { _id: 1, TaskName: 1, AssigneeUserId: 1, lastMessage: 1 }] },
                'find'
            );

            const count = (candidates || []).length;
            totalCandidates += count;
            console.log(`Project ${project._id} (${project.ProjectName || 'default'}): ${count} conversation(s) missing the flag`);

            (candidates || []).slice(0, 10).forEach((c) => {
                const participants = Array.isArray(c.AssigneeUserId) ? c.AssigneeUserId.length : 0;
                console.log(`   - ${c._id}  participants=${participants}  lastMessage=${c.lastMessage || 'never'}`);
            });
            if (count > 10) console.log(`   … and ${count - 10} more`);

            if (apply && count) {
                const result = await MongoDbCrudOpration(
                    companyId,
                    { type: SCHEMA_TYPE.TASKS, data: [filter, { $set: { mainChat: true } }] },
                    'updateMany'
                );
                const modified = (result && (result.modifiedCount !== undefined ? result.modifiedCount : result.nModified)) || 0;
                totalUpdated += modified;
                console.log(`   -> updated ${modified}`);
            }
        }

        console.log('');
        if (apply) {
            console.log(`Done. ${totalUpdated} conversation(s) repaired.`);
            if (totalUpdated !== totalCandidates) {
                console.log(`NOTE: ${totalCandidates} were matched but ${totalUpdated} updated — if these differ, confirm the schema fix declaring \`mainChat\` is deployed (strict mode strips undeclared fields from $set).`);
            }
            console.log('The chat list is cached for up to an hour per company; restart the backend (or wait out the TTL) to see the change.');
        } else {
            console.log(`Dry run only — nothing was written. ${totalCandidates} conversation(s) would be repaired.`);
            console.log('Re-run with --apply to perform the update.');
        }
        process.exit(0);
    } catch (err) {
        console.error('Backfill failed:', err && err.message ? err.message : err);
        process.exit(1);
    }
})();
