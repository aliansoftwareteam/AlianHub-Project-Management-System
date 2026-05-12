const { myCache } = require("../../Config/config");
const { removeCache } = require("../../utils/commonFunctions");
const { dbCollections } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");

exports.insertCustomField = async (req, res) => {
    try {
        const { updateObject, type } = req.body;
        const companyId = req.headers["companyid"];

        if (!companyId) {
            return res.status(400).json({
                message: "Company ID is required in headers."
            });
        }
        const response = await this.insertCustomFieldPromise(updateObject, type, companyId);

        return res.status(200).json(response);
    } catch (error) {
        console.error("Error in insertCustomField:", error);
        return res.status(500).json({
            message: "An error occurred while updating or inserting custom field.",
            error: error.message || error
        });
    }
};

exports.insertCustomFieldPromise = (updateObject, type, companyId) => {
    return new Promise((resolve, reject) => {
        try {
            if (!type) {
                return reject(new Error("Type is required"));
            }
            if (type === "save") {
                if (!(updateObject && Object.keys(updateObject).length)) {
                    return reject(new Error("Update Object is required"));
                }
            } else {
                return reject(new Error("Invalid type"));
            }

            const currentDate = new Date();
            const updateObjectDate = {
                ...updateObject,
                updatedAt: currentDate,
                createdAt: currentDate
            };

            const query = {
                type: dbCollections.CUSTOM_FIELDS,
                data: updateObjectDate
            };

            MongoDbCrudOpration(companyId, query, type)
                .then((response) => {
                    removeCache(`customField:${companyId}`);
                    resolve(response);
                })
                .catch((error) => {
                    console.error("Error in MongoDbCrudOpration:", error);
                    reject(error);
                });

        } catch (error) {
            console.error("Error in insertCustomFieldPromise:", error);
            reject(error);
        }
    });
};


exports.updateCustomField = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { key,updateObject,type,id } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the currency.",
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
            type: dbCollections.CUSTOM_FIELDS,
            data:[
                { _id: new mongoose.Types.ObjectId(id) },
                { [key]: updateObjectDate },
            ]
        };
        const response = await MongoDbCrudOpration(companyId, query, type);
        removeCache(`customField:${companyId}`);
        return res.status(200).json(response);
    } catch (error) {
        console.error(`Error updating or inserting custom field:`, error);
        return res.status(500).json({
            message: `An error occurred while updating or inserting custom field.`,
            error: error.message || error
        });
    }
};

exports.getCustomField = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { global } = req.query;
        // Validate company ID
        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the currency.",
                error: "Company ID is required in headers."
            });
        }
        const isGlobal = global ? global : null;
        if (isGlobal === null) {
            return res.status(400).json({ message: "Invalid value for 'global'. Expected 'true' or 'false'." });
        }
        const cacheKey = isGlobal === 'true' ? `customField:global` : `customField:${companyId}`;
        const value = myCache.get(cacheKey);

        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }
        // Prepare query
        const query = {
            type: dbCollections.CUSTOM_FIELDS,
            data: []
        };

        const target = isGlobal === 'true' ? 'global' : companyId;
        const response = await MongoDbCrudOpration(target, query, 'find');
        myCache.set( cacheKey, JSON.stringify(response && response.length ? response : []), 604800 );
        return res.status(200).json(response && response.length ? response : []);
    } catch (error) {
        console.error(`Error retrieving custom fields:`, error);
        return res.status(500).json({
            message: "An error occurred while retrieving custom fields.",
            error: error.message || error
        });
    }
};
