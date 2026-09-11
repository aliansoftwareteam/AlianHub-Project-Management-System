const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const logger = require("../../../Config/loggerConfig");
const mongoose = require("mongoose")

const NAME_MAX_LENGTH = 200;

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

exports.validateCreateFilter = validateCreateFilter;

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

exports.getFilter = async (req, res) => {
    try {
        const { userId } = req.params;

        let params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [
                {
                    userId: userId,
                    filter: 'projectFilter',
                    typeFilter: 'projects'
                }
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'find');

        if (response) {
            return res.status(200).json({
                status: true,
                data: response
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while get the project global filter",
            error: error
        });
    }
}

exports.updateFilter = async (req, res) => {
    try {
        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: req.body
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'findOneAndUpdate');

        if(response) {
            return res.status(200).json({
                status: true,
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update the project global filter",
            error: error 
        });
    }
}

exports.deleteFilter = async (req, res) => {
    try {
        const { id, cid } = req.params;
        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                }
            ]
        }

        const response = await MongoDbCrudOpration(cid, params, "deleteOne")

        if (response) {
            return res.status(200).json({
                status: true,
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while delete the project global filter",
            error: error
        });
    }
}
