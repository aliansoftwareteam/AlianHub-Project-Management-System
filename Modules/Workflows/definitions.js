const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

// A workflow somebody composed and saved, as opposed to one execution of it.
//
// A definition is saved disabled and stays that way until somebody turns it on,
// which is the rule an automation rule already follows: a workflow that could
// start spending the moment it was saved gives its author no chance to read it
// back first. `enabled` is therefore never taken from a create or an update
// body — `setEnabled` is the only way it moves.

const TYPE = SCHEMA_TYPE.WORKFLOW_DEFINITIONS;
const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

const call = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: TYPE, data }, method);

const live = { deletedStatusKey: { $ne: 1 } };

const positive = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);

const boundsOf = (body) => ({
    deadlineMs: positive(body.deadlineMs),
    budgetUsd: positive(body.budgetUsd),
});

const list = async (companyId) => (await call(companyId, [live, {}, { sort: { updatedAt: -1 } }], 'find')) || [];

const get = (companyId, id) => call(companyId, [{ _id: id, ...live }], 'findOne');

const create = (companyId, { name, description, steps, deadlineMs, budgetUsd, by }) => call(companyId, {
    _id: new mongoose.Types.ObjectId(),
    name: String(name || '').slice(0, NAME_MAX),
    description: String(description || '').slice(0, DESCRIPTION_MAX),
    steps,
    ...boundsOf({ deadlineMs, budgetUsd }),
    enabled: false,
    createdBy: String(by || ''),
    updatedBy: String(by || ''),
    deletedStatusKey: 0,
}, 'save');

const update = (companyId, id, { name, description, steps, deadlineMs, budgetUsd, by }) => call(companyId, [
    { _id: id, ...live },
    {
        $set: {
            name: String(name || '').slice(0, NAME_MAX),
            description: String(description || '').slice(0, DESCRIPTION_MAX),
            steps,
            ...boundsOf({ deadlineMs, budgetUsd }),
            updatedBy: String(by || ''),
        },
    },
    { returnDocument: 'after' },
], 'findOneAndUpdate');

const setEnabled = (companyId, id, enabled, by) => call(companyId, [
    { _id: id, ...live },
    { $set: { enabled: Boolean(enabled), enabledBy: String(by || ''), enabledAt: new Date(), updatedBy: String(by || '') } },
    { returnDocument: 'after' },
], 'findOneAndUpdate');

/* Soft, and disabled on the way out: a row nothing lists must not be a workflow
 * something could still start. */
const remove = (companyId, id) => call(companyId, [
    { _id: id, ...live },
    { $set: { deletedStatusKey: 1, enabled: false } },
    { returnDocument: 'after' },
], 'findOneAndUpdate');

module.exports = { TYPE, NAME_MAX, DESCRIPTION_MAX, list, get, create, update, setEnabled, remove };
