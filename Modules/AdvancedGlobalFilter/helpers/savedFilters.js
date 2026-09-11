const mongoose = require("mongoose");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const logger = require("../../../Config/loggerConfig");

// A saved filter belongs to the user who saved it and nobody shares one, so every
// read and write is bound to req.uid; ids in the path or body only ever narrow it.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const EDITABLE_FIELDS = ['name', 'filters', 'sortByField', 'sortByOrder'];

const refuse = (res, statusCode, statusText) => res.status(statusCode).json({ status: false, statusText });
const ownerOf = (req) => String(req.uid || '');

const editableSet = (update) => Object.fromEntries(
    Object.entries((update && update.$set) || {}).filter(([key]) => EDITABLE_FIELDS.includes(key))
);

/* kindOf(req) → { filter, typeFilter } for the list being read. */
const listFilters = (kindOf) => async (req, res) => {
    try {
        const uid = ownerOf(req);
        if (req.params.userId !== undefined && String(req.params.userId) !== uid) {
            return refuse(res, 403, 'You can only read your own saved filters.');
        }
        const response = await MongoDbCrudOpration(req.headers['companyid'], {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [{ userId: uid, ...kindOf(req) }],
        }, 'find');
        return res.status(200).json({ status: true, data: response || [] });
    } catch (error) {
        logger.error(`ERROR in list saved filters: ${error.message}`);
        return refuse(res, 500, 'An error occurred while fetching the saved filters.');
    }
};

const saveFilter = async (req, res) => {
    try {
        const uid = ownerOf(req);
        const companyId = req.headers['companyid'] || '';
        const fields = { ...(req.body || {}) };
        if (fields.userId !== undefined && String(fields.userId) !== uid) {
            return refuse(res, 403, 'A saved filter can only be created for yourself.');
        }
        delete fields._id;
        const response = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: { ...fields, userId: uid, companyId },
        }, 'save');
        return res.status(200).json({ status: true, data: response });
    } catch (error) {
        logger.error(`ERROR in save filter: ${error.message}`);
        return refuse(res, 500, 'An error occurred while saving the filter.');
    }
};

/* body: [{ _id }, { $set: { name | filters | sortByField | sortByOrder } }] */
const updateFilter = async (req, res) => {
    try {
        const [where, update] = Array.isArray(req.body) ? req.body : [];
        const id = String((where && where._id) || '');
        if (!OBJECT_ID.test(id)) {
            return refuse(res, 400, 'A valid filter id is required.');
        }
        const set = editableSet(update);
        if (!Object.keys(set).length) {
            return refuse(res, 400, 'Nothing to update.');
        }
        const response = await MongoDbCrudOpration(req.headers['companyid'], {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [{ _id: new mongoose.Types.ObjectId(id), userId: ownerOf(req) }, { $set: set }],
        }, 'findOneAndUpdate');
        if (!response) {
            return refuse(res, 404, 'Saved filter not found.');
        }
        return res.status(200).json({ status: true });
    } catch (error) {
        logger.error(`ERROR in update filter: ${error.message}`);
        return refuse(res, 500, 'An error occurred while updating the filter.');
    }
};

const deleteFilter = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { cid, id } = req.params;
        if (cid !== undefined && String(cid) !== companyId) {
            return refuse(res, 403, 'You do not have access to this company.');
        }
        if (!OBJECT_ID.test(String(id || ''))) {
            return refuse(res, 400, 'A valid filter id is required.');
        }
        const response = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [{ _id: new mongoose.Types.ObjectId(String(id)), userId: ownerOf(req) }],
        }, 'deleteOne');
        if (!response || !response.deletedCount) {
            return refuse(res, 404, 'Saved filter not found.');
        }
        return res.status(200).json({ status: true });
    } catch (error) {
        logger.error(`ERROR in delete filter: ${error.message}`);
        return refuse(res, 500, 'An error occurred while deleting the filter.');
    }
};

module.exports = { EDITABLE_FIELDS, listFilters, saveFilter, updateFilter, deleteFilter };
