/* The Formula and Rollup custom-field types, so "+ Custom Field" offers them on
 * companies created before they existed. Upserts by cfType, so a rerun only
 * refreshes the tiles. */
const TILES = [
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

module.exports = {
    id: '006-formula-rollup-types',
    scope: 'global',
    TILES,
    async up(ctx) {
        const type = ctx.SCHEMA_TYPE.GLOBAL_CUSTOM_FIELDS;
        for (const tile of TILES) {
            await ctx.global({ type, data: [{ cfType: tile.cfType }, { $set: tile }, { upsert: true }] }, 'updateOne');
        }
        const { removeCache } = require('../utils/commonFunctions');
        removeCache('customField:global');
    },
};
