const { performance } = require('perf_hooks');
const { summarise } = require('./stats');
const { goalProbes } = require('./goalProbes');

const PAGE_SIZE = 35;
const WARM_UP_RUNS = 2;
const SEARCH_TEXT = 'login';

const client = ({ base, token, companyId }) => async (method, path, body) => {
    const started = performance.now();
    const response = await fetch(`${base}${path}`, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, companyid: companyId },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const ms = performance.now() - started;
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}.`);
    return { ms, bytes: Buffer.byteLength(text), json: JSON.parse(text) };
};

/* The pipelines are the ones frontend/src/store/ProjectData/actions.js sends to POST /api/v1/task/find:
 * getPaginatedTasks for a status group, searchTask for a filter or a search, and the List's subtask progress. */
const groupPage = ({ projectId, sprintId, statusKey }) => [
    { $match: { objId: { sprintId, ProjectID: projectId }, deletedStatusKey: 0, isParentTask: true, statusKey: { $eq: statusKey } } },
    { $sort: { groupByStatusIndex: 1, createdAt: 1, _id: 1 } },
    { $facet: { result: [{ $skip: 0 }, { $limit: PAGE_SIZE }], count: [{ $count: 'count' }] } },
];

const wholeProject = (projectId, condition) => [{
    $match: { $and: [{ $and: [{ ProjectID: { objId: { $in: [projectId] } } }, { deletedStatusKey: { $in: [0] } }] }, condition] },
}];

const subtaskProgress = (parentIds) => [
    { $match: { ParentTaskId: { $in: parentIds }, deletedStatusKey: { $in: [0, null] } } },
    { $group: { _id: '$ParentTaskId', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$statusType', 'close'] }, 1, 0] } } } },
];

const statusCounts = (projectId) => [
    { $match: { objId: { ProjectID: projectId }, deletedStatusKey: 0, isParentTask: true } },
    { $group: { _id: '$statusKey', count: { $sum: 1 } } },
];

const rowsOf = (json) => {
    if (Array.isArray(json) && json[0] && Array.isArray(json[0].result)) return json[0].result.length;
    if (Array.isArray(json)) return json.length;
    const data = json && json.data;
    if (Array.isArray(data)) return data.length;
    return data && typeof data === 'object' ? Object.values(data).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0) : 0;
};

const kilobytes = (bytes) => `${Math.round(bytes / 102.4) / 10} kB`;

async function measureApi({ base, session, runs, room, log = () => {} }) {
    const call = client({ base, token: session.accessToken, companyId: session.companyId });
    const find = (pipeline) => call('POST', '/api/v1/task/find', { findQuery: pipeline });
    const projectId = session.project._id;
    const statuses = session.project.taskStatusData;
    const list = session.lists.reduce((largest, candidate) => ((candidate.tasks || 0) > (largest.tasks || 0) ? candidate : largest));
    const group = (status) => groupPage({ projectId, sprintId: list._id, statusKey: status.key });
    const firstStatus = statuses.find((status) => status.type === 'default_active') || statuses[0];

    await room(statuses.length * (WARM_UP_RUNS + runs));
    const firstPage = await find(group(firstStatus));
    const parentIds = firstPage.json[0].result.map((task) => task._id);
    const assignee = (firstPage.json[0].result.find((task) => (task.AssigneeUserId || []).length) || { AssigneeUserId: [session.userId] }).AssigneeUserId[0];

    const probes = [
        { key: 'api.listFirstPage', label: `API: List first page (one status group, ${PAGE_SIZE} rows)`, run: () => find(group(firstStatus)) },
        {
            key: 'api.listOpen',
            label: `API: List or Board open (all ${statuses.length} status groups of one list, in parallel)`,
            requests: statuses.length,
            run: async () => {
                const started = performance.now();
                const answers = await Promise.all(statuses.map((status) => find(group(status))));
                return { ms: performance.now() - started, bytes: answers.reduce((sum, answer) => sum + answer.bytes, 0), rows: answers.reduce((sum, answer) => sum + rowsOf(answer.json), 0) };
            },
        },
        { key: 'api.filterAssignee', label: 'API: Filter by one assignee (whole project, not paged)', run: () => find(wholeProject(projectId, { AssigneeUserId: { $in: [assignee] } })) },
        { key: 'api.filterPriority', label: 'API: Filter by priority High (whole project, not paged)', run: () => find(wholeProject(projectId, { $and: [{ Task_Priority: { $in: ['HIGH'] } }] })) },
        { key: 'api.searchInProject', label: `API: Search task names in the project for "${SEARCH_TEXT}" (not paged)`, run: () => find(wholeProject(projectId, { $or: [{ TaskName: { $regex: SEARCH_TEXT, $options: 'i' } }] })) },
        { key: 'api.subtaskProgress', label: 'API: Grouped query the List sends (subtask progress for one page)', run: () => find(subtaskProgress(parentIds)) },
        { key: 'api.statusCounts', label: 'API: Grouped query, tasks per status (whole project; the web app does not send it)', run: () => find(statusCounts(projectId)) },
        { key: 'api.projects', label: 'API: Project load (project list, cached by the server after the first call)', run: () => call('GET', '/api/v1/project') },
        { key: 'api.lists', label: 'API: Project load (lists of the project)', run: () => call('GET', `/api/v1/project/sprintFolder/${projectId}?collection=sprints`) },
        { key: 'api.search', label: `API: Global search for "${SEARCH_TEXT}"`, run: () => call('POST', '/api/v2/search', { query: SEARCH_TEXT }) },
    ];
    await room(2);
    probes.push(...await goalProbes({ call, lists: session.lists, log }));

    const metrics = [];
    for (const probe of probes) {
        const samples = [];
        let last;
        await room((probe.requests || 1) * (WARM_UP_RUNS + runs));
        for (let n = 0; n < WARM_UP_RUNS + runs; n += 1) {
            last = await probe.run();
            if (n >= WARM_UP_RUNS) samples.push(last.ms);
        }
        const rows = last.rows === undefined ? rowsOf(last.json) : last.rows;
        const metric = { key: probe.key, label: probe.label, unit: 'ms', ...summarise(samples), bytes: last.bytes, rows, detail: `${rows} ${rows === 1 ? 'row' : 'rows'}, ${kilobytes(last.bytes)}` };
        metrics.push(metric);
        log(`${probe.label}: median ${metric.median} ms, p95 ${metric.p95} ms, ${metric.detail}`);
    }

    const total = await find([{ $match: { objId: { ProjectID: projectId }, deletedStatusKey: 0 } }, { $group: { _id: '$isParentTask', count: { $sum: 1 } } }]);
    const countOf = (isParent) => (total.json.find((row) => row._id === isParent) || { count: 0 }).count;
    return { metrics, size: { tasks: countOf(true), subtasks: countOf(false), list: { id: list._id, name: list.name, tasks: list.tasks } } };
}

module.exports = { client, measureApi, groupPage, wholeProject, subtaskProgress };
