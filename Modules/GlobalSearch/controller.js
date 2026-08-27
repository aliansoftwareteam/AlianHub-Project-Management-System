const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const logger = require("../../Config/loggerConfig");
const { escapeRegex } = require("../../utils/escapeRegex");
const { validateSearchInput, truncate, RESULT_LIMIT_PER_TYPE } = require('./helpers/searchRules');
const { shapeOpenTaskHit } = require('../Project/helpers/taskOpenProjectId');

// Company-wide search across tasks, projects and comments. Regex-based so it
// works on every existing tenant database immediately (the text indexes added
// in createSchema speed up future $text adoption, but regex keeps behaviour
// predictable for short queries and substring matches).

/* POST /api/v2/search  body: { query } */
exports.globalSearch = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { query } = req.body || {};
        const check = validateSearchInput({ companyId, query });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const rx = { $regex: escapeRegex(String(query).trim()), $options: 'i' };

        const [tasks, projects, comments] = await Promise.all([
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [
                    { deletedStatusKey: { $ne: 1 }, $or: [{ TaskName: rx }, { TaskKey: rx }] },
                    'TaskName TaskKey status statusType ProjectID sprintId folderObjId deletedStatusKey',
                    { limit: RESULT_LIMIT_PER_TYPE, sort: { updatedAt: -1 } },
                ],
            }, 'find'),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [
                    { deletedStatusKey: { $in: [0, undefined] }, ProjectName: rx },
                    'ProjectName',
                    { limit: RESULT_LIMIT_PER_TYPE, sort: { updatedAt: -1 } },
                ],
            }, 'find'),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.COMMENTS,
                data: [
                    { isDeleted: { $ne: true }, type: { $in: ['text', 'link'] }, message: rx },
                    'message taskId projectId sprintId',
                    { limit: RESULT_LIMIT_PER_TYPE, sort: { createdAt: -1 } },
                ],
            }, 'find'),
        ]);

        // Client project routes always carry a sprint segment, so attach each
        // project's first active sprint (the sprint the sidebar lands on).
        let projectResults = projects || [];
        if (projectResults.length) {
            const sprints = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.SPRINTS,
                data: [
                    {
                        projectId: { $in: projectResults.map((project) => project._id) },
                        deletedStatusKey: 0,
                        private: { $ne: true },
                    },
                    'projectId folderId',
                    { sort: { _id: 1 } },
                ],
            }, 'find');
            const firstSprintByProject = {};
            (sprints || []).forEach((sprint) => {
                const key = String(sprint.projectId);
                if (!firstSprintByProject[key]) firstSprintByProject[key] = sprint;
            });
            projectResults = projectResults.map((project) => {
                const sprint = firstSprintByProject[String(project._id)];
                return {
                    _id: project._id,
                    ProjectName: project.ProjectName,
                    sprintId: sprint ? sprint._id : null,
                    folderId: sprint && sprint.folderId ? sprint.folderId : null,
                };
            });
        }

        return res.send({
            status: true,
            statusText: 'Search complete.',
            data: {
                tasks: (tasks || []).map(shapeOpenTaskHit).filter(Boolean),
                projects: projectResults,
                comments: (comments || []).map((comment) => ({
                    _id: comment._id,
                    message: truncate(comment.message),
                    taskId: comment.taskId,
                    projectId: comment.projectId,
                    sprintId: comment.sprintId,
                })),
            },
        });
    } catch (error) {
        logger.error(`ERROR in global search: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
