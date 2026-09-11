const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const logger = require("../../../Config/loggerConfig");
const mongoose = require("mongoose")
const savedFilters = require("../../AdvancedGlobalFilter/helpers/savedFilters");

const NAME_MAX_LENGTH = 200;
const EDITABLE_FIELDS = ['name', 'filters', 'sortByField', 'sortByOrder'];
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const reject = (res, statusCode, statusText, field) => res.status(statusCode).json({ status: false, statusText, message: statusText, ...(field ? { field } : {}) });

const checkEditableFields = (body, { requireName }) => {
    if (requireName || body.name !== undefined) {
        if (!isText(body.name)) return { field: 'name', message: 'A filter name is required.' };
        if (body.name.trim().length > NAME_MAX_LENGTH) return { field: 'name', message: `A filter name can be at most ${NAME_MAX_LENGTH} characters.` };
    }
    if (body.filters !== undefined && !Array.isArray(body.filters)) return { field: 'filters', message: 'filters must be a list.' };
    for (const field of ['sortByField', 'sortByOrder']) {
        if (body[field] !== undefined && body[field] !== null && !isPlainObject(body[field])) return { field, message: `${field} must be an object.` };
    }
    return null;
};

const validateCreateFilter = (body = {}) => {
    const invalid = checkEditableFields(body, { requireName: true });
    if (invalid) return invalid;
    for (const field of ['filter', 'typeFilter']) {
        if (!isText(body[field])) return { field, message: `${field} is required.` };
    }
    return null;
};

const validateUpdateFilter = (body = {}) => {
    if (!OBJECT_ID.test(String(body.id || body._id || ''))) return { field: 'id', message: 'A valid filter id is required.' };
    if (!EDITABLE_FIELDS.some((field) => body[field] !== undefined)) return { field: 'name', message: 'Nothing to update.' };
    return checkEditableFields(body, { requireName: false });
};

exports.validateCreateFilter = validateCreateFilter;
exports.validateUpdateFilter = validateUpdateFilter;

exports.saveFilter = async (req, res) => {
    try {
        const body = req.body || {};
        const invalid = validateCreateFilter(body);
        if (invalid) return reject(res, 400, invalid.message, invalid.field);

        const companyId = req.headers['companyid'];
        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: {
                name: body.name.trim(),
                filters: body.filters || [],
                userId: String(req.uid),
                companyId: String(companyId),
                filter: body.filter,
                typeFilter: body.typeFilter,
                ...(body.sortByField ? { sortByField: body.sortByField } : {}),
                ...(body.sortByOrder ? { sortByOrder: body.sortByOrder } : {}),
            }
        };

        const response = await MongoDbCrudOpration(companyId, params, "save");
        return res.status(200).json({ status: true, statusText: 'Filter saved.', data: response });
    } catch (error) {
        if (error && error.name === 'ValidationError') return reject(res, 400, 'The filter is incomplete.');
        logger.error(`saveFilter: ${error && error.message}`);
        return reject(res, 500, 'An error occurred while saving the project global filter');
    }
}

exports.getFilter = savedFilters.listFilters(() => ({ filter: 'projectFilter', typeFilter: 'projects' }));

exports.updateFilter = async (req, res) => {
    try {
        const body = req.body || {};
        const invalid = validateUpdateFilter(body);
        if (invalid) return reject(res, 400, invalid.message, invalid.field);

        const update = {};
        EDITABLE_FIELDS.forEach((field) => {
            if (body[field] !== undefined) update[field] = field === 'name' ? body.name.trim() : body[field];
        });

        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [
                { _id: new mongoose.Types.ObjectId(String(body.id || body._id)), userId: String(req.uid) },
                { $set: update },
                { new: true }
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'findOneAndUpdate');
        if (!response) return reject(res, 404, 'Filter not found.');
        return res.status(200).json({ status: true, statusText: 'Filter updated.', data: response });
    } catch (error) {
        logger.error(`updateFilter: ${error && error.message}`);
        return reject(res, 500, 'An error occurred while update the project global filter');
    }
}

exports.deleteFilter = savedFilters.deleteFilter;
