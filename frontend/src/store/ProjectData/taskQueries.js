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

/* One facet per group over the same match a page uses, so a count is the number of rows its pages will bring. */
const groupCountsQuery = ({ pid, sprintId, items, showAllTasks, userId }) => [
    { $match: { ...sprintTaskMatch({ pid, sprintId, showAllTasks, userId }), isParentTask: true } },
    { $facet: Object.fromEntries((items || []).map((item, index) => [`g${index}`, [{ $match: groupCondition(item) }, { $count: "count" }]])) },
];

const readGroupCounts = (items, facets) => Object.fromEntries(
    (items || []).map((item, index) => [countKey(item), Number(facets?.[`g${index}`]?.[0]?.count) || 0])
);

module.exports = { groupCondition, sprintTaskMatch, groupCountsQuery, readGroupCounts };
