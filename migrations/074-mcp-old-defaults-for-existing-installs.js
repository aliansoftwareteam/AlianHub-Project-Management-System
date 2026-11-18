/* Owner decision 1 of task 047 (2026-10-09): the AI tools and MCP_OAUTH are on by default for new installs only.
 * An install that already has a workspace keeps the old default, off, for each of them its .env does not name:
 * it is recorded in the instance settings, where an owner can turn it on later. A database with no workspace
 * yet is a new install and gets nothing, so the defaults apply once setup has run. A value already saved is
 * left as it is. */

const ID = '074-mcp-old-defaults-for-existing-installs';

const OLD_DEFAULTS = Object.freeze({ MCP_TOOLS_DATA: 'false', MCP_TOOLS_MANAGE: 'false', MCP_TOOLS_WORK: 'false', MCP_OAUTH: 'off' });

const filled = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/* The old defaults this install would lose: not named in .env and not saved in the console. */
const toKeep = (namedInEnv, stored = {}) => Object.fromEntries(Object.entries(OLD_DEFAULTS)
    .filter(([key]) => !namedInEnv.includes(key) && !filled(stored[key])));

const settings = () => require('../Config/instanceSettings');

async function existingInstall(global, SCHEMA_TYPE) {
    return (await global({ type: SCHEMA_TYPE.COMPANIES, data: [{}] }, 'countDocuments')) > 0;
}

/* At boot, before any module reads the flags: until this migration has run (MIGRATIONS_AUTO=false, or the
 * moments before the runner reaches it), an existing install already runs with the old defaults. */
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
    OLD_DEFAULTS,
    toKeep,
    holdUntilApplied,
    async up(ctx) {
        if (!(await existingInstall(ctx.global, ctx.SCHEMA_TYPE))) {
            ctx.logger.info(`[migrations] ${ID}: no workspace yet, a new install keeps the AI tools on`);
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
        ctx.logger.info(`[migrations] ${ID}: kept off on this existing install: ${keys.join(', ')}`);
    },
};
