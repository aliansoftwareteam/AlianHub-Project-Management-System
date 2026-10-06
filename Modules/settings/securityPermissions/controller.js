const { myCache } = require("../../../Config/config");
const { reconcileCompanyRules } = require('./reconcileRules');
const { removeCache } = require("../../../utils/commonFunctions");
const { dbCollections } = require("../../../Config/collections");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");


/**
 * This endpoint is used to update the security & permissions
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.updateSecurityPermissions = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { key,updateObject,type,id } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while updating the security & permissions.",
                error: "Company ID is required in headers."
            });
        }
        if(!type){
            return res.status(400).json({message: 'Type is Required'});
        }
        if(type === 'updateOne'){
            if (!(updateObject && Object.keys(updateObject).length) || !(key) || !(id)) {
                return res.status(400).json({message: `${!updateObject ? 'Update Object' : !key ? 'Key' : !id ? 'Id' : '' } is Required`});
            }
        }else{
            return res.status(400).json({message: 'Invalid type'});
        }
        const currentDate = new Date();

        const updateObjectDate = {
            ...updateObject,
            updatedAt: currentDate
        };

        const query = {
            type: dbCollections.RULES,
            data:[
                { _id: new mongoose.Types.ObjectId(id) },
                { [key]: updateObjectDate },
            ]
        };
        const response = await MongoDbCrudOpration(companyId, query, type);
        removeCache(`rules:${companyId}`);
        return res.status(200).json(response);
    } catch (error) {
        console.error(`Error updating or inserting security & permissions:`, error);
        return res.status(500).json({
            message: `An error occurred while updating or inserting security & permissions.`,
            error: error.message || error
        });
    }
};

/**
 * This endpoint is used to get the security & permissions
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getSecurityPermissions = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the security & permissions.",
                error: "Company ID is required in headers."
            });
        }
        let response = await exports.fetchRules(companyId);

        // Repair a company that predates a permission. Deliberately only here and not inside
        // fetchRules: fetchRules is a hot path (getProjectList calls it on every load), and the
        // repair re-seeds the rules collection, so triggering it from an ordinary page load would
        // put a delete-then-insert in front of every user. This screen is admin-only and rarely
        // opened, which is where that work belongs.
        response = await reconcileCompanyRules(companyId, response);

        return res.status(200).json(response && response.length ? response : []);
    } catch (error) {
        console.error(`Error getting security & permissions:`, error);
        return res.status(500).json({
            message: `An error occurred while getting security & permissions.`,
            error: error.message || error
        });
    }
}

exports.fetchRules = (companyId) => {
    return new Promise((resolve, reject) => {
        try {
            const cacheKey = `rules:${companyId}`;
            const cachedValue = myCache.get(cacheKey);
            if (cachedValue) {
                return resolve(JSON.parse(cachedValue));
            }

            const ruleObj = { type: dbCollections.RULES, data: [] };
            MongoDbCrudOpration(companyId, ruleObj, 'find')
                .then(rules => {
                    const rulesToCache = rules && rules.length ? rules : [];
                    // An empty read is never cached. This is a hot path — getProjectList calls it on
                    // every load — and caching nothing for a week would fail every permission check
                    // closed for that company. Empty means the collection is mid-write or seeding
                    // never finished, both of which resolve on their own.
                    if (rulesToCache.length) {
                        myCache.set(cacheKey, JSON.stringify(rulesToCache), 604800); // Cache for 1 week
                    }
                    resolve(rulesToCache);
                })
                .catch(error => reject(error));
        } catch (error) {
            reject(error);
        }
    });
};
