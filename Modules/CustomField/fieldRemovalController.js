const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const socketEmitter = require('../../event/socketEventEmitter');
const { FIELD_REMOVED_SOURCE } = require('../../utils/entityEvents');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { narrowingFor } = require('../../Config/tokenNarrowing');
const { recordAuditFromReq } = require('../Audit/recorder');
const { visibleProjectIds } = require('../Agents/scope');
const { visibilityStage, toObjectIds } = require('../Tasks/helpers/taskQueryGuard');
const { extractReferences } = require('./helpers/formula');
const { aliasesOf } = require('./helpers/computeFields');
const { announceFields, listOf } = require('./helpers/fieldProjects');

/* Archiving a field is the field update with `isDelete: false`: it hides the field and keeps every value. Deleting,
 * here, takes the field and its values away for good, so the form first says how many tasks hold one. */

const FIELD_IS_READ = 'FIELD_IS_READ';
const HOLDS_A_VALUE = { $exists: true, $nin: ['', null] };
const NOT_A_CONVERSATION = { mainChat: { $ne: true } };
/* Past this many tasks the open screens are told of the field alone: they read the definitions again and stop showing it. */
const MOST_TASKS_TOLD = 500;

const idOf = (req) => new mongoose.Types.ObjectId(String(req.params.fieldId));
const fields = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data }, method);
const tasks = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data }, method);
const valuePath = (fieldId) => `customField.${fieldId}`;
const projectsOf = (field) => (field.global === true ? [] : listOf(field.projectId));
const inProjects = (ids) => ({ ProjectID: { $in: [...ids, ...toObjectIds(ids)] } });

const namesOf = (expression) => {
    try {
        return extractReferences(expression);
    } catch (error) {
        return [];
    }
};

/* A field of some projects is worked out with the fields of those projects, so only a rollup or a formula that
 * shows in one of them can read it. */
const showsWith = (field, other) => field.global === true || other.global === true || projectsOf(other).some((id) => projectsOf(field).includes(id));

/* The rollups that add this field up and the formulas that name it: without it each would show nothing. The ones
 * of projects the person cannot open are not named to them, only said to exist. */
const readersOf = async (companyId, uid, field) => {
    const id = String(field._id);
    const aliases = aliasesOf(field);
    const others = (await fields(companyId, [{ fieldType: { $in: ['rollup', 'formula'] } }], 'find') || []).filter((other) => String(other._id) !== id);
    const readers = others.filter((other) => showsWith(field, other) && (other.fieldType === 'rollup'
        ? String(other.rollupSourceFieldId || '') === id
        : namesOf(other.formulaExpression).some((name) => aliases.includes(name))));
    if (!readers.length) return { readBy: [], readElsewhere: false };
    const open = new Set(await visibleProjectIds(companyId, uid));
    const shown = readers.filter((other) => other.global === true || projectsOf(other).some((projectId) => open.has(projectId)));
    return { readBy: shown.map((other) => other.fieldTitle || ''), readElsewhere: shown.length < readers.length };
};

/* The count is of the tasks the person asking can open, as a task list would give them, and for a field of some
 * projects of the tasks of those projects. */
const tasksHolding = async (companyId, uid, field) => {
    const { $match: open } = await visibilityStage(companyId, uid);
    const own = projectsOf(field);
    const filter = { $and: [open, NOT_A_CONVERSATION, ...(own.length ? [inProjects(own)] : []), { [`${valuePath(field._id)}.fieldValue`]: HOLDS_A_VALUE }] };
    return Number(await tasks(companyId, [filter], 'countDocuments')) || 0;
};

const opensEveryTask = async (companyId, uid) => isPrivileged(await getRoleType(companyId, uid)) && !narrowingFor(uid);

const usageOf = async (companyId, uid, field) => ({
    tasks: await tasksHolding(companyId, uid, field),
    partial: !(await opensEveryTask(companyId, uid)),
    ...(await readersOf(companyId, uid, field)),
});

const notFound = (res) => res.status(404).json({ status: false, statusText: 'Custom field not found.', message: 'Custom field not found.' });
const failed = (res, error, text) => {
    logger.error(`${text}: ${(error && error.message) || error}`);
    return res.status(500).json({ status: false, statusText: text, message: text });
};

const readText = ({ readBy, readElsewhere }) => {
    if (!readBy.length) return 'This field is read by a field of a project you cannot open. Ask an owner or an admin to change or delete that field first.';
    return `This field is read by ${readBy.join(', ')}${readElsewhere ? ' and by a field of a project you cannot open' : ''}. Change or delete that field first.`;
};

/* Nobody edited these tasks: the time each was last changed stays, and the event says why the value went, so it is
 * no "task updated" for a webhook or a rule. */
const takeValuesAway = async (companyId, fieldId) => {
    const path = valuePath(fieldId);
    const holders = await tasks(companyId, [{ [path]: { $exists: true } }, { _id: 1, mainChat: 1 }, { lean: true }], 'find') || [];
    if (!holders.length) return 0;
    await tasks(companyId, [{ [path]: { $exists: true } }, { $unset: { [path]: '' } }, { timestamps: false }], 'updateMany');
    const told = holders.filter((task) => task.mainChat !== true).slice(0, MOST_TASKS_TOLD).map((task) => task._id);
    const rows = told.length ? await tasks(companyId, [{ _id: { $in: told } }], 'find') || [] : [];
    rows.forEach((data) => socketEmitter.emit('update', { type: 'update', data, updatedFields: { [path]: null }, module: 'task', companyId: String(companyId), source: FIELD_REMOVED_SOURCE }));
    return holders.length;
};

exports.fieldUsage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const field = await fields(companyId, [{ _id: idOf(req) }], 'findOne');
        if (!field) return notFound(res);
        return res.status(200).json({ status: true, statusText: 'Field usage fetched.', data: await usageOf(companyId, req.uid, field) });
    } catch (error) {
        return failed(res, error, 'The use of this field could not be read.');
    }
};

exports.deleteCustomField = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const field = await fields(companyId, [{ _id: idOf(req) }], 'findOne');
        if (!field) return notFound(res);
        const held = await tasksHolding(companyId, req.uid, field);
        const readers = await readersOf(companyId, req.uid, field);
        if (readers.readBy.length || readers.readElsewhere) {
            const text = readText(readers);
            return res.status(409).json({ status: false, code: FIELD_IS_READ, statusText: text, message: text, data: readers });
        }

        const id = String(field._id);
        await fields(companyId, [{ _id: field._id }], 'findOneAndDelete');
        const removed = await takeValuesAway(companyId, id);
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELD_LINKS, data: [{ fieldId: id }] }, 'deleteMany');
        announceFields(companyId, 'update');
        removeCache(`aiFieldAutoRefill:${companyId}`);
        recordAuditFromReq(req, {
            action: 'custom_field.deleted',
            entityType: 'custom_field',
            entityId: id,
            entityName: field.fieldTitle || '',
            meta: { fieldType: field.fieldType || '', tasks: removed, projects: projectsOf(field) },
        });
        return res.status(200).json({ status: true, statusText: 'Custom field deleted.', data: { tasks: held } });
    } catch (error) {
        return failed(res, error, 'The field could not be deleted.');
    }
};

exports.FIELD_IS_READ = FIELD_IS_READ;
