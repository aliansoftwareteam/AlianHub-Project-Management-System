const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration,validateObjectId } = require("../../../utils/mongo-handler/mongoQueries");

exports.getProjectById = async (req, res) => {
    try {
        const projectId = req.params.id;

        if (!validateObjectId(projectId)) {
            return res.status(400).json({ message: "Invalid project ID" });
        }

        let mongoObj;
        if (req.query.fields) {
            const fields = req.query.fields.split(',');

            const projection = {};
            fields.forEach((field) => {
                projection[field] = 1;
            });

            mongoObj = {
                type: SCHEMA_TYPE.PROJECTS,
                data: [
                    { _id: projectId },
                    projection
                ]
            };
        } else {
            mongoObj = {
                type: SCHEMA_TYPE.PROJECTS,
                data: [
                    { _id: projectId },
                ]
            };
        }

        const project = await MongoDbCrudOpration(req.headers['companyid'], mongoObj, 'findOne');

        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }

        return res.status(200).json(project);

    } catch (error) {
        return res.status(500).json({ message: "An error occurred while fetching the project",error:error });
    }
};


