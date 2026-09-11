const mongoose = require("mongoose");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const logger = require("../../Config/loggerConfig");
const { escapeRegex } = require("../../utils/escapeRegex");
const { getRoleType, isPrivileged } = require("../../Config/permissionGuard");
const { visibleProjectIds } = require("../Agents/scope");
const { pageVisibilityFilter } = require("../Pages/helpers/pageRules");
const { validateSearchInput, truncate, RESULT_LIMIT_PER_TYPE } = require('./helpers/searchRules');

// Regex rather than $text: it works on every existing tenant database and keeps
// short queries and substring matches predictable.

const asObjectIds = (ids) => ids
    .map(String)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

/* Private sprints hide their tasks and comments from everyone not assigned to them, as the sidebar does. */
const hiddenSprintIds = async (companyId, uid, projectIds, privileged) => {
    if (privileged || !projectIds.length) return [];
    const sprints = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ projectId: { $in: projectIds }, private: true }, 'AssigneeUserId'],
    }, 'find');
    return (sprints || [])
        .filter((sprint) => !(sprint.AssigneeUserId || []).map(String).includes(uid))
        .map((sprint) => sprint._id);
};

/* A task comment is visible where its task is, whatever project id the comment row carries. */
const onVisibleTasks = async (companyId, comments, projectIds, sprintClause) => {
    const taskIds = asObjectIds([...new Set(comments.map((comment) => comment.taskId).filter(Boolean).map(String))]);
    if (!taskIds.length) return comments.filter((comment) => !comment.taskId);
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: taskIds }, ProjectID: { $in: projectIds }, ...sprintClause }, '_id'],
    }, 'find');
    const visible = new Set((tasks || []).map((task) => String(task._id)));
    return comments.filter((comment) => !comment.taskId || visible.has(String(comment.taskId)));
};

/* POST /api/v2/search  body: { query } */
exports.globalSearch = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const uid = String(req.uid || '');
        const { query } = req.body || {};
        const check = validateSearchInput({ companyId, query });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const roleType = await getRoleType(companyId, uid);
        if (roleType === null) {
            return res.status(403).send({ status: false, statusText: 'You are not a member of this company.' });
        }
        const projectIds = asObjectIds(await visibleProjectIds(companyId, uid));
        const hidden = await hiddenSprintIds(companyId, uid, projectIds, isPrivileged(roleType));
        const sprintClause = hidden.length ? { sprintId: { $nin: hidden } } : {};

        const rx = { $regex: escapeRegex(String(query).trim()), $options: 'i' };

        const [tasks, projects, comments, pages] = await Promise.all([
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [
                    { ProjectID: { $in: projectIds }, ...sprintClause, deletedStatusKey: { $ne: 1 }, $or: [{ TaskName: rx }, { TaskKey: rx }] },
                    'TaskName TaskKey status statusType ProjectID sprintId folderObjId deletedStatusKey',
                    { limit: RESULT_LIMIT_PER_TYPE, sort: { updatedAt: -1 } },
                ],
            }, 'find'),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [
                    { _id: { $in: projectIds }, deletedStatusKey: { $in: [0, undefined] }, ProjectName: rx },
                    'ProjectName',
                    { limit: RESULT_LIMIT_PER_TYPE, sort: { updatedAt: -1 } },
                ],
            }, 'find'),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.COMMENTS,
                data: [
                    { projectId: { $in: projectIds }, ...sprintClause, isDeleted: { $ne: true }, type: { $in: ['text', 'link'] }, message: rx },
                    'message taskId projectId sprintId',
                    { limit: RESULT_LIMIT_PER_TYPE, sort: { createdAt: -1 } },
                ],
            }, 'find'),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PAGES,
                data: [
                    {
                        deletedStatusKey: { $ne: 1 },
                        title: rx,
                        $and: [
                            { $or: [{ ProjectID: { $in: projectIds } }, { ProjectID: { $in: [null, undefined] } }] },
                            pageVisibilityFilter(uid),
                        ],
                    },
                    'title ProjectID updatedBy updatedAt',
                    { limit: RESULT_LIMIT_PER_TYPE, sort: { updatedAt: -1 } },
                ],
            }, 'find').catch(() => []),
        ]);
        const visibleComments = await onVisibleTasks(companyId, comments || [], projectIds, sprintClause);

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
                tasks: tasks || [],
                projects: projectResults,
                comments: visibleComments.map((comment) => ({
                    _id: comment._id,
                    message: truncate(comment.message),
                    taskId: comment.taskId,
                    projectId: comment.projectId,
                    sprintId: comment.sprintId,
                })),
                pages: (pages || []).map((page) => ({
                    _id: page._id,
                    title: page.title,
                    ProjectID: page.ProjectID,
                    updatedBy: page.updatedBy,
                    updatedAt: page.updatedAt,
                })),
            },
        });
    } catch (error) {
        logger.error(`ERROR in global search: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
