const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { removeCache } = require('../../utils/commonFunctions');
const { hiddenSprintIds } = require('../Sprints/helpers/sprintVisibility');
const { sprintPlacementOf } = require('../Tasks/helpers/sprintPlacement');
const { canManageRules } = require('../Automations/helpers/ruleAccess');
const matcher = require('../Automations/engine/matcher');
const { asList, announceFields } = require('../CustomField/helpers/fieldProjects');
const { removeLinksOfTasks } = require('../CustomField/helpers/fieldLinkStore');
const { defaultCurrencyOf } = require('../Company/helpers/companyCurrency');
const { TEAM_PREFIX, namedIds, nonMembersOf, foreignTeamsOf } = require('../../Config/companyMembers');
const { keptOnProject } = require('../../Config/projectPeople');
const rules = require('./rules');

const asId = (id) => new mongoose.Types.ObjectId(String(id));
const find = (companyId, type, filter, projection = null) => MongoDbCrudOpration(companyId, { type, data: [filter, projection, { lean: true }] }, 'find').then((rows) => rows || []);
const insert = (companyId, type, docs) => (docs.length ? MongoDbCrudOpration(companyId, { type, data: [docs] }, 'insertMany') : Promise.resolve([]));

/* A copy is a new project: of the people and teams the source names, it starts with those the company still has. */
const seatedOnly = async (companyId, ids) => {
    const named = namedIds(ids);
    const isTeam = (id) => id.startsWith(TEAM_PREFIX);
    const outside = new Set([
        ...await nonMembersOf(companyId, named.filter((id) => !isTeam(id))),
        ...await foreignTeamsOf(companyId, named.filter(isTeam)),
    ]);
    return named.filter((id) => !outside.has(id));
};

const automationsChanged = (companyId) => {
    removeCache(`automation_rules:${companyId}`);
    matcher.invalidate(companyId);
};

/* Owners and admins read past list privacy unless told not to; anyone else leaves behind the private lists they are not on. */
const listsTheCallerSees = async ({ companyId, caller, sourceId, lists, ownersSeeAll }) => {
    if (ownersSeeAll && isPrivileged(await getRoleType(companyId, caller))) return lists;
    const hidden = new Set((await hiddenSprintIds(companyId, caller, [sourceId])).map(String));
    return lists.filter((list) => !hidden.has(String(list._id)));
};

/* What a copy is made from: the project and the rows around it that the caller may take. Nothing is written. */
const readSource = async ({ companyId, caller, source, ownersSeeAll = true }) => {
    const sourceId = String(source._id);
    const sourceRef = asId(sourceId);
    const ownRules = source.isGlobalPermission === false;
    const [folders, allLists, permissions, fields, allRules] = await Promise.all([
        find(companyId, SCHEMA_TYPE.FOLDERS, { projectId: sourceRef }),
        find(companyId, SCHEMA_TYPE.SPRINTS, { projectId: sourceRef }),
        ownRules ? find(companyId, SCHEMA_TYPE.PROJECT_RULES, { projectId: { $in: [sourceId, sourceRef] } }) : [],
        find(companyId, SCHEMA_TYPE.CUSTOM_FIELDS, { projectId: sourceId, global: { $ne: true } }, { _id: 1 }),
        find(companyId, SCHEMA_TYPE.AUTOMATION_RULES, { deletedStatusKey: { $ne: rules.TRASHED } }),
    ]);
    const liveLists = allLists.filter(rules.isLive);
    const lists = await listsTheCallerSees({ companyId, caller, sourceId, lists: liveLists, ownersSeeAll });
    return {
        source, folders, lists, permissions,
        fieldIds: fields.map((field) => String(field._id)),
        rules: allRules.filter((rule) => rules.ruleTargets(rule, sourceId)),
        notes: lists.length < liveLists.length ? [{ code: 'private_lists_left', count: liveLists.length - lists.length }] : [],
    };
};

const copyAutomations = async ({ companyId, caller, sourceRules, projectId, ids, notes }) => {
    if (!sourceRules.length) return [];
    if (!(await canManageRules(companyId, caller))) {
        notes.push({ code: 'automations_skipped', count: sourceRules.length });
        return [];
    }
    const copies = sourceRules.map((rule) => rules.ruleCopy(rule, { projectId, caller, ids }));
    await insert(companyId, SCHEMA_TYPE.AUTOMATION_RULES, copies);
    automationsChanged(companyId);
    notes.push({ code: 'automations_disabled', count: copies.length });
    return copies.map((rule) => rule._id);
};

