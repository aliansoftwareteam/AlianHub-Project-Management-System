const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration,validateObjectId } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")

exports.projectAlltaskUpdate = async (req,res) => {
    try {

        const projectId = req.params.id;

        if (!(req.body && req.body.findObject)) {
            return res.status(400).json({message: 'find Object is Required'});
        }

        if (!(req.body && req.body.updateObject)) {
            return res.status(400).json({message: 'Update Object is Required'});
        }

        if (!validateObjectId(projectId)) {
            return res.status(400).json({ message: "Invalid project ID" });
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
        const tasks = await MongoDbCrudOpration(req.headers['companyid'], mongoObj, 'updateMany');
        
        if (!tasks) {
            return res.status(400).json({ message: "Project's task not updated" });
        }

        return res.status(200).json();
    } catch (error) {
        return res.status(500).json({ message: "An error occurred while updating the project tasks",error:error });
    }
}