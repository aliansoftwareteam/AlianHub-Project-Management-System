/* Task 108 (2026-11-26): AGENT_TAINT_ROUTING ships off by default now, and an owner turns it on from
 * Settings → Security. An install that already has a workspace keeps the gate it ran with before (on while the
 * AI tools or MCP_OAUTH were on): that effective value is recorded in the instance settings unless .env names
 * the key or the console already holds a value. A database with no workspace yet is a new install and gets
 * nothing, so the new default (off) applies once setup has run. A value already saved is left as it is. */

const ID = '088-taint-routing-off-default-keep-existing';
const KEY = 'AGENT_TAINT_ROUTING';

const filled = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const settings = () => require('../Config/instanceSettings');
const { taintDefaultOn } = require('../Modules/Instance/settingsCatalog');

/* The value to keep for an existing install: what the gate was before this change, unless .env names the key or
 * the console already saved one. */
const toKeep = (namedInEnv, stored = {}, env = process.env) => (namedInEnv.includes(KEY) || filled(stored[KEY])
    ? {}
    : { [KEY]: taintDefaultOn(env) ? 'true' : 'false' });

async function existingInstall(global, SCHEMA_TYPE) {
    return (await global({ type: SCHEMA_TYPE.COMPANIES, data: [{}] }, 'countDocuments')) > 0;
}

/* At boot, before any module reads the gate: until this migration has run, an existing install keeps the value
 * it ran with. Mirrors 074 so the two together leave existing installs exactly as they were. */
async function holdUntilApplied({ global, SCHEMA_TYPE }) {
    const done = await global({ type: SCHEMA_TYPE.SCHEMA_VERSIONS, data: [{ _id: ID, ok: true }] }, 'findOne');
    if (done || !(await existingInstall(global, SCHEMA_TYPE))) return {};
    const values = toKeep(settings().lockedKeys(), settings().savedValues());
    settings().applyInstanceSettings(values);
    return values;
}

module.exports = {
    id: ID,
    scope: 'global',
    KEY,
    toKeep,
    holdUntilApplied,
    async up(ctx) {
        if (!(await existingInstall(ctx.global, ctx.SCHEMA_TYPE))) {
            ctx.logger.info(`[migrations] ${ID}: no workspace yet, a new install ships the gate off`);
            return;
        }
        const { DOC_ID } = settings();
        const doc = plain(await ctx.global({ type: ctx.SCHEMA_TYPE.INSTANCE_SETTINGS, data: [{ _id: DOC_ID }] }, 'findOne'));
        const values = toKeep(settings().lockedKeys(), plain(doc && doc.values) || {});
        const keys = Object.keys(values);
        if (!keys.length) return;
        const set = Object.fromEntries(keys.map((key) => [`values.${key}`, values[key]]));
        await ctx.global({ type: ctx.SCHEMA_TYPE.INSTANCE_SETTINGS, data: [{ _id: DOC_ID }, { $set: set }, { upsert: true }] }, 'findOneAndUpdate');
        settings().adoptStored(values);
        ctx.logger.info(`[migrations] ${ID}: kept the gate's current value on this existing install: ${KEY}=${values[KEY]}`);
    },
};
