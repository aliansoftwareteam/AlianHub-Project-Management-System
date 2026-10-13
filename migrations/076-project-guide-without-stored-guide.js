const crypto = require('crypto');
const { documentOf, SEEDS } = require('../Modules/Agents/skills/seeds');
const firstSeed = require('./lib/projectGuideFirstSeed');

/* project.guide now answers on a project with no stored guide (AP-490, T2-A). Migration 022 gave every company its own
 * copy of the first seed, which shadows the built-in one and still skips such projects. A copy that is still exactly
 * that first seed takes the new document; a copy an admin edited is theirs and is left alone. */

const ID = '076-project-guide-without-stored-guide';
const KEY = 'project.guide';
const CONTENT = Object.freeze(['name', 'description', 'inputs', 'gather', 'prompt', 'emit', 'summary', 'fallback']);
const FIRST_SEED_SHA256 = 'c9ce51aa8380cc01f0e6b98d138904ad1d5d1a4fe7c1b54b4e68f36d0187d355';

const canon = (v) => {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
        return `{${Object.keys(v).filter((k) => v[k] !== undefined && k !== '_id').sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
};

const fingerprint = (doc) => crypto.createHash('sha256').update(canon(Object.fromEntries(CONTENT.map((f) => [f, doc[f]])))).digest('hex');

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const contentOf = (doc) => Object.fromEntries([...CONTENT, 'emits', 'risk'].filter((f) => doc[f] !== undefined).map((f) => [f, doc[f]]));

/* Moves every company copy whose content fingerprints as `from` to the document `to`. */
const replaceCopies = (ctx, from, to) => {
    const $set = contentOf(to);
    const type = ctx.SCHEMA_TYPE.AGENT_SKILLS;
    return ctx.forEachCompany(async (companyId) => {
        const copy = plain(await ctx.company(companyId, { type, data: [{ key: KEY }] }, 'findOne'));
        if (!copy) return { updated: 0, kept: 0 };
        if (fingerprint(copy) !== from) {
            ctx.logger.info(`[migrations] 076 ${companyId}: project.guide was edited, kept as it is`);
            return { updated: 0, kept: 1 };
        }
        await ctx.company(companyId, { type, data: [{ _id: copy._id }, { $set }] }, 'updateOne');
        return { updated: 1, kept: 0 };
    });
};

module.exports = {
    id: ID,
    scope: 'company',
    fingerprint,
    FIRST_SEED_SHA256,
    async up(ctx) {
        await replaceCopies(ctx, FIRST_SEED_SHA256, documentOf(SEEDS.projectGuide));
    },
    async down(ctx) {
        await replaceCopies(ctx, fingerprint(documentOf(SEEDS.projectGuide)), documentOf(firstSeed));
    },
};
