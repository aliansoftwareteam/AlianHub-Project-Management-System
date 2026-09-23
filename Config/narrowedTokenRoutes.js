const { isNarrowed, runNarrowed } = require('./tokenNarrowing');
const logger = require('./loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PROJECT_KEY = /^Project\/([a-f0-9]{24})\//i;

const ROUTE_REFUSED = 'This token is limited to some projects, and this route cannot hold it to them. Use a token that is not limited to projects, or the MCP tools.';
const PROJECT_REFUSED = 'Project not found.';

const projectOfKey = (key) => {
    const match = typeof key === 'string' ? PROJECT_KEY.exec(key) : null;
    return match ? match[1] : null;
};

/* Deny by default: most handlers compute their own project scope and never see the token's list.
 * A route listed here either reads through the checks that honour it (Modules/Agents/scope,
 * Config/projectAccess, the task visibility stage) or names its project in `projects`, checked here. */
const HELD_ROUTES = [
    { methods: ['GET'], path: /^\/api\/v2\/api-tokens\/me\/?$/i },
    { methods: ['GET'], path: /^\/api\/v1\/task\/[a-f0-9]{24}\/?$/i },
    { methods: ['POST'], path: /^\/api\/v1\/task\/find\/?$/i },
    { methods: ['GET'], path: /^\/api\/v1\/project\/[a-f0-9]{24}\/?$/i },
    { methods: ['GET'], path: /^\/api\/v1\/comments\/get-paginated-messages\/?$/i, projects: (req) => [req.query && req.query.projectId] },
    { methods: ['GET'], path: /^\/api\/v1\/generateSignedUrl\/[^/]+\/?$/i, projects: (req) => [projectOfKey(req.query && req.query.filepath)] },
    { methods: ['POST'], path: /^\/api\/v1\/wasabi\/retriveObject\/?$/i, projects: (req) => [projectOfKey(req.body && req.body.path)] },
];

const methodOf = (req) => (req.method === 'HEAD' ? 'GET' : req.method);

const heldRouteOf = (req) => {
    const path = String(req.originalUrl || req.path || '').split('?')[0];
    return HELD_ROUTES.find((route) => route.methods.includes(methodOf(req)) && route.path.test(path)) || null;
};

const namedProjectsReadable = async (req, route) => {
    const { canReadProject } = require('./projectAccess');
    const ids = route.projects(req);
    if (!ids.length || ids.some((id) => typeof id !== 'string' || !OBJECT_ID.test(id))) return false;
    const companyId = String(req.headers['companyid'] || '');
    for (const id of ids) {
        if (!(await canReadProject(companyId, req.uid, id)).allowed) return false;
    }
    return true;
};

const refuse = (res, statusCode, error) => res.status(statusCode).json({ status: false, error, statusText: error, code: 'token_limited_to_projects' });

const holdNarrowedToken = (req, res, next) => {
    const token = req.apiToken;
    if (!isNarrowed(token)) return next();
    const route = heldRouteOf(req);
    if (!route) return refuse(res, 403, ROUTE_REFUSED);
    return runNarrowed(token, async () => {
        let readable;
        try {
            readable = !route.projects || await namedProjectsReadable(req, route);
        } catch (error) {
            logger.error(`narrowed token check failed: ${error.message || error}`);
            return refuse(res, 403, ROUTE_REFUSED);
        }
        return readable ? next() : refuse(res, 404, PROJECT_REFUSED);
    });
};

module.exports = { HELD_ROUTES, holdNarrowedToken, projectOfKey };