/* The definitions are shared with the copy rather than cloned, so the values on copied tasks,
   the view settings and the automations that name a field keep meaning the same field. */
const linkCustomFields = async (companyId, fieldIds, projectId) => {
    if (!fieldIds.length) return [];
    const shared = await find(companyId, SCHEMA_TYPE.CUSTOM_FIELDS, { _id: { $in: fieldIds.map(asId) } }, { _id: 1, projectId: 1 });
    for (const field of shared) await asList(companyId, field);
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELDS,
        data: [{ _id: { $in: fieldIds.map(asId) } }, { $addToSet: { projectId } }],
    }, 'updateMany');
    announceFields(companyId);
    return fieldIds;
};

/* Everything of a project but its tasks, written from what readSource answers. `made` names what was written, so a failure later can take it back. */
const writeStructure = async ({ companyId, caller, bundle, name, code, include, made }) => {
    const source = { ...bundle.source, AssigneeUserId: await seatedOnly(companyId, bundle.source.AssigneeUserId) };
    const sourceId = String(source._id);
    const projectRef = made.projectId;
    const projectId = String(projectRef);
    const ids = new Map([[sourceId, projectId]]);
    const notes = [...bundle.notes];

    const codes = await find(companyId, SCHEMA_TYPE.PROJECTS, {}, { ProjectCode: 1 });
    const { copies: folderRows, moved } = rules.folderCopies(bundle.folders, projectRef, ids);
    moved.forEach((folderName) => notes.push({ code: 'subfolder_moved_to_top', name: folderName }));
    const listRows = rules.listCopies(bundle.lists, projectRef, ids, include);
    const sourceLists = bundle.lists.filter((list) => ids.has(String(list._id)));

    const currency = rules.hasCurrency(source) ? undefined : await defaultCurrencyOf(companyId);
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: rules.projectCopy(source, { id: projectRef, name, code: code || rules.nextProjectCode(source.ProjectCode, codes.map((row) => row.ProjectCode)), caller, companyId, include, ids, currency }),
    }, 'save');

    // The project is written first: who may be named on its lists and tasks is read off the stored row.
    const keepPeople = keptOnProject(companyId, projectId);
    for (const list of listRows) {
        if (Array.isArray(list.AssigneeUserId) && list.AssigneeUserId.length) list.AssigneeUserId = await keepPeople(list.AssigneeUserId);
    }
    await insert(companyId, SCHEMA_TYPE.FOLDERS, folderRows);
    await insert(companyId, SCHEMA_TYPE.SPRINTS, listRows);
    await insert(companyId, SCHEMA_TYPE.PROJECT_RULES, rules.permissionCopies(bundle.permissions, projectId));
    const sharedFields = await linkCustomFields(companyId, bundle.fieldIds, projectId);
    made.rules = await copyAutomations({ companyId, caller, sourceRules: bundle.rules, projectId, ids, notes });

    const placements = new Map();
    for (const list of listRows) placements.set(String(list._id), (await sprintPlacementOf(companyId, list)).set);

    return {
        project, ids, notes, placements, sharedFields, keepPeople,
        sourceListIds: sourceLists.map((list) => list._id),
        counts: { folders: folderRows.length, lists: listRows.length, tasks: 0, automations: made.rules.length },
    };
};

/* Takes back what a failed copy wrote. Every filter names the copy's own id, which nothing else carries. */
const discard = async (companyId, made) => {
    const projectRef = made.projectId;
    const projectId = String(projectRef);
    const drop = (type, filter) => MongoDbCrudOpration(companyId, { type, data: [filter] }, 'deleteMany');
    const copied = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ ProjectID: projectRef }, { _id: 1 }, { lean: true }] }, 'find').catch(() => []);
    await Promise.allSettled([
        removeLinksOfTasks(companyId, (copied || []).map((row) => row._id)),
        drop(SCHEMA_TYPE.TASKS, { ProjectID: projectRef }),
        drop(SCHEMA_TYPE.SPRINTS, { projectId: projectRef }),
        drop(SCHEMA_TYPE.FOLDERS, { projectId: projectRef }),
        drop(SCHEMA_TYPE.PROJECT_RULES, { projectId: { $in: [projectId, projectRef] } }),
        drop(SCHEMA_TYPE.PROJECTS, { _id: projectRef }),
        made.rules.length ? drop(SCHEMA_TYPE.AUTOMATION_RULES, { _id: { $in: made.rules } }).then(() => automationsChanged(companyId)) : null,
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ projectId }, { $pull: { projectId } }] }, 'updateMany')
            .then(() => announceFields(companyId)),
    ]);
};

module.exports = { readSource, writeStructure, discard };
