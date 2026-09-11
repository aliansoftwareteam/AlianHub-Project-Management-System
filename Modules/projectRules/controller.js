const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { myCache } = require('../../Config/config');
const { removeCache } = require("../../utils/commonFunctions");

exports.getProjectRules = async(req,res) => {
    try {
        const projectId = req.params.pid;

        const projectRulesObj = {
            type: SCHEMA_TYPE.PROJECT_RULES,
            data: [
                {
                    "projectId": projectId
                }
            ]
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

exports.updateProjectRules = async(req,res) => {
    try {
        const ruleId = req.body.id;
        let key = req.body.key;
        const projectId = req.body.projectId;
        let data =  [
            { _id: ruleId, projectId: String(projectId) },
            {
                [key]: req.body.updateObject
            },
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
            data: [
                {
                    projectId: projectId
                }
            ]
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