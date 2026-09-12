const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration,validateObjectId } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")

exports.projectAlltaskUpdate = async (req,res) => {
    try {

        const projectId = req.params.id;

        if (!(req.body && req.body.findObject)) {
            return res.status(400).json({ status: false, statusText: 'find Object is Required' });
        }

        if (!(req.body && req.body.updateObject)) {
            return res.status(400).json({ status: false, statusText: 'Update Object is Required' });
        }

        if (!validateObjectId(projectId)) {
            return res.status(400).json({ status: false, statusText: 'Invalid project ID' });
        }

        const findProjectId = req.body.findObject.ProjectID;
        if (findProjectId !== undefined && String(findProjectId) !== String(projectId)) {
            return res.status(400).json({ status: false, statusText: 'findObject.ProjectID must match the project in the URL.' });
        }

        let mongoObj = {
            type: SCHEMA_TYPE.TASKS,
            data: [
                {
                    ...req.body.findObject,
                    ProjectID: new mongoose.Types.ObjectId(projectId),
                },
                {$set: req.body.updateObject}
            ]
        }
        const result = await MongoDbCrudOpration(req.headers['companyid'], mongoObj, 'updateMany');

        if (!result || result.acknowledged === false) {
            return res.status(400).json({ status: false, statusText: "Project's task not updated" });
        }

        return res.status(200).json({
            status: true,
            statusText: 'Project tasks updated.',
            data: { matched: result.matchedCount || 0, modified: result.modifiedCount || 0 },
        });
    } catch (error) {
        return res.status(500).json({ status: false, statusText: 'An error occurred while updating the project tasks', message: error.message });
    }
}