const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { fetchRules } = require('../../settings/securityPermissions/controller');
const { getRoleType } = require('../../../Config/permissionGuard');
const { isPrivileged } = require('../../../Config/roleTypes');
const { killSwitchOn } = require('../../../Config/permissionEnforcement');
const { arrangeRules, rolePermission, isReadable } = require('../../../Config/rulePermissions');
const { visibleProjectIds } = require('../../Agents/scope');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');

const TASK_LIST = 'task.task_list';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const RULE_FIELDS = { isGlobalPermission: 1, isPersonal: 1, personalOwner: 1 };

const usesOwnRules = (project) => project.isGlobalPermission === false;

/* The project page shows no task to a role whose task list permission is unset, judged by the
 * project's own rules when it has them and by the company's otherwise. Read-only still reads, and
 * a personal list is its owner's whatever their role holds elsewhere. */
const listableIds = (projects, { uid, roleType, companyRules, projectRules }) => {
    const company = arrangeRules(companyRules);
    const ownRows = new Map();
    (projectRules || []).forEach((rule) => {
        const id = String(rule.projectId);
        ownRows.set(id, [...(ownRows.get(id) || []), rule]);
    });
    const rulesOf = (project) => (usesOwnRules(project) ? arrangeRules(ownRows.get(String(project._id)) || []) : company);
    return projects
        .filter((project) => (project.isPersonal === true
            ? String(project.personalOwner || '') === String(uid)
            : isReadable(rolePermission(rulesOf(project), roleType, TASK_LIST))))
        .map((project) => String(project._id));
};

/* Of the projects the caller can already open, the ones whose tasks they may list. Owners and
 * admins are held back by no rule, as in the web app. */
const keepTaskListProjectIds = async (companyId, uid, projectIds) => {
    const ids = [...new Set((projectIds || []).map(String))].filter((id) => OBJECT_ID.test(id));
    if (!ids.length) return [];
    const roleType = await getRoleType(companyId, uid);
    if (roleType === null) return [];
    if (isPrivileged(roleType) || killSwitchOn()) return ids;

    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, RULE_FIELDS],
    }, 'find') || [];
    const withOwnRules = projects.filter(usesOwnRules).map((project) => String(project._id));
    const [companyRules, projectRules] = await Promise.all([
        fetchRules(companyId),
        withOwnRules.length
            ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECT_RULES, data: [{ projectId: { $in: idForms(withOwnRules) } }] }, 'find')
            : [],
    ]);
    return listableIds(projects, { uid, roleType, companyRules, projectRules });
};

const taskListProjectIds = async (companyId, uid) => keepTaskListProjectIds(companyId, uid, await visibleProjectIds(companyId, uid));

const mayListTasksIn = async (companyId, uid, projectId) => (await keepTaskListProjectIds(companyId, uid, [projectId])).length === 1;

module.exports = { TASK_LIST, taskListProjectIds, keepTaskListProjectIds, mayListTasksIn };
