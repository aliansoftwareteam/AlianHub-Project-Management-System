const mongoose = require('mongoose');
const { tenantOf } = require('./tenant');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { outsiderRefusal, heldIn } = require('./companyMembers');
const logger = require('./loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const refuse = (res, statusCode, reason) => res.status(statusCode).send({ status: false, statusText: reason, message: reason });

/* Refuses a write that names someone outside the verified company. `named(req)` lists the ids the write puts into
 * `fields`; ids the stored document (`current`) already holds there are not new, so keeping them is allowed. */
const namesOnlyMembers = ({ fields, named, current = null }) => async (req, res, next) => {
    try {
        const ids = named(req);
        if (!ids.length) return next();
        const companyId = tenantOf(req);
        const held = current ? heldIn(await current(req, companyId), fields) : new Set();
        const reason = await outsiderRefusal(companyId, ids.filter((id) => !held.has(id)));
        return reason ? refuse(res, 400, reason) : next();
    } catch (error) {
        if (error && error.statusCode) return refuse(res, error.statusCode, error.message);
        logger.error(`namesOnlyMembers: ${(error && error.message) || error}`);
        return refuse(res, 500, 'Could not check the people this change names.');
    }
};

const storedById = (type, fields) => (id) => (req, companyId) => {
    const docId = String(id(req) || '');
    if (!OBJECT_ID.test(docId)) return null;
    const projection = Object.fromEntries(fields.map((field) => [field, 1]));
    return MongoDbCrudOpration(companyId, { type, data: [{ _id: new mongoose.Types.ObjectId(docId) }, projection] }, 'findOne');
};

module.exports = { namesOnlyMembers, storedById };
