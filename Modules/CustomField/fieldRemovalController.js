const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { extractReferences } = require('./helpers/formula');
const { aliasesOf } = require('./helpers/computeFields');
const { announceFields } = require('./helpers/fieldProjects');

/* Archiving a field is the field update with `isDelete: false`: it hides the field and keeps every value. Deleting,
 * here, takes the field and its values away for good, so the form first says how many tasks hold one. */

const FIELD_IS_READ = 'FIELD_IS_READ';
const HOLDS_A_VALUE = { $exists: true, $nin: ['', null] };

const idOf = (req) => new mongoose.Types.ObjectId(String(req.params.fieldId));
const fields = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data }, method);
const tasks = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data }, method);
const valuePath = (fieldId) => `customField.${fieldId}`;

const namesOf = (expression) => {
    try {
        return extractReferences(expression);
    } catch (error) {
        return [];
    }
};

/* The rollups that add this field up and the formulas that name it: without it each would show nothing. */
const readersOf = async (companyId, field) => {
    const id = String(field._id);
    const aliases = aliasesOf(field);
    const others = (await fields(companyId, [{ fieldType: { $in: ['rollup', 'formula'] } }], 'find') || []).filter((other) => String(other._id) !== id);
    return others
        .filter((other) => (other.fieldType === 'rollup'
            ? String(other.rollupSourceFieldId || '') === id
            : namesOf(other.formulaExpression).some((name) => aliases.includes(name))))
        .map((other) => other.fieldTitle || '');
};

const usageOf = async (companyId, field) => ({
    tasks: Number(await tasks(companyId, [{ [`${valuePath(field._id)}.fieldValue`]: HOLDS_A_VALUE }], 'countDocuments')) || 0,
    readBy: await readersOf(companyId, field),
});

const notFound = (res) => res.status(404).json({ status: false, statusText: 'Custom field not found.', message: 'Custom field not found.' });
const failed = (res, error, text) => {
    logger.error(`${text}: ${(error && error.message) || error}`);
    return res.status(500).json({ status: false, statusText: text, message: text });
};

exports.fieldUsage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const field = await fields(companyId, [{ _id: idOf(req) }], 'findOne');
        if (!field) return notFound(res);
        return res.status(200).json({ status: true, statusText: 'Field usage fetched.', data: await usageOf(companyId, field) });
    } catch (error) {
        return failed(res, error, 'The use of this field could not be read.');
    }
};

exports.deleteCustomField = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const field = await fields(companyId, [{ _id: idOf(req) }], 'findOne');
        if (!field) return notFound(res);
        const { tasks: held, readBy } = await usageOf(companyId, field);
        if (readBy.length) {
            const text = `This field is read by ${readBy.join(', ')}. Change or delete that field first.`;
            return res.status(409).json({ status: false, code: FIELD_IS_READ, statusText: text, message: text, data: { readBy } });
        }

        const id = String(field._id);
        await fields(companyId, [{ _id: field._id }], 'findOneAndDelete');
        await tasks(companyId, [{ [valuePath(id)]: { $exists: true } }, { $unset: { [valuePath(id)]: '' } }], 'updateMany');
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELD_LINKS, data: [{ fieldId: id }] }, 'deleteMany');
        announceFields(companyId, 'update');
        removeCache(`aiFieldAutoRefill:${companyId}`);
        logger.info(`custom field ${id} deleted by ${req.uid} in ${companyId}: ${held} task values removed`);
        return res.status(200).json({ status: true, statusText: 'Custom field deleted.', data: { tasks: held } });
    } catch (error) {
        return failed(res, error, 'The field could not be deleted.');
    }
};

exports.FIELD_IS_READ = FIELD_IS_READ;
