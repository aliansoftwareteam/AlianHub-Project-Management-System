const { myCache } = require("../../../../Config/config");
const { removeCache } = require("../../../../utils/commonFunctions");
const { dbCollections } = require("../../../../Config/collections");
const { MongoDbCrudOpration } = require("../../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const { settingsUpdateProblem, SETTINGS_UPDATES } = require("../../settingsDocUpdate");

/**
 * This endpoint is used to insert the task type template
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.insertTaskTypeTemplate = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { updateObject } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while inserting the task type templates.",
                error: "Company ID is required in headers."
            });
        }
        if (!(updateObject && Object.keys(updateObject).length)) {
            return res.status(400).json({message: 'Update Object is Required'});
        }
        const currentDate = new Date();

        const updateObjectDate = {
            ...updateObject,
            updatedAt: currentDate,
            createdAt: currentDate
        };

        const query = {
            type: dbCollections.TASK_TYPE_TEMPLATES,
            data: updateObjectDate
        };
        
        const response = await MongoDbCrudOpration(companyId, query, 'save');
        removeCache(`taskTypeTemplate:${companyId}`);
        return res.status(200).json(response);
    } catch (error) {
        console.error(`Error updating or inserting custom field:`, error);
        return res.status(500).json({
            message: `An error occurred while updating or inserting custom field.`,
            error: error.message || error
        });
    }
};

/**
 * This endpoint is used to update the task type template
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.updateTaskTypeTemplate = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { key,updateObject,type,id } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while updating the task type templates.",
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
        const problem = settingsUpdateProblem(SETTINGS_UPDATES.templateName, key, updateObject);
        if (problem) return res.status(400).json({ status: false, message: problem });
        const currentDate = new Date();

        const updateObjectDate = {
            ...updateObject,
            updatedAt: currentDate
        };

        const query = {
            type: dbCollections.TASK_TYPE_TEMPLATES,
            data:[
                { _id: new mongoose.Types.ObjectId(id) },
                { [key]: updateObjectDate },
            ]
        };
        const response = await MongoDbCrudOpration(companyId, query, type);
        removeCache(`taskTypeTemplate:${companyId}`);
        return res.status(200).json(response);
    } catch (error) {
        console.error(`Error updating or inserting custom field:`, error);
        return res.status(500).json({
            message: `An error occurred while updating or inserting custom field.`,
            error: error.message || error
        });
    }
};


/**
 * This endpoint is used to delete the task type template
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.deleteTaskTypeTemplate = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { id } = req.params;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while deleting the task type templates.",
                error: "Company ID is required in headers."
            });
        }
        if (!id) {
            return res.status(400).json({message: `Id is Required`});
        }

        const params = {
            type: dbCollections.TASK_TYPE_TEMPLATES,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                }
            ]
        }

        const response = await MongoDbCrudOpration(companyId, params, "deleteOne");
        removeCache(`taskTypeTemplate:${companyId}`);
        return res.status(200).json(response);
    } catch (error) {
        console.error(`Error deleting task type template:`, error);
        return res.status(500).json({
            message: `An error occurred while deleting task type template.`,
            error: error.message || error
        });
    }
}

/**
 * This endpoint is used to get the task type template
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getTaskTypeTemplate = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the task type templates.",
                error: "Company ID is required in headers."
            });
        }
        const cacheKey = `taskTypeTemplate:${companyId}`;
        const value = myCache.get(cacheKey);
        
        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }

        const object = {
            type: dbCollections.TASK_TYPE_TEMPLATES,
            data: []
        }

        const response = await MongoDbCrudOpration(companyId, object, "find");
        myCache.set( cacheKey, JSON.stringify(response && response.length ? response : []), 604800 );
        return res.status(200).json(response && response.length ? response : []);
    } catch (error) {
        console.error(`Error getting task type template:`, error);
        return res.status(500).json({
            message: `An error occurred while getting task type template.`,
            error: error.message || error
        });
    }
}
