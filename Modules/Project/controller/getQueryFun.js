const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const { resolveOpenProjectId } = require("../helpers/taskOpenProjectId");

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function asObjectId(id) {
    const raw = String(id || '').trim();
    if (!OBJECT_ID.test(raw)) return null;
    try {
        return new mongoose.Types.ObjectId(raw);
    } catch (_e) {
        return null;
    }
}

exports.getQueryFun = async (req, res) => {
    try {

        const { taskId, projectId, subTaskLimit } = req.query;
        const companyId = req.headers['companyid'];

        if (!taskId || !subTaskLimit || !companyId) {
            return res.status(400).json({ message: "Missing required parameters." });
        }

        const taskOid = asObjectId(taskId);
        if (!taskOid) {
            return res.status(400).json({ message: "Missing required parameters." });
        }

        let resolvedProjectId = resolveOpenProjectId({ queryProjectId: projectId });
        if (!resolvedProjectId) {
            const task = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: taskOid, deletedStatusKey: { $ne: 1 } }, 'ProjectID'],
            }, 'findOne').catch(() => null);
            resolvedProjectId = resolveOpenProjectId({ task });
        }

        if (!resolvedProjectId || !asObjectId(resolvedProjectId)) {
            return res.status(400).json({ message: "Missing required parameters." });
        }

        const query = [
            {
                $match: { _id: new mongoose.Types.ObjectId(resolvedProjectId) }
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

        return res.status(200).json(taskData);
    } catch (error) {
        console.error("Error while processing query:", error);
        return res.status(500).json({ message: "An error occurred while fetching the project", error });
    }
};
