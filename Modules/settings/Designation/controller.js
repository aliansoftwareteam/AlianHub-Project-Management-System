const { myCache } = require("../../../Config/config");
const { settingsCollectionDocs } = require("../../../Config/collections");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { removeCache } = require("../../../utils/commonFunctions");
const { settingsDocUpdateProblem } = require("../settingsDocUpdate");

exports.getDesignations = async (req,res) => {
    try {
        const designationObj = {
            type: SCHEMA_TYPE.SETTINGS,
            data: [
                {
                    "name":settingsCollectionDocs.DESIGNATIONS
                }
            ]
        };
        const companyId = req.headers['companyid'];

        const designationCache = `designation:${companyId}`;
        let role = myCache.get(designationCache);
        let isFromCache = true;
        if(!role){
            isFromCache = false;
            role =  await MongoDbCrudOpration(companyId, designationObj, 'find');
            myCache.set(designationCache, role, 604800);
        }
        if (isFromCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(designationCache)
            });
        }

        res.status(200).json(role);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while getting the Designation", error: error.message });
    }
}

exports.updateDesignation = async(req,res) => {
    try {
        const companyId = req.headers['companyid']
        const { queryFilter, queryObj } = req.body;

        const problem = settingsDocUpdateProblem(settingsCollectionDocs.DESIGNATIONS, queryFilter, queryObj);
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
            return res.status(400).json({ message: "Designation not updated" });
        }
        removeCache(`designation:${companyId}`,true);
        return res.status(200).json(updateRoles);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while updating the Designation.", error: error.message });
    }
}