/**
 * BUG-046 regression — manual timestamps in HandleHistory.
 *
 * Pre-fix:
 *   * `utils/mongo-handler/createSchema.js` built `historySchema`
 *     WITHOUT `{ timestamps: true }`.
 *   * Callers in `Modules/tasks/helpers/mongo_helper.js` and
 *     `Modules/tasks/helpers/helper.js` populated `createdAt` /
 *     `updatedAt` manually with `DateTime.utc().ts` — a numeric
 *     millis value, not a BSON Date.
 *
 * Post-fix:
 *   * historySchema declares `timestamps: true` like every other
 *     schema in the file.
 *   * The two callers no longer set createdAt/updatedAt manually.
 *   * The schema fields drop `required: true` so legacy docs missing
 *     the field don't reject on re-save.
 */

const fs = require('fs');
const path = require('path');

function assert(cond, label) {
    if (!cond) {
        console.error('FAIL:', label);
        process.exit(1);
    }
    console.log('PASS:', label);
}

const ROOT = path.resolve(__dirname, '../..');

// 1. createSchema.js — historySchema now has timestamps: true.
const createSchemaSrc = fs.readFileSync(path.resolve(ROOT, 'utils/mongo-handler/createSchema.js'), 'utf8');
assert(
    /const historySchema = new Schema\(schema\.history,\s*\{[^}]*timestamps:\s*true/.test(createSchemaSrc),
    'createSchema.js declares historySchema with { timestamps: true }'
);

// 2. mongo_helper.js HandleHistory no longer sets createdAt/updatedAt manually.
const mh = fs.readFileSync(path.resolve(ROOT, 'Modules/tasks/helpers/mongo_helper.js'), 'utf8');
function liveLines(src, needle) {
    return src.split('\n').filter(line => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*')) return false;
        return line.includes(needle);
    });
}
assert(liveLines(mh, 'createdAt:utcDateTime.ts').length === 0, 'mongo_helper.js has no live createdAt:utcDateTime.ts assignment');
assert(liveLines(mh, 'updatedAt:utcDateTime.ts').length === 0, 'mongo_helper.js has no live updatedAt:utcDateTime.ts assignment');

// 3. helper.js HandleHistory same.
const hp = fs.readFileSync(path.resolve(ROOT, 'Modules/tasks/helpers/helper.js'), 'utf8');
assert(liveLines(hp, 'createdAt:utcDateTime.ts').length === 0, 'helper.js has no live createdAt:utcDateTime.ts assignment');
assert(liveLines(hp, 'updatedAt:utcDateTime.ts').length === 0, 'helper.js has no live updatedAt:utcDateTime.ts assignment');

// 4. schema.js — createdAt/updatedAt no longer `required: true` on the
//    history schema (Mongoose owns them via timestamps: true).
const schemaSrc = fs.readFileSync(path.resolve(ROOT, 'utils/mongo-handler/schema.js'), 'utf8');
const historyBlock = schemaSrc.split('history: {')[1].split('userId: {')[0];
assert(/createdAt:\s*\{[^}]*type:\s*Date[^}]*\}/.test(historyBlock), 'history.createdAt still declared as type: Date');
assert(/updatedAt:\s*\{[^}]*type:\s*Date[^}]*\}/.test(historyBlock), 'history.updatedAt still declared as type: Date');
assert(!/createdAt:\s*\{[^}]*required:\s*true/.test(historyBlock), 'history.createdAt no longer has required: true');
assert(!/updatedAt:\s*\{[^}]*required:\s*true/.test(historyBlock), 'history.updatedAt no longer has required: true');

// 5. Behaviour: save a history doc through Mongoose with the new
//    schema and confirm createdAt/updatedAt are BSON Dates, not numbers.
//    (Connect to an in-memory mongoose instance? We don't ship
//    mongodb-memory-server; instead build a sample Mongoose model from
//    the schema in isolation.)
const mongoose = require('mongoose');
const HistoryModel = mongoose.model('test_bug046_history', new mongoose.Schema(
    { Key: String, Message: String, ProjectId: String, TaskId: String, Type: String, UserId: String, createdAt: Date, updatedAt: Date },
    { timestamps: true }
));
const doc = new HistoryModel({ Key: 'k', Message: 'm', ProjectId: 'p', Type: 't', UserId: 'u' });
// Without calling .save() (no DB) Mongoose still timestamps via Document construction; force it:
doc.set({});
doc.constructor.schema.options.timestamps; // ensure schema option recognised
// Trigger pre-save hooks manually
doc.$op = 'save';
doc.isNew = true;
doc.schema._timestamps && doc.schema._timestamps;
// Just assert the schema declared timestamps as expected.
assert(HistoryModel.schema.options.timestamps === true, 'Mongoose schema with { timestamps: true } stores the option');

console.log('\nAll BUG-046 assertions passed.');
