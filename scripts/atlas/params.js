const { decide } = require('./readOnly');
const { newBudget, noteBudget, roomToLoad, sleep } = require('./pace');

const LOOKUP_ATTEMPTS = 3;

/* The script's own lookups go through the same filter as the browser's requests,
 * so it cannot write either. */
function createReader({ baseUrl, token, companyId = null, fetchImpl = fetch, budget = newBudget(), pause = sleep }) {
    return async function read(method, urlPath, body) {
        const url = `${baseUrl}${urlPath}`;
        const verdict = decide({ method, url, body }, { baseUrl });
        if (!verdict.allow) throw new Error(`Refused: ${verdict.reason}`);
        const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
        if (companyId) headers.companyid = companyId;
        if (body !== undefined) headers['content-type'] = 'application/json';
        for (let attempt = 1; ; attempt += 1) {
            const response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
            if (response.headers) noteBudget(budget, Object.fromEntries(response.headers));
            if (response.ok) return response.json();
            if (response.status !== 429 || attempt >= LOOKUP_ATTEMPTS) throw new Error(`${method} ${urlPath} answered ${response.status}`);
            await roomToLoad(budget, { reserve: Infinity, pause });
        }
    };
}

const rows = (body) => (Array.isArray(body) ? body : (body && Array.isArray(body.data) ? body.data : []));

const oldestFirst = (a, b) => String(a._id).localeCompare(String(b._id));

function pickProject(projects, hint = null) {
    const open = projects.filter((project) => !project.deletedStatusKey);
    if (hint) {
        const wanted = hint.toLowerCase();
        const hit = open.find((project) => [project._id, project.ProjectCode, project.ProjectName].some((value) => String(value || '').toLowerCase() === wanted));
        if (!hit) throw new Error(`No project matches --project "${hint}". Pass its id, key or name.`);
        return hit;
    }
    const views = (project) => (project.ProjectRequiredComponent || []).length;
    return [...open].sort((a, b) => views(b) - views(a) || oldestFirst(a, b))[0] || null;
}

async function resolveCompany({ baseUrl, token, uid, hint, fetchImpl, budget }) {
    if (hint) return hint;
    const user = await createReader({ baseUrl, token, fetchImpl, budget })('GET', `/api/v1/user/${uid}`);
    const companies = (user && user.AssignCompany) || [];
    if (companies.length === 1) return String(companies[0]);
    throw new Error(companies.length ? 'This account belongs to several workspaces. Pass --company <companyId>.' : 'This account belongs to no workspace.');
}

const firstId = async (read, urlPath) => {
    const [first] = rows(await read('GET', urlPath)).filter((row) => !row.deletedStatusKey).sort(oldestFirst);
    return first ? String(first._id) : null;
};

const LOOKUPS = {
    async projectId({ read, projectHint }) {
        const project = pickProject(rows(await read('GET', '/api/v1/project')), projectHint);
        return project ? { projectId: String(project._id) } : {};
    },
    async taskId({ read, params }) {
        if (!params.projectId) return {};
        const [task] = rows(await read('POST', '/api/v1/task/find', {
            findQuery: [
                { $match: { objId: { ProjectID: params.projectId }, deletedStatusKey: { $nin: [1, 2] } } },
                { $sort: { createdAt: 1, _id: 1 } },
                { $limit: 1 },
                { $project: { _id: 1, sprintId: 1 } },
            ],
        }));
        return task && task.sprintId ? { taskId: String(task._id), sprintId: String(task.sprintId) } : {};
    },
    async pageId({ read }) {
        const pageId = await firstId(read, '/api/v2/pages');
        return pageId ? { pageId } : {};
    },
    async dashboardId({ read }) {
        const dashboardId = await firstId(read, '/api/v1/dashboards');
        return dashboardId ? { dashboardId } : {};
    },
    async agentId({ read }) {
        const agentId = await firstId(read, '/api/v2/agents');
        return agentId ? { agentId } : {};
    },
};
LOOKUPS.sprintId = LOOKUPS.taskId;

const ORDER = ['projectId', 'taskId', 'sprintId', 'pageId', 'dashboardId', 'agentId'];

async function resolveParams({ baseUrl, token, uid, wanted, companyHint = null, projectHint = null, fetchImpl = fetch, budget = newBudget() }) {
    const cid = await resolveCompany({ baseUrl, token, uid, hint: companyHint, fetchImpl, budget });
    const read = createReader({ baseUrl, token, companyId: cid, fetchImpl, budget });
    const params = { cid };
    const problems = {};
    for (const name of ORDER.filter((candidate) => wanted.includes(candidate))) {
        if (params[name]) continue;
        try {
            Object.assign(params, await LOOKUPS[name]({ read, params, projectHint }));
        } catch (error) {
            problems[name] = error.message;
        }
    }
    return { params, problems };
}

module.exports = { createReader, pickProject, resolveParams };
