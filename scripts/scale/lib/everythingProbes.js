const { performance } = require('perf_hooks');
const { summarise } = require('./stats');
const { summarisePlan, planText } = require('./explain');
/* The requests are built by the page's own request builder, so what is timed is what the page sends. */
const page = require('../../../frontend/src/views/Everything/everythingRequest');
const server = require('../../../Modules/Tasks/helpers/everythingQuery');

const ENDPOINT = '/api/v2/tasks/everything';
const WARM_UP_RUNS = 2;
const PAUSE_MS = 50;
const SEARCH_TEXT = 'login';
// No seeded task name holds it, so the server has to look at every task the person can see before it can say so.
const SEARCH_MISS = 'zzqxv';
const MAX_PAGES = 80;
const GROUP_KINDS = ['status', 'assignee', 'project', 'dueDate'];

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const kilobytes = (bytes) => `${Math.round(bytes / 102.4) / 10} kB`;
const titled = (kind) => kind.charAt(0).toUpperCase() + kind.slice(1);

/* Each case is one request the page makes. Done work is shown unless the case is about hiding it, so
 * "no filter" reads every task the person can see. */
function everythingCases({ assignee, viewer }) {
    const settings = (over = {}) => ({ ...page.DEFAULT_SETTINGS, hideDone: false, ...over });
    const first = (over) => page.firstRequest(settings(over), viewer);
    return [
        { key: 'api.everythingFirstPage', label: `Everything API: first page, no filter, newest first (${page.PAGE_SIZE} rows and the total)`, request: first() },
        ...GROUP_KINDS.map((kind) => ({
            key: `api.everythingGroup${titled(kind)}`,
            label: `Everything API: counts by ${kind === 'dueDate' ? 'due date' : kind} (what opening a grouped view sends first)`,
            request: first({ group: kind }),
        })),
        { key: 'api.everythingFilterAssignee', label: 'Everything API: first page filtered by one assignee', request: first({ assignee: [assignee] }) },
        { key: 'api.everythingHideDone', label: 'Everything API: first page with done work hidden (the page\'s default)', request: first({ hideDone: true }) },
        { key: 'api.everythingSearch', label: `Everything API: first page searching task names for "${SEARCH_TEXT}"`, request: first({ search: SEARCH_TEXT }) },
        { key: 'api.everythingSearchMiss', label: 'Everything API: a search that matches nothing (every task is read)', request: first({ search: SEARCH_MISS }) },
        { key: 'api.everythingSortDue', label: 'Everything API: first page sorted by due date, soonest first', request: first({ sortBy: 'DueDate', sortDir: 'asc' }) },
        { key: 'api.everythingSubtasks', label: 'Everything API: first page with subtasks shown', request: first({ showSubtasks: true }) },
    ];
}

/* The group a paging run walks to its end: the largest, so the last pages sit as deep as the data allows. */
function largestGroup(counts, viewer) {
    const settings = { ...page.DEFAULT_SETTINGS, hideDone: false, group: 'status' };
    const groups = page.groupsFrom(counts, settings, viewer);
    if (!groups.length) return null;
    const group = groups.reduce((largest, candidate) => (candidate.count > largest.count ? candidate : largest));
    return { group, base: page.baseRequest(settings, viewer) };
}

const plansText = (plans) => {
    if (!plans) return '';
    const parts = [`rows: ${planText(plans.rows)}`];
    if (plans.counts) parts.push(`counts: ${planText(plans.counts, { sorted: false })}`);
    return `; ${parts.join('; ')}`;
};

const detailOf = ({ rows, bytes, groups }, plans) => {
    const counted = Array.isArray(groups) ? `, ${groups.length} ${groups.length === 1 ? 'count' : 'counts'}` : '';
    return `${rows} ${rows === 1 ? 'row' : 'rows'}${counted}, ${kilobytes(bytes)}${plansText(plans)}`;
};

/* A read-only look at how MongoDB runs the pipelines the server builds for a request: the same builder the handler
 * uses, over the projects the session's owner can open. Nothing is written; explain runs the query and reports. */
async function everythingExplainer({ session }) {
    const { handleConnection } = require('../../../middlewares/mongoConnector/mongoConnection');
    const { tableType } = require('../../../utils/mongo-handler/mongoQueries');
    const { SCHEMA_TYPE } = require('../../../Config/schemaType');

    const { database } = await handleConnection(session.companyId);
    const tasks = database.collection(tableType(SCHEMA_TYPE.TASKS));
    const projects = database.collection(tableType(SCHEMA_TYPE.PROJECTS));
    const everyId = (await projects.find({}, { projection: { _id: 1 } }).toArray()).map((project) => String(project._id));
    const scopes = new Map();
    const projectIdsFor = async (includeClosed) => {
        if (!scopes.has(includeClosed)) {
            const open = await projects.find(server.projectMatch(everyId, session.userId, includeClosed), { projection: { _id: 1 } }).toArray();
            scopes.set(includeClosed, open.map((project) => project._id));
        }
        return scopes.get(includeClosed);
    };
    const run = async (pipeline) => summarisePlan(await tasks.aggregate(pipeline).explain('executionStats'));

    const explain = async (body, lastRow = null) => {
        const { cursor, ...withoutCursor } = body;
        const request = server.parseRequest(withoutCursor);
        const match = server.buildMatch(request, { projectIds: await projectIdsFor(request.includeClosedProjects), hiddenSprintIds: [] });
        const after = lastRow ? { value: Date.parse(lastRow[request.sort.by]), id: String(lastRow._id) } : null;
        const rows = await run(server.pagePipeline(match, request.sort, { segment: 'dated', after, limit: request.limit + 1 }));
        return { rows, counts: cursor || lastRow ? null : await run(server.groupPipeline(match, request)) };
    };
    explain.projects = async () => (await projectIdsFor(false)).length;
    return explain;
}

