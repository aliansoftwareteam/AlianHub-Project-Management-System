const { mongoose } = require("mongoose");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { QueryRefused, validatePipeline, visibilityStage, matchWithExtraListRows } = require("../helpers/taskQueryGuard");
const { opensList } = require("../helpers/taskExtraLists");

const LEAVE_PROJECT_ID = "6571e7195470e64b1203295c";

const firstOf = (list) => (Array.isArray(list) && list.length ? list[0] : null);

/* The group the client is refreshing, as it sent it. It joins the list's own clauses under $and,
 * so a key it names can narrow the list and never replace the project or sprint. */
const groupConditions = (body) => {
    const item = body.item || {};
    const conditions = firstOf(item.mongoConditions) || firstOf(item.conditions) || {};
    validatePipeline([{ $match: conditions }]);
    return conditions;
};

const ownTasksOnly = (body) => !(body.showAllTasks === undefined || body.showAllTasks === true || body.showAllTasks === 2);

/* `inList` widens the list to the tasks added to it, as the task query does for a caller who can
 * look at the list. Subtasks are read where their parent lives, so their match is left as it is. */
const listMatch = (body, conditions, { changedOnly, inList }) => {
    const inParent = Boolean(body.parentId && body.parentId.length);
    const rows = (match) => (inList && !inParent ? matchWithExtraListRows(match, body.sprintId) : match);
    return rows({
        $and: [
            {
                ProjectID: new mongoose.Types.ObjectId(body.pid),
                sprintId: new mongoose.Types.ObjectId(body.sprintId),
                ...(changedOnly ? { updatedAt: { $gte: new Date(Number(body.tabLeaveTime)) } } : {}),
                deletedStatusKey: 0,
                ...(ownTasksOnly(body) ? { AssigneeUserId: { $in: [body.userId] } } : {}),
                ...(inParent ? { ParentTaskId: body.parentId } : { isParentTask: true }),
            },
            inParent ? {} : conditions,
        ],
    });
};

const listPipeline = (body, conditions, inList) => {
    const indexName = body.indexName || body.item.indexName;
    return [{
        $facet: {
            result: [
                { $match: listMatch(body, conditions, { changedOnly: true, inList }) },
                { $sort: { [indexName]: 1, createdAt: 1, _id: 1 } },
                { $skip: 0 },
            ],
            count: [
                { $match: listMatch(body, conditions, { changedOnly: false, inList }) },
                { $count: "count" },
            ],
        },
    }];
};

const tableSort = (body) => {
    if (body.sortKey) {
        const [field, direction] = body.sortKey.split(':');
        return { [field]: Number(direction), _id: 1 };
    }
    return body.item?.indexName ? { [body.item.indexName]: 1 } : { createdAt: 1 };
};

const tablePipeline = (body, conditions, inList) => [
    {
        $match: (inList ? matchWithExtraListRows : (match) => match)({
            $and: [
                {
                    ProjectID: new mongoose.Types.ObjectId(body.pid),
                    sprintId: new mongoose.Types.ObjectId(body.sprintId),
                    // A task written before the soft-delete field existed has none and is still active.
                    deletedStatusKey: { $in: [0, undefined] },
                    updatedAt: { $gte: new Date(Number(body.tabLeaveTime)) },
                },
                conditions,
                body.showAllTasks !== undefined && !body.showAllTasks ? { AssigneeUserId: { $in: [body.userId] } } : {},
                body.pid === LEAVE_PROJECT_ID ? { AssigneeUserId: { $in: [body.userId] } } : {},
            ],
        }, body.sprintId),
    },
    { $sort: tableSort(body) },
];

/* The list refreshed after a tab comes back, read through the same scope as the task query: the
 * projects the caller may list tasks in, less the sprints hidden from them. */
exports.getTabSyncTasks = async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.pid) {
            return res.status(400).json({ message: 'pid is required' });
        }
        if (!body.sprintId) {
            return res.status(400).json({ message: 'Project ID is required' });
        }
        if (body.istableTask === undefined) {
            return res.status(400).json({ message: 'istableTask ID is required' });
        }
        const companyId = req.headers['companyid'];
        const conditions = groupConditions(body);
        const scope = await visibilityStage(companyId, req.uid);
        const inList = await opensList(companyId, req.uid, String(body.sprintId));
        const pipeline = body.istableTask === false ? listPipeline(body, conditions, inList) : tablePipeline(body, conditions, inList);

        const result = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [[scope, ...pipeline]] }, 'aggregate');
        return res.status(200).json(result);
    } catch (error) {
        if (error instanceof QueryRefused) {
            return res.status(400).json({ message: error.message, stage: error.stage });
        }
        return res.status(400).json({ message: error.message });
    }
};
