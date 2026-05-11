const { default: mongoose } = require("mongoose");
const loggerConfig = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../Auth/helper");
const socketEmitter = require("../../event/socketEventEmitter");

exports.getEstimatedTime = async(req,res) => {
    try {
        const projectId = req.params.pid;
        const TaskId = req.params.tid;

        const estimatedObj = {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: [
                {
                    "ProjectId": projectId,
                    "TaskId": TaskId
                }
            ]
        };

        const estimatedTime =  await MongoDbCrudOpration(req.headers['companyid'], estimatedObj, 'find');

        if (!estimatedTime) {
            return res.status(404).json({ message: "Estimated time not found" });
        }

        res.status(200).json(estimatedTime);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the estimated time.", error: error.message });
    }
}

exports.updateEstimatedTime = async(req,res) => {
    try {
        let key = req.body.key;
        let newObj = req.body.newObj || {}

        let data =  [
            req.body.compareObj, 
            {
                [key]: req.body.updateObject
            },
            newObj,
        ]

        let mongoObj = {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: data
        }
        const estimatedTime = await MongoDbCrudOpration(req.headers['companyid'], mongoObj, 'findOneAndUpdate');

        if (!estimatedTime) {
            return res.status(400).json({ message: "Estimated time not updated" });
        }
        if (estimatedTime.TaskId) {
            exports.updateRemainingTime(req.headers['companyid'],estimatedTime.TaskId);
        }
        return res.status(200).json(estimatedTime);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while updating the estimated time.", error: error.message });
    }
}

exports.getEstimateByAggregate = async (req,res) => {
    try {
        const query = replaceObjectKey(req.body.queryeta, ["dbDate"])

        const estObj = {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: [query]
        };
        const estimateData = await MongoDbCrudOpration(req.headers['companyid'], estObj, 'aggregate');

        if (!estimateData) {
            return res.status(404).json({ message: "Estimated time not found" });
        }

        res.status(200).json(estimateData);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the estimated time.", error: error.message });
    }
}