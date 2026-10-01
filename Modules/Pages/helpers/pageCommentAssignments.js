const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { OPEN_ASSIGNED } = require('../../Comments/helpers/commentThreads');
const { canUsePage } = require('./pageAccess');
const { plain } = require('./pageComments');

const MAX_ROWS = 100;
const MAX_TITLE = 200;
const DOC_KIND = 'doc';

/* The open doc comments a person holds, each with the doc it sits on, limited to the docs they can still read. */
const assignedDocComments = async (companyId, uid) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGE_COMMENTS,
        data: [{ ...OPEN_ASSIGNED, assigneeId: String(uid) }, {}, { sort: { assignedAt: -1, _id: -1 }, limit: MAX_ROWS }],
    }, 'find') || [];
    const pageIds = [...new Set(rows.map((row) => String(row.pageId)))];
    if (!pageIds.length) return [];
    const pages = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{ _id: { $in: pageIds.map((id) => new mongoose.Types.ObjectId(id)) }, deletedStatusKey: 0 }, { title: 1, ProjectID: 1, visibility: 1, createdBy: 1 }],
    }, 'find') || [];
    const readable = new Map();
    for (const page of pages) {
        if (await canUsePage(companyId, page, uid)) readable.set(String(page._id), page);
    }
    return rows.filter((row) => readable.has(String(row.pageId))).map((row) => ({
        ...plain(row),
        kind: DOC_KIND,
        pageId: String(row.pageId),
        pageTitle: String(readable.get(String(row.pageId)).title || '').slice(0, MAX_TITLE),
    }));
};

module.exports = { DOC_KIND, assignedDocComments };
