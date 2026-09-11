const { myCache } = require("../../../Config/config");
const { settingsCollectionDocs } = require("../../../Config/collections");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { removeCache } = require("../../../utils/commonFunctions");
const { settingsDocUpdateProblem } = require("../settingsDocUpdate");

exports.getRoles = async (req,res) => {
    try {
        const roleObj = {
            type: SCHEMA_TYPE.SETTINGS,
            data: [
                {
                    "name":settingsCollectionDocs.ROLES
                }
            ]
        };
        const companyId = req.headers['companyid'];

        const roleCache = `role:${companyId}`;
        let role = myCache.get(roleCache);
        let isFromCache = true;
        if(!role){
            isFromCache = false;
            role =  await MongoDbCrudOpration(companyId, roleObj, 'find');
            myCache.set(roleCache, role, 604800);
        }
        if (isFromCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(roleCache)
            });
        }

        res.status(200).json(role);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while getting the role", error: error.message });
    }
}

exports.updateRole = async(req,res) => {
    try {
        const companyId = req.headers['companyid'];
        const { queryFilter, queryObj } = req.body;

        const problem = settingsDocUpdateProblem(settingsCollectionDocs.ROLES, queryFilter, queryObj);
        if (problem) {
            return res.status(400).json({ status: false, statusText: problem, message: problem });
        }

        let mongoObj = {
            type: SCHEMA_TYPE.SETTINGS,
            data: [
                queryFilter,
                queryObj,
                {
                    upsert: true,
                    returnDocument : 'after'
                }
            ]
        }
        const updateRoles = await MongoDbCrudOpration(companyId, mongoObj, 'findOneAndUpdate');

        if (!updateRoles) {
            return res.status(400).json({ message: "Role not updated" });
        }
        removeCache(`role:${companyId}`,true);
        return res.status(200).json(updateRoles);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while updating the roles.", error: error.message });
    }
}