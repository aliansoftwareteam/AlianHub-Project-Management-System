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
        
        let mongoObj = {
            type: SCHEMA_TYPE.TASKS,
            data: [
                {
                    ProjectID: new mongoose.Types.ObjectId(projectId),
                    ...req.body.findObject
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