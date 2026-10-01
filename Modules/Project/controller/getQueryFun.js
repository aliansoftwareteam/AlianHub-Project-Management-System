const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/* The folder above the task's own, so a task in a subfolder can be given its full path. */
const parentFolderOf = async (companyId, projectId, row) => {
    const folder = [].concat((row && row.sprintsfolders) || [])[0];
    const parentId = String((folder && folder.parentFolderId) || "");
    if (!OBJECT_ID.test(parentId)) return null;
    const parent = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.FOLDERS,
        data: [{ _id: new mongoose.Types.ObjectId(parentId), projectId: new mongoose.Types.ObjectId(projectId) }, { name: 1 }]
    }, "findOne");
    return parent ? { _id: parent._id, name: parent.name } : null;
};

exports.getQueryFun = async (req, res) => {
    try {

        const { taskId, projectId, subTaskLimit } = req.query;
        const companyId = req.headers['companyid'];

        if (!taskId || !projectId || !subTaskLimit || !companyId) {
            return res.status(400).json({ message: "Missing required parameters." });
        }

        const query = [
            {
                $match: { _id: new mongoose.Types.ObjectId(projectId) }
            },
            {
                $lookup: {
                    from: "tasks",
                    let: { taskId: new mongoose.Types.ObjectId(taskId) },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$_id", "$$taskId"] }
                            }
                        },
                        {
                            $lookup: {
                                from: "sprints",
                                localField: "sprintId",
                                foreignField: "_id",
                                as: "sprintDetails"
                            }
                        },
                        {
                            $addFields: {
                                sprintName: { $arrayElemAt: ["$sprintDetails.name", 0] }
                            }
                        },
                        {
                            $lookup: {
                                from: "folders",
                                localField: "folderObjId",
                                foreignField: "_id",
                                as: "folderDetails"
                            }
                        },
                        {
                            $addFields: {
                                folderName: { $arrayElemAt: ["$folderDetails.name", 0] }
                            }
                        }
                    ],
                    as: "tasks"
                }
            },
            {
                $addFields: {
                    sprintsObj: { $arrayElemAt: ["$tasks.sprintDetails", 0] },
                    sprintsfolders: { $arrayElemAt: ["$tasks.folderDetails", 0] }
                }
            },
            {
                $lookup: {
                    from: "tasks",
                    let: { parentTaskId: taskId },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$ParentTaskId", "$$parentTaskId"] },
                                deletedStatusKey: { $in: [0, undefined] }
                            }
                        },
                        { $sort: { createdAt: -1, _id: 1 } },
                        { $limit: parseInt(subTaskLimit, 10) }
                    ],
                    as: "subtasks"
                }
            }
        ];

        const taskObj = {
            type: SCHEMA_TYPE.PROJECTS,
            data: [query]
        };

        const taskData = await MongoDbCrudOpration(companyId, taskObj, "aggregate");
        if (Array.isArray(taskData) && taskData[0]) {
            taskData[0].parentFolder = await parentFolderOf(companyId, projectId, taskData[0]);
        }

        return res.status(200).json(taskData);
    } catch (error) {
        console.error("Error while processing query:", error);
        return res.status(500).json({ message: "An error occurred while fetching the project", error });
    }
};
