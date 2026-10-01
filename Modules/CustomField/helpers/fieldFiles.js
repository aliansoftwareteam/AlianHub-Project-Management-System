const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter');
const { fieldFileKey, fieldFilePath, filesOf } = require('../fieldTypes/files');
const { customFieldDefinitionsOf } = require('./customFieldText');

const NOT_THIS_FIELD = 'A file here must be one uploaded for this field on this task.';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/* The same proof a task attachment gives: the key sits in the folder the app stores this task's files for this field in.
   The key is read from the company's own bucket, so it cannot name another company's file. */
const isOwnFile = (task, fieldId, key) => {
    const named = fieldFileKey(key);
    return Boolean(named) && Boolean(task && task._id)
        && named.taskId === String(task._id).toLowerCase() && named.fieldId === String(fieldId).toLowerCase();
};

const ownFiles = ({ task, fieldId, value }) => value.filter((file) => isOwnFile(task, fieldId, file.key));

const heldFiles = (task, fieldId) => {
    const entry = task && task.customField && task.customField[fieldId];
    return filesOf(isPlainObject(entry) ? entry.fieldValue : undefined);
};

/* A file the field already lists keeps the record stored for it, so nobody rewrites who added it. A new one is stamped here. */
const stampedFiles = ({ task, fieldId, value, actorId }) => {
    const held = new Map(heldFiles(task, fieldId).map((file) => [file.key, file]));
    return value.map((file) => held.get(file.key) || { key: file.key, name: file.name, size: file.size, type: file.type, uploadedBy: String(actorId || ''), uploadedAt: new Date() });
};

/* The storage module is chosen by an env var that is only set once the server starts, so it is loaded when first used. */
const copyStoredFile = (companyId, from, to) => require(`../../../common-storage/common-${process.env.STORAGE_TYPE}.js`)
    .handleTaskAttachmentsDuplicateFunctionality(companyId, from, to);

/* A duplicate asked to copy attachments also gets its own copy of each field file, stored in the new task's folder. */
const copyFieldFiles = async ({ companyId, source, target }) => {
    const customField = isPlainObject(source && source.customField) ? source.customField : {};
    const definitions = await customFieldDefinitionsOf(companyId, Object.keys(customField));
    const copied = {};
    for (const [fieldId, detail] of Object.entries(customField)) {
        const definition = definitions.get(fieldId);
        if (!definition || definition.fieldType !== 'files') continue;
        const files = [];
        for (const file of ownFiles({ task: source, fieldId, value: filesOf(detail && detail.fieldValue) })) {
            const key = fieldFilePath({ projectId: String(target.ProjectID), taskId: String(target._id), fieldId, name: fieldFileKey(file.key).name });
            try {
                await copyStoredFile(companyId, file.key, key);
                files.push({ ...file, key });
            } catch (error) {
                logger.error(`field file copy failed: ${error && error.message}`);
            }
        }
        if (files.length) copied[fieldId] = { fieldValue: files, _id: fieldId };
    }
    if (!Object.keys(copied).length) return copied;
    const set = Object.fromEntries(Object.entries(copied).map(([fieldId, detail]) => [`customField.${fieldId}`, detail]));
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: new mongoose.Types.ObjectId(String(target._id)) }, { $set: set }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (updated) socketEmitter.emit('update', { type: 'update', data: updated, updatedFields: set, module: 'task' });
    return copied;
};

module.exports = { NOT_THIS_FIELD, isOwnFile, ownFiles, stampedFiles, copyFieldFiles };
