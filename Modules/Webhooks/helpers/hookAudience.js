const { canReadTask } = require('../../Tasks/helpers/taskReadAccess');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const makerOf = (hook) => String((hook && hook.createdBy) || '');

/* A webhook posts a task to an address outside the workspace that its maker chose, so it carries
 * only what its maker can open today. One with no recorded maker predates ownership and is in
 * the hands of the owners and admins, so it carries what they all read: every task but one in
 * a personal list. A conversation is nobody's task and is carried by no webhook. */
const hooksThatMayCarry = async (companyId, hooks, task) => {
    if (task.mainChat === true) return [];
    const makers = [...new Set(hooks.map(makerOf).filter(Boolean))];
    const opens = await Promise.all(makers.map((maker) => canReadTask(companyId, maker, task)));
    const readers = new Set(makers.filter((maker, index) => opens[index]));
    const unowned = hooks.some((hook) => !makerOf(hook)) && !(await inAPersonalList(companyId, task));
    return hooks.filter((hook) => (makerOf(hook) ? readers.has(makerOf(hook)) : unowned));
};

const inAPersonalList = async (companyId, task) => {
    if (!OBJECT_ID.test(String(task.ProjectID || ''))) return false;
    const project = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: new mongoose.Types.ObjectId(String(task.ProjectID)) }, { isPersonal: 1 }] }, 'findOne');
    return Boolean(project) && project.isPersonal === true;
};

const NO_MAKER = [{ createdBy: '' }, { createdBy: null }, { createdBy: { $exists: false } }];

/* The match for the webhooks a person manages: their own, and for an owner or admin also the
 * ones with no recorded maker, which would otherwise keep posting with nobody able to stop them. */
const managedBy = async (companyId, uid) => ({
    $or: [{ createdBy: uid }, ...(isPrivileged(await getRoleType(companyId, uid)) ? NO_MAKER : [])],
});

module.exports = { hooksThatMayCarry, managedBy };
