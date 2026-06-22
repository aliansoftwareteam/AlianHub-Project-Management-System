/**
 * Dev/test helper — adds (or refreshes) the Formula + Rollup custom-field TYPE
 * tiles in the global custom-field types so they appear in "+ Custom Field" on
 * existing companies (new companies get them from the seed automatically).
 *
 * Upsert: if a tile already exists (by cfType) its fields are updated (e.g. to
 * pick up the matching icons); otherwise it is inserted. Safe to run repeatedly.
 *
 * Run from the repo root, then RESTART the backend (the global custom-field list
 * is cached in-memory for 7 days; a restart clears it):
 *     node scripts/seed-formula-rollup-types.js
 *
 * This is a local/ops helper, not an automatic migration. The production fix is a
 * migrate-mongo migration upserting these two docs into the global customField
 * collection.
 */
require('dotenv').config();
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const tiles = [
    {
        cfPrimaryColor: '#7C3AED',
        cfType: 'formula',
        cfDescrption: 'Create a read-only field whose value is calculated from other numeric fields using a formula expression.',
        cfIcon: 'CustomFieldFormula',
        cfTitle: 'Formula',
        cfIconGrey: 'CustomFieldFormulaGrey',
        cfBackgroundColor: '#EDE4FF',
    },
    {
        cfPrimaryColor: '#0EA5A4',
        cfType: 'rollup',
        cfDescrption: "Create a read-only field that aggregates a numeric field across a task's subtasks (sum, avg, count, min, max).",
        cfIcon: 'CustomFieldRollup',
        cfTitle: 'Rollup',
        cfIconGrey: 'CustomFieldRollupGrey',
        cfBackgroundColor: '#D7F5F5',
    },
];

(async () => {
    try {
        const existing = await MongoDbCrudOpration(
            SCHEMA_TYPE.GOLBAL,
            { type: SCHEMA_TYPE.GLOBAL_CUSTOM_FIELDS, data: [{}] },
            'find'
        );
        for (const tile of tiles) {
            const match = (existing || []).find((d) => d && d.cfType === tile.cfType);
            if (match) {
                await MongoDbCrudOpration(
                    SCHEMA_TYPE.GOLBAL,
                    { type: SCHEMA_TYPE.GLOBAL_CUSTOM_FIELDS, data: [{ cfType: tile.cfType }, { $set: tile }] },
                    'updateOne'
                );
                console.log(`↻ ${tile.cfType}: updated (icons refreshed)`);
            } else {
                await MongoDbCrudOpration(
                    SCHEMA_TYPE.GOLBAL,
                    { type: SCHEMA_TYPE.GLOBAL_CUSTOM_FIELDS, data: tile },
                    'save'
                );
                console.log(`✓ ${tile.cfType}: inserted`);
            }
        }
        console.log('\nDone. Now RESTART the backend so the global custom-field cache refreshes.');
        process.exit(0);
    } catch (err) {
        console.error('Seed failed:', err && err.message ? err.message : err);
        process.exit(1);
    }
})();
