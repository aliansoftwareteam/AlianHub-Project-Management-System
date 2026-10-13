/* The pieces of the task queries the List sends to /api/v1/task/find. CommonJS, like
 * ListView/subtaskProgress.js, so tests/list-group-counts-query.test.js can run them through
 * the server's query guard. */

const groupCondition = (item) => {
    if (item?.mongoConditions?.length) return { ...item.mongoConditions[0] };
    return item?.conditions?.length ? { ...item.conditions[0] } : {};
};

const seesEveryTask = (showAllTasks) => showAllTasks === undefined || showAllTasks === true || showAllTasks === 2;

const sprintTaskMatch = ({ pid, sprintId, showAllTasks, userId }) => ({
    objId: { sprintId, ProjectID: pid },
    deletedStatusKey: 0,
    ...(seesEveryTask(showAllTasks) ? {} : { AssigneeUserId: { $in: [userId] } }),
});

const countKey = (item) => `${item.searchKey}_${item.searchValue}`;

const totalKey = (index) => `t${index}`;

/* A total is { id, path, wrapped, taskTypes }: a custom field keeps its value under fieldValue, and on a few old tasks as the
   entry itself. What is not a number (a blank, text) reads as null, which $sum passes over. */
const totalValue = ({ path, wrapped, taskTypes }) => {
    const stored = wrapped ? { $ifNull: [`$${path}.fieldValue`, `$${path}`] } : `$${path}`;
    const number = { $convert: { input: stored, to: 'double', onError: null, onNull: null } };
    if (!taskTypes?.length) return number;
    return { $cond: [{ $in: ['$TaskTypeKey', [...taskTypes, ...taskTypes.map(String)]] }, number, null] };
};

/* One facet per group over the same match a page uses, so a count is the number of rows its pages will bring,
   and a total is the sum over those same rows. */
const groupCountsQuery = ({ pid, sprintId, items, showAllTasks, userId, totals = [] }) => {
    const counted = totals.length
        ? [{ $group: { _id: null, count: { $sum: 1 }, ...Object.fromEntries(totals.map((total, index) => [totalKey(index), { $sum: `$${totalKey(index)}` }])) } }]
        : [{ $count: "count" }];
    return [
        { $match: { ...sprintTaskMatch({ pid, sprintId, showAllTasks, userId }), isParentTask: true } },
        ...(totals.length ? [{ $addFields: Object.fromEntries(totals.map((total, index) => [totalKey(index), totalValue(total)])) }] : []),
        { $facet: Object.fromEntries((items || []).map((item, index) => [`g${index}`, [{ $match: groupCondition(item) }, ...counted]])) },
    ];
};

const readGroupCounts = (items, facets) => Object.fromEntries(
    (items || []).map((item, index) => [countKey(item), Number(facets?.[`g${index}`]?.[0]?.count) || 0])
);

const readGroupTotals = (items, facets, totals) => Object.fromEntries(
    (items || []).map((item, index) => [countKey(item), Object.fromEntries(
        (totals || []).map((total, at) => [total.id, Number(facets?.[`g${index}`]?.[0]?.[totalKey(at)]) || 0])
    )])
);

const IN_TRASH = 1;

/* An archived list keeps its tasks under more than one key (archived with it, archived before it), so every
   task of it that is not in the trash counts. The server adds what the asker may open. */
const listTaskCountsQuery = ({ pid, sprintIds, showAllTasks, userId }) => [
    {
        $match: {
            objId: { ProjectID: pid },
            sprintId: { objId: { $in: sprintIds } },
            deletedStatusKey: { $ne: IN_TRASH },
            ...(seesEveryTask(showAllTasks) ? {} : { AssigneeUserId: { $in: [userId] } }),
        },
    },
    { $group: { _id: '$sprintId', count: { $sum: 1 } } },
];

const readListTaskCounts = (sprintIds, rows) => Object.fromEntries(
    (sprintIds || []).map((id) => [id, Number((rows || []).find((row) => String(row._id) === String(id))?.count) || 0])
);

module.exports = { groupCondition, sprintTaskMatch, groupCountsQuery, readGroupCounts, readGroupTotals, listTaskCountsQuery, readListTaskCounts };