async function measureEverything({ base, session, runs, room, call, explain = null, log = () => {}, pause = () => sleep(PAUSE_MS), viewer }) {
    const post = (body) => call('POST', ENDPOINT, body);
    const settled = async (body) => {
        const answer = await post(body);
        await pause();
        return answer;
    };
    const metrics = [];
    const record = (metric) => {
        metrics.push(metric);
        log(`${metric.label}: median ${metric.median} ms, p95 ${metric.p95} ms, ${metric.detail}`);
    };

    await room(WARM_UP_RUNS + runs);
    const opening = await settled(page.firstRequest({ ...page.DEFAULT_SETTINGS, hideDone: false }, viewer)).catch((error) => {
        if (/answered 404/.test(String(error.message))) throw new Error(`The server at ${base} has no ${ENDPOINT}: its build is older than the Everything view.`);
        throw error;
    });
    const assignee = (opening.json.data.rows.find((row) => (row.AssigneeUserId || []).length) || { AssigneeUserId: [session.userId] }).AssigneeUserId[0];

    for (const probe of everythingCases({ assignee, viewer })) {
        const samples = [];
        let last;
        await room(WARM_UP_RUNS + runs);
        for (let n = 0; n < WARM_UP_RUNS + runs; n += 1) {
            last = await settled(probe.request);
            if (n >= WARM_UP_RUNS) samples.push(last.ms);
        }
        const { rows, groups } = last.json.data;
        const plans = explain ? await explain(probe.request) : null;
        record({
            key: probe.key, label: probe.label, unit: 'ms', ...summarise(samples), bytes: last.bytes, rows: rows.length, plans,
            detail: detailOf({ rows: rows.length, bytes: last.bytes, groups }, plans),
        });
    }

    const counts = await settled(page.firstRequest({ ...page.DEFAULT_SETTINGS, hideDone: false, group: 'status' }, viewer));
    const walk = largestGroup(counts.json.data.groups, viewer);
    if (walk) {
        const samples = [];
        const seen = new Set();
        let cursor = null;
        let lastRow = null;
        let pages = 0;
        let fetched = 0;
        await room(MAX_PAGES);
        do {
            const answer = await settled(page.groupRequest(walk.base, walk.group.filter, { cursor }));
            const { rows, nextCursor } = answer.json.data;
            samples.push(answer.ms);
            rows.forEach((row) => seen.add(String(row._id)));
            fetched += rows.length;
            pages += 1;
            if (nextCursor) lastRow = rows[rows.length - 1];
            cursor = nextCursor;
        } while (cursor && pages < MAX_PAGES);
        const plans = explain && lastRow ? await explain(page.groupRequest(walk.base, walk.group.filter), lastRow) : null;
        const reachedEnd = !cursor;
        record({
            key: 'api.everythingPageThrough', label: `Everything API: paging through one status group by cursor (${page.PAGE_SIZE} rows a page), time per page`,
            unit: 'ms', ...summarise(samples), rows: fetched, plans,
            detail: `${pages} pages, ${fetched} rows of ${walk.group.count} in "${walk.group.key}", ${seen.size === fetched ? 'each row once' : `${fetched - seen.size} rows repeated`}`
                + `${reachedEnd ? '' : `, stopped at ${MAX_PAGES} pages`}; first page ${Math.round(samples[0] * 10) / 10} ms, last page ${Math.round(samples[samples.length - 1] * 10) / 10} ms`
                + `${plans ? `; last page ${planText(plans.rows)}` : ''}`,
        });
    }

    const total = opening.json.data.groups[0].count;
    const inProject = await settled({ ...page.firstRequest({ ...page.DEFAULT_SETTINGS, hideDone: false, projectIds: [String(session.project._id)] }, viewer), limit: 1 });
    const withSubtasks = await settled({ ...page.firstRequest({ ...page.DEFAULT_SETTINGS, hideDone: false, showSubtasks: true }, viewer), limit: 1 });
    return {
        metrics,
        size: {
            tasks: inProject.json.data.groups[0].count,
            everythingTasks: total,
            everythingSubtasks: withSubtasks.json.data.groups[0].count - total,
            projects: explain ? await explain.projects() : null,
        },
    };
}

module.exports = { ENDPOINT, everythingCases, largestGroup, detailOf, everythingExplainer, measureEverything };
