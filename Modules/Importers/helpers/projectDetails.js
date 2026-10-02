const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const socketEmitter = require('../../../event/socketEventEmitter');

const STATUS_FALLBACK_TYPE = 'default_active';
const TAG_COLORS = ['#2F3990', '#1E88E5', '#00897B', '#43A047', '#F4511E', '#8E24AA', '#D81B60', '#6D4C41'];

const lower = (value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase();

const updateProject = async (companyId, projectId, update, updatedFields) => {
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: new mongoose.Types.ObjectId(String(projectId)) }, update, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    removeCache('UserProjectData:', true);
    if (updated) socketEmitter.emit('update', { type: 'update', companyId: String(companyId), data: updated, updatedFields, module: 'project' });
    return updated;
};

/* Appends statuses to the project's own list; returns the list to import against. */
const appendStatuses = async (companyId, project, statusArray, additions) => {
    const known = new Set(statusArray.map((status) => lower(status.name)));
    const fresh = additions.filter((status) => status && lower(status.name) && !known.has(lower(status.name)));
    if (!fresh.length) return statusArray;
    let nextKey = statusArray.reduce((highest, status) => Math.max(highest, Number(status.key) || 0), 0);
    const merged = statusArray.concat(fresh.map((status) => ({ name: status.name, key: ++nextKey, type: status.type || STATUS_FALLBACK_TYPE })));
    await updateProject(companyId, project._id, { $set: { taskStatusData: merged } }, { taskStatusData: merged });
    return merged;
};

/* Turns each task's tag names into the project's tag ids. Names the project lacks are added
 * when `create` is set, and dropped otherwise. Returns the number of tags added. */
const applyImportTags = async (companyId, project, tasks, { create = false } = {}) => {
    const wanted = new Map();
    tasks.forEach((task) => (task.tagNames || []).forEach((name) => { if (!wanted.has(lower(name))) wanted.set(lower(name), name); }));
    const uidByName = new Map((Array.isArray(project.tagsArray) ? project.tagsArray : [])
        .filter((tag) => tag && tag.uid && tag.tagName)
        .map((tag) => [lower(tag.tagName), tag.uid]));

    const added = create
        ? [...wanted.entries()].filter(([key]) => !uidByName.has(key)).map(([key, name], i) => {
            const color = TAG_COLORS[(uidByName.size + i) % TAG_COLORS.length];
            const tag = { uid: crypto.randomBytes(6).toString('hex'), tagName: name, tagColor: color, tagBgColor: `${color}35` };
            uidByName.set(key, tag.uid);
            return tag;
        })
        : [];
    if (added.length) await updateProject(companyId, project._id, { $push: { tagsArray: { $each: added } } }, { tagsArray: added });

    tasks.forEach((task) => {
        if (!Array.isArray(task.tagNames)) return;
        const ids = task.tagNames.map((name) => uidByName.get(lower(name))).filter(Boolean);
        if (ids.length) task.tagsArray = Array.from(new Set(ids));
        delete task.tagNames;
    });
    return added.length;
};

module.exports = { STATUS_FALLBACK_TYPE, appendStatuses, applyImportTags };
