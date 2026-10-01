#!/usr/bin/env node
/* node scripts/rich-text-audit.js [companyId ...]
 * Read-only. Rich text is cleaned when it is saved (Modules/Tasks/helpers/cleanRichText.js); a row saved before that
 * holds its text as it was sent. This counts, company by company and collection by collection, the stored rows the
 * cleaner would write differently, so a backfill can be decided on. Nothing is written and no text is printed: only
 * counts and row ids.
 *   respelled  the same text written another way: a link gains target and rel, an entity is spelled as a browser does
 *   reduced    the cleaner takes something out
 *   refused    the row is beyond a size limit and a save of it would be refused */
const path = require('path');
const { cleanBlocks, cleanHtml } = require('../Modules/Tasks/helpers/cleanRichText');

const BATCH = 500;

const read = (row, field) => field.split('.').reduce((value, key) => (value == null ? undefined : value[key]), row);

const blocks = (profile) => (value) => cleanBlocks(value, profile);
const html = (profile) => (value) => (typeof value === 'string' ? cleanHtml(value, profile) : value);

const COLLECTIONS = [
    { type: 'TASKS', fields: { descriptionBlock: blocks('strict'), description: html('strict') } },
    { type: 'PROJECTS', fields: { descriptionBlock: blocks('strict'), description: html('strict') } },
    { type: 'TASK_TEMPLATES', fields: { descriptionBlock: blocks('strict') } },
    { type: 'RECURRING_TASKS', fields: { 'templateSnapshot.descriptionBlock': blocks('strict') } },
    { type: 'PAGES', fields: { 'content.blocks': blocks('doc'), 'content.html': html('doc') } },
    { type: 'PAGE_VERSIONS', fields: { 'content.blocks': blocks('doc') } },
];

const SPELLINGS = [
    [/ (target|rel)="[^"]*"/g, ''],
    [/<br\s*\/>/g, '<br>'],
    [/&quot;/g, '"'],
    [/&#(39|x27);/gi, "'"],
    [/&nbsp;/g, '\u00a0'],
];

const sameText = (value) => {
    if (typeof value === 'string') return SPELLINGS.reduce((text, [from, to]) => text.replace(from, to), value);
    if (Array.isArray(value)) return value.map(sameText);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, held]) => [key, sameText(held)]));
    return value;
};

const written = (value) => JSON.stringify(value === undefined ? null : value);

/* What a save of this row today would do to its rich text: '' (nothing), 'respelled', 'reduced' or 'refused'. */
const verdictOf = (row, fields) => {
    const verdicts = Object.entries(fields).map(([field, clean]) => {
        const stored = read(row, field);
        if (stored === undefined || stored === null) return '';
        let cleaned;
        try {
            cleaned = clean(JSON.parse(written(stored)));
        } catch (error) {
            if (error.statusCode === 400) return 'refused';
            throw error;
        }
        if (written(cleaned) === written(stored)) return '';
        return written(sameText(cleaned)) === written(sameText(stored)) ? 'respelled' : 'reduced';
    });
    return ['refused', 'reduced', 'respelled'].find((verdict) => verdicts.includes(verdict)) || '';
};

async function auditCollection({ companyId, type, fields, find }) {
    const report = { read: 0, respelled: 0, reduced: 0, refused: 0, reducedIds: [], refusedIds: [] };
    const projection = Object.fromEntries(Object.keys(fields).map((field) => [field, 1]));
    let after = null;
    for (;;) {
        const rows = (await find(companyId, type, after ? { _id: { $gt: after } } : {}, projection, { sort: { _id: 1 }, limit: BATCH, lean: true })) || [];
        rows.forEach((row) => {
            report.read += 1;
            const verdict = verdictOf(row, fields);
            if (!verdict) return;
            report[verdict] += 1;
            if (verdict !== 'respelled') report[`${verdict}Ids`].push(String(row._id));
        });
        if (rows.length < BATCH) return report;
        after = rows[rows.length - 1]._id;
    }
}

async function auditCompany({ companyId, find, schemaTypes }) {
    const collections = {};
    for (const { type, fields } of COLLECTIONS) {
        collections[schemaTypes[type]] = await auditCollection({ companyId, type: schemaTypes[type], fields, find });
    }
    return { companyId: String(companyId), collections };
}

async function auditCompanies(only = []) {
    const { SCHEMA_TYPE } = require('../Config/schemaType');
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const find = (companyId, type, filter, projection, options) => MongoDbCrudOpration(String(companyId), { type, data: [filter, projection, options] }, 'find');
    const companies = only.length
        ? only
        : ((await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}, { _id: 1 }] }, 'find')) || []).map((company) => String(company._id));
    const reports = [];
    for (const companyId of companies) reports.push(await auditCompany({ companyId, find, schemaTypes: SCHEMA_TYPE }));
    return reports;
}

const lineOf = (name, report) => `  ${name.padEnd(18)} read ${report.read}  respelled ${report.respelled}  reduced ${report.reduced}  refused ${report.refused}`;

const print = (reports, log = console.log) => {
    reports.forEach(({ companyId, collections }) => {
        log(`company ${companyId}`);
        Object.entries(collections).forEach(([name, report]) => {
            log(lineOf(name, report));
            if (report.reducedIds.length) log(`    reduced: ${report.reducedIds.join(' ')}`);
            if (report.refusedIds.length) log(`    refused: ${report.refusedIds.join(' ')}`);
        });
    });
    const total = (key) => reports.reduce((sum, { collections }) => sum + Object.values(collections).reduce((inner, report) => inner + report[key], 0), 0);
    log(`total: read ${total('read')}  respelled ${total('respelled')}  reduced ${total('reduced')}  refused ${total('refused')}`);
};

async function main() {
    require('../Config/applyEnv').loadDotEnv(path.join(__dirname, '..', '.env'));
    if (!process.env.MONGODB_URL) throw new Error('MONGODB_URL is not set.');
    const only = process.argv.slice(2).filter((arg) => /^[a-f0-9]{24}$/i.test(arg));
    print(await auditCompanies(only));
    return 0;
}

if (require.main === module) {
    main()
        .then((code) => process.exit(code))
        .catch((error) => {
            console.error(`rich-text-audit: ${error.message || error}`);
            process.exit(2);
        });
}

module.exports = { auditCompanies, auditCompany, verdictOf, print, COLLECTIONS };
