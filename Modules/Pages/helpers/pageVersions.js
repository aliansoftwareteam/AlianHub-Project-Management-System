'use strict';

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { MAX_CONTENT_BYTES } = require('./pageRules');
const rules = require('./pageVersionRules');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const NEWEST_FIRST = { createdAt: -1, _id: -1 };
const ROW_FIELDS = 'pageId title name reason savedBy savedAt visibility hash size createdAt';
const LIST_LIMIT = 300;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const store = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.PAGE_VERSIONS, data }, method);

const rowsOf = async (companyId, pageId, limit = LIST_LIMIT) => (await store(companyId, [{ pageId: oid(pageId) }, ROW_FIELDS, { sort: NEWEST_FIRST, limit }], 'find')) || [];

const latestOf = async (companyId, pageId) => (await rowsOf(companyId, pageId, 1))[0] || null;

const versionOf = (companyId, pageId, versionId) => (OBJECT_ID.test(String(versionId || ''))
    ? store(companyId, [{ _id: oid(versionId), pageId: oid(pageId) }], 'findOne')
    : Promise.resolve(null));

const namedCount = (companyId, pageId) => store(companyId, [{ pageId: oid(pageId), name: { $gt: '' } }], 'countDocuments');

const setName = (companyId, version, name) => store(companyId, [{ _id: oid(version._id), pageId: oid(version.pageId) }, { $set: { name } }, { returnDocument: 'after' }], 'findOneAndUpdate');

const thin = async (companyId, pageId, now = new Date()) => {
    const drop = rules.versionsToDrop(await rowsOf(companyId, pageId), now);
    if (!drop.length) return 0;
    const result = await store(companyId, [{ pageId: oid(pageId), _id: { $in: drop.map(oid) } }], 'deleteMany');
    return (result && result.deletedCount) || 0;
};

const thinQuietly = (companyId, pageId, now) => thin(companyId, pageId, now)
    .catch((error) => logger.error(`ERROR thinning page versions: ${error.message}`));

/* Images stay where the doc put them: a version holds their storage keys, never a copy of the files. */
const keep = async (companyId, page, { reason, savedBy, savedAt, name = '', state = rules.snapshotOf(page), now = new Date() }) => {
    if (state.size > MAX_CONTENT_BYTES) return null;
    const saved = await store(companyId, {
        pageId: oid(page._id),
        title: state.title,
        content: { blocks: state.blocks },
        rawText: state.rawText,
        savedBy: String(savedBy || ''),
        savedAt: savedAt || now,
        name,
        reason,
        visibility: rules.markOf(page),
        hash: state.hash,
        size: state.size,
    }, 'save');
    await thinQuietly(companyId, page._id, now);
    return saved;
};

/* Before the doc's state is replaced: keeps it under its own writer and time. A save keeps it when the rule says so;
 * a restore passes its own reason and keeps it whenever it is worth keeping. */
const keepOutgoing = async (companyId, page, editorId, { now = new Date(), reason = '' } = {}) => {
    const state = rules.snapshotOf(page);
    const latest = await latestOf(companyId, page._id);
    const why = reason
        ? (rules.worthKeeping(state, latest, rules.markOf(page)) ? reason : '')
        : rules.reasonToKeep({ page, editorId, latest, now, state });
    if (!why) return null;
    return keep(companyId, page, { reason: why, savedBy: rules.writerOf(page), savedAt: rules.writtenAt(page) || now, state, now });
};

module.exports = { rowsOf, latestOf, versionOf, namedCount, setName, thin, keep, keepOutgoing };
