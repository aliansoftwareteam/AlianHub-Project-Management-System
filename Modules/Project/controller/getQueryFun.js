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

function asPlain(doc) {
    if (!doc) return null;
    if (typeof doc.toObject === 'function') {
        try { return doc.toObject(); } catch (_e) { /* fall through */ }
    }
    if (typeof doc.toJSON === 'function') {
        try { return doc.toJSON(); } catch (_err) { /* fall through */ }
    }
    return doc;
}

function findById(companyId, type, id) {
    const oid = asObjectId(id);
    if (!companyId || !oid) return Promise.resolve(null);
    return MongoDbCrudOpration(companyId, {
        type,
        data: [{ _id: oid }],
    }, 'findOne').catch(() => null);
}

exports.getQueryFun = async (req, res) => {
    try {
        const { taskId, projectId, subTaskLimit } = req.query;
        const companyId = req.headers['companyid'];
        const taskHex = String(taskId || '').trim();
        const taskOid = asObjectId(taskHex);

        if (!taskHex || !subTaskLimit || !companyId || !taskOid) {
            return res.status(400).json({ message: "Missing required parameters." });
        }

        const taskDoc = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: taskOid, deletedStatusKey: { $ne: 1 } }],
        }, 'findOne').catch(() => null);
        const task = asPlain(taskDoc);
        if (!task || !task._id) {
            return res.status(200).json([]);
        }

        let resolvedProjectId = resolveOpenProjectId({ queryProjectId: projectId, task });
        const projectOid = asObjectId(resolvedProjectId);
        if (!projectOid) {
            return res.status(400).json({ message: "Missing required parameters." });
        }

        const projectDoc = await findById(companyId, SCHEMA_TYPE.PROJECTS, resolvedProjectId);
        const project = asPlain(projectDoc);
        if (!project || !project._id) {
            return res.status(200).json([]);
        }

        const limit = parseInt(subTaskLimit, 10) || 35;
        const [sprintDoc, folderDoc, subtasks] = await Promise.all([
            findById(companyId, SCHEMA_TYPE.SPRINTS, task.sprintId),
            findById(companyId, SCHEMA_TYPE.FOLDERS, task.folderObjId),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [[
                    { $match: { ParentTaskId: taskHex, deletedStatusKey: { $in: [0, undefined] } } },
                    { $sort: { createdAt: -1, _id: 1 } },
                    { $limit: limit },
                ]],
            }, 'aggregate').catch(() => []),
        ]);
        const sprint = asPlain(sprintDoc);
        const folder = asPlain(folderDoc);
        const taskRow = {
            ...task,
            sprintName: (sprint && sprint.name) || task.sprintName || '',
            folderName: (folder && folder.name) || task.folderName || '',
        };

        return res.status(200).json([{
            ...project,
            tasks: [taskRow],
            sprintsObj: sprint || {},
            sprintsfolders: folder || {},
            subtasks: subtasks || [],
        }]);
    } catch (error) {
        console.error("Error while processing query:", error);
        return res.status(500).json({ message: "An error occurred while fetching the project", error });
    }
};
