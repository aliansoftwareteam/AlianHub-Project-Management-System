const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")

/**
 * This is the endopint which is return all the fatch all the saved task advance filters.
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getFilter = async (req, res) => {
    try {
        const { userId } = req.params;

        let params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [
                {
                    userId: userId,
                    filter: 'taskFilter',
                    typeFilter: 'projectTask'
                }
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'find');

        if (response) {
            return res.status(200).json({
                status: true,
                data: response
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while get the task global filter",
            error: error 
        });
    }
}

/**
 * This endpoint is used to save task advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.saveFilter = async (req, res) => {
    try {
        const companyId = req.body.companyId;

        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: { ...req.body }
        };

        const response = await MongoDbCrudOpration(companyId, params, "save");

        if(response) {
            return res.status(200).json({
                status: true,
                data: response
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while saving the task global filter",
            error: error 
        });
    }
}

/**
 * This endpoint is used to update task advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.updateFilter = async (req, res) => {
    try {
        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: req.body
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'findOneAndUpdate');

        if(response) {
            return res.status(200).json({
                status: true,
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update the project global filter",
            error: error 
        });
    }
}

/**
 * This endpoint is used to delete task advance filter
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.deleteFilter = async (req, res) => {
    try {
        const { id, cid } = req.params;
        const params = {
            type: SCHEMA_TYPE.GLOBALFILTER,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                }
            ]
        }

        const response = await MongoDbCrudOpration(cid, params, "deleteOne")

        if (response) {
            return res.status(200).json({
                status: true,
            });
        } else {
            return res.status(404).json({
                status: false,
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while delete the project global filter",
            error: error 
        });
    }
}