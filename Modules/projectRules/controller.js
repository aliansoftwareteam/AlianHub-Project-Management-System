const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { myCache } = require('../../Config/config');
const { removeCache } = require("../../utils/commonFunctions");
const { idForms } = require("../../utils/mongo-handler/objectIdKeys");

exports.getProjectRules = async(req,res) => {
    try {
        const projectId = req.params.pid;

        const projectRulesObj = {
            type: SCHEMA_TYPE.PROJECT_RULES,
            data: [{ projectId: { $in: idForms(projectId) } }]
        };

        const projectRuleCache = `projectRules:${projectId}`;
        let projectRules = myCache.get(projectRuleCache);
        let isFromCache = true;
        if(!projectRules || (projectRules && projectRules.length === 0)){
            isFromCache = false;
            projectRules =  await MongoDbCrudOpration(req.headers['companyid'], projectRulesObj, 'find');
            myCache.set(projectRuleCache, projectRules, 604800);
        }
        if (isFromCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(projectRuleCache)
            });
        }
        res.status(200).json(projectRules);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the project rules.", error: error.message });
    }
}

const MAX_ROLES = 100;
const isRoleEntry = (entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
    && Object.keys(entry).every((field) => field === 'key' || field === 'permission')
    && ['number', 'string'].includes(typeof entry.key)
    && (entry.permission === null || ['boolean', 'number', 'string'].includes(typeof entry.permission));

/* The settings screen only ever sets a rule's roles; the operator and the fields are not the caller's to choose. */
const rolesUpdateOf = (body) => {
    const update = body && body.updateObject;
    if (body.key !== undefined && body.key !== '$set') return null;
    if (!update || typeof update !== 'object' || Object.keys(update).join() !== 'roles') return null;
    const { roles } = update;
    if (!Array.isArray(roles) || roles.length > MAX_ROLES || !roles.every(isRoleEntry)) return null;
    return { $set: { roles: roles.map(({ key, permission }) => ({ key, permission })) } };
};

exports.updateProjectRules = async(req,res) => {
    try {
        const ruleId = req.body.id;
        const projectId = req.body.projectId;
        const update = rolesUpdateOf(req.body);
        if (!update) {
            return res.status(400).json({ message: "Only a rule's roles can be changed." });
        }
        let data =  [
            { _id: ruleId, projectId: { $in: idForms(String(projectId)) } },
            update,
            { returnDocument: "after" }
        ]

        let mongoObj = {
            type: SCHEMA_TYPE.PROJECT_RULES,
            data: data
        }
        const projectRule = await MongoDbCrudOpration(req.headers['companyid'], mongoObj, 'findOneAndUpdate');

        if (!projectRule) {
            return res.status(400).json({ message: "Project rule not updated" });
        }
        removeCache(`projectRules:${projectId}`,true);
        return res.status(200).json(projectRule);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while updating the project rules.", error: error.message });
    }
}

exports.deleteProjectRules = async(req,res) => {
    try {
        const projectId = req.params.pid;

        const deleteObj = {
            type: SCHEMA_TYPE.PROJECT_RULES,
            data: [{ projectId: { $in: idForms(projectId) } }]
        }
        const response = await MongoDbCrudOpration(req.headers['companyid'], deleteObj, "deleteMany");

        if (response) {
            removeCache(`projectRules:${projectId}`,true);
            return res.status(200).json({status: true});
        } else {
            return res.status(404).json({status: false});
        }
    } catch (error) {
        res.status(500).json({ message: "An error occurred while deleting the project rules.", error: error.message });
    }
}